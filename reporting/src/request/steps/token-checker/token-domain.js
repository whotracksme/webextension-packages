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

import * as datetime from '../../utils/time.js';
import logger from '../../../logger.js';
import ChromeStorageMap from '../../utils/chrome-storage-map.js';

const DAYS_EXPIRE = 7;
const STAGED_TOKEN_EXPIRY = 1000 * 60 * 60 * 24 * 2; // 2 days

export default class TokenDomain {
  constructor(config, db) {
    this.config = config;
    this.db = db;
    this.blockedTokens = new Set();
    this.stagedTokenDomain = new ChromeStorageMap({
      storageKey: 'wtm-request-reporting:token-domain:staged-token-domain',
      ttlInMs: STAGED_TOKEN_EXPIRY,
    });
  }

  async init() {
    // load current tokens over threshold
    await this.stagedTokenDomain.isReady;
    await this.db.ready;
    await this.loadBlockedTokens();
  }

  unload() {}

  loadBlockedTokens() {
    // delete expired blocked tokens
    return this.db.tokenBlocked.uniqueKeys().then((blockedTokens) => {
      this.blockedTokens.clear();
      blockedTokens.forEach((tok) => this.blockedTokens.add(tok));
    });
  }

  /**
   * Mark that the given token was seen on this firstParty. Optionally specify a past day to insert
   * for, otherwise the current day is used
   * @param {String} token      token value
   * @param {String} firstParty first party domain
   * @param {String} day        (optional) day string (YYYYMMDD format)
   */
  addTokenOnFirstParty(token, firstParty, day) {
    const tokenDay = day || datetime.getCurrentDay();

    this._addTokenOnFirstParty({
      token,
      firstParty,
      day: tokenDay,
    });
  }

  _addTokenOnFirstParty({ token, firstParty, day }) {
    if (!this.stagedTokenDomain.has(token)) {
      this.stagedTokenDomain.set(token, {});
    }
    const tokens = this.stagedTokenDomain.get(token);

    tokens[firstParty] = day;
    return this._checkThresholdReached(token, tokens);
  }

  _checkThresholdReached(token, tokens) {
    if (Object.keys(tokens).length >= this.config.tokenDomainCountThreshold) {
      this.addBlockedToken(token);
    }
    return this.blockedTokens.has(token);
  }

  async addBlockedToken(token) {
    if (this.config.debugMode) {
      logger.info('tokenDomain', 'will be blocked:', token);
    }
    const day = datetime.newUTCDate();
    day.setDate(day.getDate() + DAYS_EXPIRE);
    const expires = datetime.dateString(day);
    this.blockedTokens.add(token);
    await this.db.ready;
    return this.db.tokenBlocked.put({
      token,
      expires,
    });
  }

  isTokenDomainThresholdReached(token) {
    return (
      this.config.tokenDomainCountThreshold < 2 || this.blockedTokens.has(token)
    );
  }

  clean() {
    const day = datetime.newUTCDate();
    day.setDate(day.getDate() - DAYS_EXPIRE);
    const dayCutoff = datetime.dateString(day);

    this.stagedTokenDomain.forEach((fps, token) => {
      const toPrune = [];
      Object.entries(fps).forEach(([fp, mtime]) => {
        if (mtime < dayCutoff) {
          toPrune.push(fp);
        }
      });
      toPrune.forEach((fp) => {
        delete fps[fp];
      });
      if (Object.keys(fps).length === 0) {
        this.stagedTokenDomain.delete(token);
      }
    });
  }

  async clear() {
    await this.db.ready;
    this.blockedTokens.clear();
    this.stagedTokenDomain.clear();
    return this.db.tokenBlocked.clear();
  }
}
