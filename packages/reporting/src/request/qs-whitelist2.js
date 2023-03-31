/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { differenceInDays, parseISO, getUnixTime, sub } from 'date-fns';

import PackedBloomFilter from '../utils/bloom-filter-packed';
import pacemaker from '../utils/pacemaker';
import logger from '../logger';

async function fetchPackedBloomFilter(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(response.error);
  }
  const buffer = await response.arrayBuffer();
  return buffer;
}

export default class QSWhitelist2 {
  constructor(CDN_BASE_URL) {
    this.CDN_BASE_URL = CDN_BASE_URL;
    this.bloomFilter = null;
    this.localSafeKey = {};
  }

  async init() {
    try {
      const update = await this._fetchUpdateURL();
      await this._fullUpdate(update.version);
    } catch (e) {
      // TODO @chrmod: consider how to deal with this situation
    }
  }

  async _fetchUpdateURL() {
    const url = `${this.CDN_BASE_URL}/update.json.gz`;
    const request = await fetch(url);
    if (!request.ok) {
      throw new Error(request.error);
    }
    return request.json();
  }

  async _fullUpdate(version) {
    const url = `${this.CDN_BASE_URL}/${version}/bloom_filter.gz`;
    const buffer = await fetchPackedBloomFilter(url);
    this.bloomFilter = new PackedBloomFilter(buffer);
    this.version = version;
    logger.debug(`[QSWhitelist2] Bloom filter fetched version ${version}`);
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
      differenceInDays(parseISO(this.version)).diff(parseISO(version)) === -1
    ) {
      logger.debug(`[QSWhitelist2] Updating bloom filter to version ${version} from diff file`);
      // diff update is allowed and our version is one day behind the server
      const buffer = await fetchPackedBloomFilter(`${this.CDN_BASE_URL}/${version}/bf_diff_1.gz`);
      this.bloomFilter.update(buffer);
      this.version = version;
      return;
    }
    logger.debug(`[QSWhitelist2] Updating bloom filter to version ${version}`);
    await this._fullUpdate(version);
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
    pacemaker.clearTimeout(this._updateChecker);
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
