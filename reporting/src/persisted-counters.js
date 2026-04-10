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

import logger from './logger';
import { requireString, requireObject } from './utils';
import { randomSafeIntBetween, shuffleInPlace } from './random';

// Example: ['foo', 'foo', 'bar'] ==> [['foo', 2], ['bar', 1]]
function groupConsecutive(arr) {
  if (arr.length === 0) {
    return [];
  }
  const result = [];
  let current = arr[0];
  let count = 1;

  for (let i = 1; i < arr.length; i += 1) {
    if (arr[i] === current) {
      count += 1;
    } else {
      result.push([current, count]);
      current = arr[i];
      count = 1;
    }
  }
  result.push([current, count]);

  return result;
}

export default class PersistedCounters {
  constructor({ name, db }) {
    this.name = requireString(name);
    this.db = requireObject(db);

    this._pendingCounters = new Map();
    this._pendingFlush = null;
  }

  count(key) {
    this._pendingCounters.set(key, (this._pendingCounters.get(key) || 0) + 1);
    this._markDirty();
  }

  async clear() {
    this._pendingCounters.clear();
    await this.db.clear();
  }

  async flush() {
    this._pendingFlush = null;
    if (this._pendingCounters.size === 0) {
      return;
    }

    await this.db.transaction({ readonly: false }, async (tx) => {
      const entries = [...this._pendingCounters];
      this._pendingCounters.clear();

      await Promise.all(
        entries.map(async ([key, inc]) => {
          const oldValue = (await tx.get(key)) || 0;
          await tx.set(key, oldValue + inc);
        }),
      );
    });
    logger.debug('Flushed counters:', this.name);
  }

  /**
   * Draws random samples.
   *
   * Options:
   * - "group": Aggregates identical samples together
   *    Example: ['foo', 'foo', 'bar'] ==> [['foo', 2], ['bar', 1]]
   */
  async sample(numSamples = 1, { group = false } = {}) {
    // Flush pending counters, so the database becomes the only source of truth.
    // If new counts are being added afterwards, we will not see them, but this
    // is expected; we are then operating on a safe snapshot.
    await this.flush();

    let samples = [];
    if (numSamples > 0) {
      await this.db.transaction({ readonly: true }, async (tx) => {
        // Initial pass to learn how many counts we had in total
        let cursor = await tx.scan();
        let totalSum = 0;
        while (cursor) {
          totalSum += cursor.value;
          cursor = await cursor.next();
        }
        if (totalSum > 0) {
          // Draw the position of the random samples
          const picks = [];
          for (let i = 0; i < numSamples; i += 1) {
            picks.push(randomSafeIntBetween(0, totalSum - 1));
          }

          // Second pass to identify the chosen samples
          cursor = await tx.scan();
          let currentSum = 0;
          while (cursor && samples.length < numSamples) {
            currentSum += cursor.value;
            for (let i = 0; i < picks.length; i += 1) {
              if (currentSum > picks[i]) {
                samples.push(cursor.key);
                picks[i] = Number.MAX_VALUE;
              }
            }
            cursor = await cursor.next();
          }
        }
      });

      if (group) {
        // Group identical values together (['foo', 'foo'] => [['foo', 2]]).
        // By design, identical values are always next to each other.
        samples = groupConsecutive(samples);
      }
    }

    // Do a final shuffle to randomize the order; otherwise, the implicit
    // order of the database may leak through.
    return shuffleInPlace(samples);
  }

  /*
   * Debug function: convert the counters to an ES6 map
   *
   * Do not use this function for production code! If you need to
   * iterate over a database, there are more efficient ways.
   */
  async _dumpToMap() {
    await this.flush();
    return this.db._dumpToMap();
  }

  _markDirty() {
    if (this._pendingFlush === null) {
      this._pendingFlush = setTimeout(() => {
        this.flush().catch(logger.error);
      }, 200);
    }
  }

  toString() {
    return `PersistedCounters[${this.name}]`;
  }
}
