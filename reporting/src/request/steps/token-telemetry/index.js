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

import md5, { truncatedHash } from '../../../md5.js';
import KeyPipeline, { getSiteTokensMap } from './key-pipeline.js';
import TokenPipeline from './token-pipeline.js';

const DEFAULT_CONFIG = {
  // token batchs, max 720 messages/hour
  TOKEN_BATCH_INTERVAL: 50 * 1000,
  TOKEN_BATCH_SIZE: 2,
  TOKEN_MESSAGE_SIZE: 10,
  // key batches, max 450 messages/hour
  KEY_BATCH_INTERVAL: 80 * 1000,
  KEY_BATCH_SIZE: 10,
  KEY_TOKENS_LIMIT: 512,
  // clean every 4 mins (activity triggered)
  CLEAN_INTERVAL: 4 * 60 * 1000,
  // batch size of incoming tokens
  TOKEN_BUFFER_TIME: 10 * 1000,
  // minium time to wait before a new token can be sent
  NEW_ENTRY_MIN_AGE: 60 * 60 * 1000,
  // criteria for not sending data
  MIN_COUNT: 1,
  LOW_COUNT_DISCARD_AGE: 1000 * 60 * 60 * 24 * 3, // 3 days
};

/**
 * Token telemetry: Takes a stream of (tracker, key, value) tuples and generates telemetry in
 * the form:
 *  - (value, n_sites, n_trackers, safe?), with each value sent max once per calendar day
 *  - (key, tracker, site, [values]), with each (key, tracker) tuple sent max once per calendar day
 *
 * The pipeline is constructed as follows:
 *  1. Data comes in from the webrequest-pipeline to #extractKeyTokens
 *  2. Tuples are emitted to #subjectTokens.
 *  3. #_tokenSubscription subscribes to #subjectTokens, groups and batches it, and stores data
 * for each `value` and (tracker, key) tuple in Maps.
 *  4. If entries in the Map caches reach a threshold (not sent today and cross site, or older
 * than NEW_ENTRY_MIN_AGE), they are pushed to the respective send pipelines for tokens or keys.
 *  5. The send pipelines (implemented by CachedEntryPipeline), take a stream of keys from their
 * map cache, and check the conditions for sending, given value this entry may have in the
 * database. Values which pass this check are pushed to the message sending queue.
 *
 * The send pipeline also check their cache and database states periodically to trigger data
 * persistence, or load old data.
 */
export default class TokenTelemetry {
  constructor(
    telemetry,
    qsWhitelist,
    config,
    database,
    shouldCheckToken,
    options,
    trustedClock,
  ) {
    const opts = { ...DEFAULT_CONFIG, ...options };
    Object.keys(DEFAULT_CONFIG).forEach((confKey) => {
      this[confKey] = opts[confKey];
    });
    this.telemetry = telemetry;
    this.qsWhitelist = qsWhitelist;
    this.config = config;
    this.trustedClock = trustedClock;
    this.shouldCheckToken = shouldCheckToken;
    this.batch = [];
    this.tokens = new TokenPipeline({
      name: 'tokens',
      db: database.tokens,
      trustedClock,
      options: opts,
      sendMessage: (payload) =>
        this.telemetry({ action: 'wtm.attrack.tokensv2', payload }),
      batchInterval: this.TOKEN_BATCH_INTERVAL,
      batchLimit: this.TOKEN_BATCH_SIZE,
    });
    this.keys = new KeyPipeline({
      name: 'keys',
      db: database.keys,
      trustedClock,
      options: opts,
      sendMessage: (payload) =>
        this.telemetry({ action: 'wtm.attrack.keysv2', payload }),
      batchInterval: this.KEY_BATCH_INTERVAL,
      batchLimit: this.KEY_BATCH_SIZE,
    });
  }

  async init() {
    await this.tokens.isReady;
    await this.keys.isReady;
    await this.tokens.init();
    await this.keys.init();

    setInterval(() => {
      this.#processBatch([...this.batch]);
      this.batch = [];
    }, this.TOKEN_BUFFER_TIME);

    // run every x minutes while there is activity
    setInterval(async () => {
      await this.tokens.clean();
      await this.keys.clean();
    }, this.CLEAN_INTERVAL);
  }

  // token subscription pipeline takes batches of tokens (grouped by value)
  // caches their state, and pushes values for sending once they reach a sending
  // threshold.
  #processBatch(batch) {
    if (batch.length === 0) {
      return;
    }
    const today = this.trustedClock.getTimeAsYYYYMMDD();
    // process a batch of entries for a specific token
    const token = batch[0].token;

    const tokenStats = this.tokens.get(token);
    const entryCutoff = Date.now() - this.NEW_ENTRY_MIN_AGE;
    tokenStats.dirty = true;

    batch.forEach((entry) => {
      if (!tokenStats.sites.includes(entry.fp)) {
        tokenStats.sites.push(entry.fp);
      }
      if (!tokenStats.trackers.includes(entry.tp)) {
        tokenStats.trackers.push(entry.tp);
      }
      tokenStats.safe = tokenStats.safe && entry.safe;

      const keyKey = `${entry.tp}:${entry.key}`;
      const keyStats = this.keys.get(keyKey);
      keyStats.key = entry.key;
      keyStats.tracker = entry.tp;
      keyStats.dirty = true;
      const siteTokens = getSiteTokensMap(keyStats.sitesTokens, entry.fp);
      siteTokens[entry.token] = entry.safe;

      if (
        keyStats.lastSent !== today &&
        (Object.keys(keyStats.sitesTokens).length > 1 ||
          (keyStats.count > this.MIN_COUNT && keyStats.created < entryCutoff))
      ) {
        this.keys.processEntry(keyKey);
      }
    });
    if (
      tokenStats.lastSent !== today &&
      (tokenStats.sites.length > 1 ||
        (tokenStats.count > this.MIN_COUNT && tokenStats.created < entryCutoff))
    ) {
      this.tokens.processEntry(token);
    }
  }

  extractKeyTokens(state) {
    // ignore private requests
    if (state.isPrivate) return true;

    const keyTokens = state.urlParts.extractKeyValues().params;
    if (keyTokens.length > 0) {
      // const truncatedDomain = truncateDomain(state.urlParts.host, this.config.tpDomainDepth);
      // const domain = md5(truncatedDomain).substr(0, 16);
      const firstParty = truncatedHash(state.tabUrlParts.generalDomain);
      const generalDomain = truncatedHash(state.urlParts.generalDomain);

      // anything here should already be hash
      const isTracker = this.qsWhitelist.isTrackerDomain(generalDomain);

      keyTokens.forEach(([k, v]) => {
        if (!this.shouldCheckToken(v)) {
          return;
        }
        const token = md5(v);
        const key = md5(k);

        // put token in safe bucket if: value is short, domain is not a tracker,
        // or key or value is whitelisted
        const safe =
          !isTracker ||
          this.qsWhitelist.isSafeKey(generalDomain, key) ||
          this.qsWhitelist.isSafeToken(generalDomain, token);

        this.batch.push({
          day: this.trustedClock.getTimeAsYYYYMMDD(),
          key,
          token,
          tp: generalDomain,
          fp: firstParty,
          safe,
          isTracker,
        });
      });
    }
    return true;
  }
}
