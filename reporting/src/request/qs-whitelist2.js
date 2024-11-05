/**
 * WhoTracks.Me
 * https://whotracks.me/
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import { differenceInDays, parseISO, getUnixTime, sub } from 'date-fns';

import PackedBloomFilter from './utils/bloom-filter-packed.js';
import logger from '../logger.js';

const STORAGE_CONFIG_KEY = 'qs_config';
const STORAGE_BLOOM_FILTER_KEY = 'qs_bloom_filter';

async function fetchPackedBloomFilter(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(response.error);
  }
  const buffer = await response.arrayBuffer();
  return buffer;
}

export default class QSWhitelist2 {
  constructor({ storage, CDN_BASE_URL, LOCAL_BASE_URL, networkFetchEnabled }) {
    this.bloomFilter = null;
    this.localSafeKey = {};
    this.storage = storage;
    this.CDN_BASE_URL = CDN_BASE_URL;
    this.LOCAL_BASE_URL = LOCAL_BASE_URL;
    this.networkFetchEnabled = networkFetchEnabled !== false;
    this.initPromise = new Promise((resolve) => {
      this.initPromiseResolver = resolve;
    });
  }

  async init() {
    try {
      const { version, localSafeKey } = await this.storage.get(
        STORAGE_CONFIG_KEY,
      );

      const buffer = await this.storage.get(STORAGE_BLOOM_FILTER_KEY);
      this.bloomFilter = new PackedBloomFilter(buffer);
      this.version = version;
      this.localSafeKey = localSafeKey || {};
      logger.debug(`[QSWhitelist2] Bloom filter loaded version ${version}`);
    } catch (e) {
      logger.info('[QSWhitelist2] Failed loading filter from local');
    }

    if (this.bloomFilter === null) {
      // local bloom filter loading wasn't successful, grab a new version
      try {
        const update = await this._fetchUpdateURL();
        await this._fullUpdate(update.version);
      } catch (e) {
        logger.error(
          '[QSWhitelist2] Error fetching bloom filter from remote',
          e,
        );
        this.networkFetchEnabled = false;
        try {
          await this._fullUpdate((await this._fetchUpdateURL()).version);
        } catch (e2) {
          logger.info('[QSWhitelist2] failed to load bloom filter');
          // local fetch also failed
          // create empty bloom filter
          const n = 1000;
          const k = 10;
          const buffer = new ArrayBuffer(5 + n * 4);
          const view = new DataView(buffer);
          view.setUint32(0, n, false);
          view.setUint8(4, k, false);
          this.bloomFilter = new PackedBloomFilter(buffer);
        }
      }
    } else {
      // we loaded the bloom filter, check for updates
      try {
        await this._checkForUpdates();
      } catch (e) {
        logger.error(
          '[QSWhitelist2] Error fetching bloom filter updates from remote',
          e,
        );
      }
    }
    this.initPromiseResolver();
  }

  async _fetchUpdateURL() {
    const url = this.networkFetchEnabled
      ? `${this.CDN_BASE_URL}/update.json.gz`
      : `${this.LOCAL_BASE_URL}/update.json`;
    const request = await fetch(url);
    if (!request.ok) {
      throw new Error(request.error);
    }
    return request.json();
  }

  async _fullUpdate(version) {
    const url = this.networkFetchEnabled
      ? `${this.CDN_BASE_URL}/${version}/bloom_filter.gz`
      : `${this.LOCAL_BASE_URL}/bloom_filter.dat`;
    const buffer = await fetchPackedBloomFilter(url);
    this.bloomFilter = new PackedBloomFilter(buffer);
    this.version = version;
    logger.debug(`[QSWhitelist2] Bloom filter fetched version ${version}`);
    await this._persistBloomFilter();
  }

  async _checkForUpdates() {
    const { version, useDiff } = await this._fetchUpdateURL();
    if (version === this.version) {
      logger.debug('[QSWhitelist2] Bloom filter is up-to-date');
      return; // already up to date!
    }
    this._cleanLocalSafekey();
    if (
      useDiff === true &&
      differenceInDays(parseISO(this.version), parseISO(version)) === -1
    ) {
      logger.debug(
        `[QSWhitelist2] Updating bloom filter to version ${version} from diff file`,
      );
      // diff update is allowed and our version is one day behind the server
      const buffer = await fetchPackedBloomFilter(
        `${this.CDN_BASE_URL}/${version}/bf_diff_1.gz`,
      );
      this.bloomFilter.update(buffer);
      this.version = version;
      await this._persistBloomFilter();
      return;
    }
    logger.debug(`[QSWhitelist2] Updating bloom filter to version ${version}`);
    await this._fullUpdate(version);
  }

  async _persistBloomFilter() {
    if (this.bloomFilter !== null) {
      await this.storage.set(STORAGE_CONFIG_KEY, {
        version: this.version,
        localSafeKey: this.localSafeKey,
      });
      await this.storage.set(
        STORAGE_BLOOM_FILTER_KEY,
        this.bloomFilter.data.buffer,
      );
    }
  }

  _cleanLocalSafekey() {
    const cutoff = getUnixTime(sub(new Date(), { days: 7 }));
    Object.keys(this.localSafeKey).forEach((domain) => {
      Object.keys(this.localSafeKey[domain]).forEach((key) => {
        if (this.localSafeKey[domain][key] < cutoff) {
          delete this.localSafeKey[domain][key];
        }
      });
      if (Object.keys(this.localSafeKey[domain]).length === 0) {
        delete this.localSafeKey[domain];
      }
    });
  }

  async destroy() {
    await this._persistBloomFilter();
  }

  isUpToDate() {
    return this.isReady();
  }

  isReady() {
    return this.bloomFilter !== null;
  }

  isTrackerDomain(domain) {
    if (!this.isReady()) {
      return false;
    }
    return this.bloomFilter.testSingle(`d${domain}`);
  }

  shouldCheckDomainTokens(domain) {
    if (!this.isReady()) {
      return false;
    }
    return this.bloomFilter.testSingle(`c${domain}`);
  }

  isSafeKey(domain, key) {
    if (!this.isReady()) {
      return true;
    }
    if (this.bloomFilter.testSingle(`k${domain}${key}`)) {
      return true;
    }
    if (this.localSafeKey[domain] && this.localSafeKey[domain][key]) {
      return true;
    }
    return false;
  }

  isSafeToken(domain, token) {
    if (!this.isReady()) {
      return true;
    }
    return this.bloomFilter.testSingle(`t${token}`);
  }

  isUnsafeKey() {
    return false;
  }

  addSafeKey(domain, key) {
    if (!this.localSafeKey[domain]) {
      this.localSafeKey[domain] = {};
    }
    this.localSafeKey[domain][key] = getUnixTime(new Date());
  }

  addSafeToken(tracker, token) {
    if (!this.isTrackerDomain(tracker)) {
      this.bloomFilter.addSingle(`d${tracker}`);
    }
    if (!this.shouldCheckDomainTokens(tracker)) {
      this.bloomFilter.addSingle(`c${tracker}`);
    }
    this.bloomFilter.addSingle(`t${token}`);
  }

  getVersion() {
    return {
      day: this.version,
    };
  }
}
