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

import logger from '../../../logger';
import Subject from '../../utils/subject';
import ChromeStorageMap from '../../utils/chrome-storage-map';

const CACHE_TTL = 2 * 24 * 60 * 60 * 1000; // 2 days

/**
 * Abstract part of token/key processing logic.
 */
export default class CachedEntryPipeline {
  constructor({ name, db, trustedClock, primaryKey, options }) {
    this.name = name;
    this.db = db;
    this.trustedClock = trustedClock;
    this.cache = new ChromeStorageMap({
      storageKey: `wtm-request-reporting:token-telemetry:${name}`,
      ttlInMs: CACHE_TTL,
    });
    this.primaryKey = primaryKey;
    this.options = options;
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
  saveBatchToDb(keys) {
    const rows = keys.map((key) => {
      const entry = this.getFromCache(key);
      entry.dirty = false;
      return this.serialiseEntry(key, entry);
    });
    return this.db.bulkPut(rows);
  }

  /**
   * Create an Rx pipeline to process a stream of tokens or keys at regular intervals
   * and pushes generated messages to the outputSubject.
   * @param inputObservable Observable input to the pipeline
   * @param outputSubject Subject for outputed messages
   * @param batchInterval how often to run batches
   * @param batchLimit maximum messages per batch
   */
  async init(
    inputObservable,
    sendMessage,
    batchInterval,
    batchLimit,
    overflowSubject,
  ) {
    await this.cache.isReady;
    const pipeline = new Subject();
    this.input = inputObservable;

    let batch = [];
    setInterval(() => {
      pipeline.pub(batch);
      batch = [];
    }, batchInterval);

    inputObservable.subscribe((token) => {
      batch.push(token);
    });

    pipeline.subscribe(async (batch) => {
      try {
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
          batchLimit,
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
        messages.forEach((msg) => {
          sendMessage(msg);
        });
        // push overflowed entries back into the queue
        overflowKeys.forEach((k) => overflowSubject.pub(k));
      } catch (e) {
        logger.error('Failed to initialize stream', e);
      }
    });
  }

  unload() {}

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
    queuedForSending.forEach((v) => this.input.pub(v));
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
