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

/* eslint no-param-reassign: 'off' */

import * as datetime from '../time.js';
import md5, { truncatedHash } from '../../md5.js';
import pacemaker from '../../utils/pacemaker.js';
import ChromeStorageMap from '../utils/chrome-storage-map.js';
import logger from '../../logger.js';

const SYNC_DB_INTERVAL = 20 * 1000;

/**
 * Manages the local safekey list
 */
export default class TokenExaminer {
  constructor(qsWhitelist, config, shouldCheckToken) {
    this.qsWhitelist = qsWhitelist;
    this.config = config;
    this.shouldCheckToken = shouldCheckToken;
    this.hashTokens = true;
    this.requestKeyValue = new ChromeStorageMap({
      storageKey: 'wtm-request-reporting:token-examiner:request-key-value',
    });
    this._syncTimer = null;
    this._lastPrune = null;
  }

  async init() {
    await this.requestKeyValue.isReady;
  }

  unload() {
    pacemaker.clearTimeout(this._syncTimer);
    this._syncTimer = null;
  }

  clearCache() {
    this.requestKeyValue.clear();
    return Promise.resolve();
  }

  addRequestKeyValueEntry(tracker, key, tokens) {
    if (!this.requestKeyValue.has(tracker)) {
      this.requestKeyValue.set(tracker, {});
    }
    const trackerMap = this.requestKeyValue.get(tracker);
    if (!trackerMap[key]) {
      trackerMap[key] = {};
    }
    const toks = trackerMap[key];
    Object.keys(tokens).forEach((tok) => {
      toks.add(tok, tokens[tok]);
    });
    return toks;
  }

  removeRequestKeyValueEntry(tracker, key) {
    const trackerMap = this.requestKeyValue.get(tracker);
    if (trackerMap) {
      delete trackerMap[key];
    }
    if (trackerMap && Object.keys(trackerMap).length === 0) {
      this.requestKeyValue.delete(tracker);
    }
  }

  examineTokens(state) {
    // do not do anything for private tabs and non-tracker domains
    if (
      !state.isPrivate &&
      this.qsWhitelist.isTrackerDomain(
        truncatedHash(state.urlParts.generalDomain),
      )
    ) {
      const today = datetime.getCurrentDay();

      const tracker = truncatedHash(state.urlParts.generalDomain);

      // create a Map of key => set(values) from the url data
      const trackerMap = this.requestKeyValue.get(tracker) || {};
      const reachedThreshold = new Set();
      const newTrackerMap = state.urlParts
        .extractKeyValues()
        .params.reduce((hash, kv) => {
          const [k, v] = kv;
          if (!this.shouldCheckToken(v)) {
            return hash;
          }
          const key = this.hashTokens ? md5(k) : k;
          if (this.qsWhitelist.isSafeKey(tracker, key)) {
            return hash;
          }
          const tok = this.hashTokens ? md5(v) : v;
          if (!hash[key]) {
            hash[key] = {};
          }
          hash[key][tok] = today;
          // whitelist any keys which reached the threshold
          if (
            !reachedThreshold.has(key) &&
            Object.keys(hash[key]).length > this.config.safekeyValuesThreshold
          ) {
            reachedThreshold.add(key);
            if (this.config.debugMode) {
              logger.info(
                'Add safekey',
                state.urlParts.generalDomain,
                key,
                hash[key],
              );
            }
            this.qsWhitelist.addSafeKey(
              tracker,
              this.hashTokens ? key : md5(key),
              this.config.safekeyValuesThreshold,
            );
          }
          return hash;
        }, trackerMap);

      // push updated cache
      this.requestKeyValue.set(tracker, newTrackerMap);
      this._scheduleSync(today !== this._lastPrune);
      return true;
    }
    return true;
  }

  getPruneCutoff() {
    const day = datetime.newUTCDate();
    day.setDate(day.getDate() - this.config.safeKeyExpire);
    return datetime.dateString(day);
  }

  _scheduleSync() {
    if (this._syncTimer) {
      return;
    }
    const syncDb = async () => {
      try {
        await this._syncDb();
      } finally {
        this._syncTimer = null;
      }
    };
    this._syncTimer = pacemaker.setTimeout(syncDb, SYNC_DB_INTERVAL);
  }

  async _syncDb() {
    const cutoff = this.getPruneCutoff();
    this.requestKeyValue.forEach((trackerMap, tracker) => {
      for (const [key, tokenSet] of Object.entries(trackerMap)) {
        Object.entries(tokenSet).forEach(([value, day]) => {
          if (day < cutoff) {
            delete tokenSet[value];
          }
        });
        if (
          Object.keys(tokenSet).length > this.config.safekeyValuesThreshold &&
          !this.qsWhitelist.isSafeKey(tracker, key)
        ) {
          this.qsWhitelist.addSafeKey(
            tracker,
            this.hashTokens ? key : md5(key),
            Object.keys(tokenSet).length,
          );
          this.removeRequestKeyValueEntry(tracker, key);
        }
      }
    });
  }
}
