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

import ChromeStorageMap from '../../utils/chrome-storage-map.js';

const CACHE_TTL = 2 * 24 * 60 * 60 * 1000; // 2 days

/**
 * Abstract part of token/key processing logic.
 */
export default class CachedEntryPipeline {
  constructor(params) {
    this.name = params.name;
    this.db = params.db;
    this.trustedClock = params.trustedClock;
    this.cache = new ChromeStorageMap({
      storageKey: `wtm-request-reporting:token-telemetry:${this.name}`,
      ttlInMs: CACHE_TTL,
    });
    this.primaryKey = params.primaryKey;
    this.options = params.options;
    this.sendMessage = params.sendMessage;
    this.batchInterval = params.batchInterval;
    this.batchLimit = params.batchLimit;
  }

  get(key) {
    const entry = this.getFromCache(key);
    entry.count += 1;
    return entry;
  }

  /**
   * Loads keys from the database into the map cache. Loading is done by merging with
   * existing values, as defined by #updateCache
   * @param keys
   */
  async loadBatchIntoCache(keys) {
    const rows = await this.db.where({
      primaryKey: this.primaryKey,
      anyOf: keys,
    });
    rows
      .filter((row) => keys.includes(row[this.primaryKey]))
      .forEach((row) => this.updateCache(row));
  }

  getFromCache(key) {
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.newEntry();
      this.cache.set(key, entry);
    }
    return entry;
  }

  /**
   * Saves the values from keys in the map cache to the database. Cached entries are serialised
   * by #serialiseEntry
   * @param keys
   */
  async saveBatchToDb(keys) {
    const rows = keys.map((key) => {
      const entry = this.getFromCache(key);
      entry.dirty = false;
      return this.serialiseEntry(key, entry);
    });
    await this.db.bulkPut(rows);
  }

  async init() {
    await this.cache.isReady;
    this.batch = [];
    setInterval(() => {
      if (this.batch.length > 0) {
        this.#processBatch([...this.batch]);
        this.batch = [];
      }
    }, this.batchInterval);
  }

  processEntry(entry) {
    this.batch.push(entry);
  }

  async #processBatch(batch) {
    // merge existing entries from DB
    await this.loadBatchIntoCache(batch);
    // extract message and clear
    const today = this.trustedClock.getTimeAsYYYYMMDD();
    const toBeSent = batch
      .map((token) => [token, this.getFromCache(token)])
      .filter(([, { lastSent }]) => lastSent !== today);

    // generate the set of messages to be sent from the candiate list
    const { messages, overflow } = this.createMessagePayloads(
      toBeSent,
      this.batchLimit,
    );
    // get the keys of the entries not being sent this time
    const overflowKeys = new Set(overflow.map((tup) => tup[0]));

    // update lastSent for sent messages
    toBeSent
      .filter((tup) => !overflowKeys.has(tup[0]))
      .forEach(([, _entry]) => {
        const entry = _entry;
        entry.lastSent = this.trustedClock.getTimeAsYYYYMMDD();
      });

    await this.saveBatchToDb(batch);
    // clear the distinct map
    for (const message of messages) {
      this.sendMessage(message);
    }
    // push overflowed entries back into the queue
    overflowKeys.forEach((k) => this.processEntry(k));
  }

  /**
   * Periodic task to take unsent values from the database and push them to be sent,
   * as well as cleaning and persisting the map cache.
   */
  async clean() {
    const batchSize = 1000;
    // max messages will will push from this clean - next clean will be triggered by the time
    // the queue empties
    const maxSending = Math.ceil(
      (this.options.CLEAN_INTERVAL / this.options.TOKEN_BATCH_INTERVAL) *
        (this.options.TOKEN_BATCH_SIZE * this.options.TOKEN_MESSAGE_SIZE),
    );
    // get values from the database which have not yet been sent today
    const today = this.trustedClock.getTimeAsYYYYMMDD();
    const now = Date.now();
    const notSentToday = (await this.db.where({ primaryKey: 'lastSent' }))
      .filter((token) => token.lastSent !== today)
      .slice(0, batchSize)
      .sort((a, b) => a.created > b.created)
      .filter((row) => row.created < now - this.options.NEW_ENTRY_MIN_AGE);
    // check if they have data to send, or are empty objects.
    // - The former are pushed to the batch processing queue
    // - The later can be discarded, as they were just markers for previously sent data
    const toBeDeleted = [];
    const queuedForSending = [];
    const pruneCutoff = now - this.options.LOW_COUNT_DISCARD_AGE;
    notSentToday.forEach((t) => {
      const hasData = this.hasData(t);
      const minCount = t.count > this.options.MIN_COUNT;
      if (hasData && minCount) {
        // this data should be sent
        queuedForSending.push(t[this.primaryKey]);
      } else if (!hasData || t.createdAt < pruneCutoff) {
        // data has been sent, or this is old data that has not reached the threshold
        toBeDeleted.push(t[this.primaryKey]);
      }
    });
    // push first maxSending entries to input queue
    queuedForSending.splice(maxSending);
    queuedForSending.forEach((v) => this.processEntry.pub(v));
    // delete old entries
    this.db.bulkDelete(toBeDeleted);
    // check the cache for items to persist to the db.
    // if we already sent the data, we can remove it from the cache.
    const saveBatch = [];
    this.cache.forEach((value, key) => {
      if (value.dirty) {
        saveBatch.push(key);
      } else if (value.lastSent) {
        this.cache.delete(key);
      }
    });
    await this.saveBatchToDb(saveBatch);
  }

  createMessagePayloads(toBeSent, batchLimit) {
    const overflow = batchLimit ? toBeSent.splice(batchLimit) : [];
    return {
      messages: toBeSent.map(this.createMessagePayload.bind(this)),
      overflow,
    };
  }
}
