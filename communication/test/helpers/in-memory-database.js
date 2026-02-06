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

/**
 * Implements the IndexedDBKeyValueStore interface.
 */
export default class InMemoryDatabase {
  constructor() {
    this.db = new Map();
  }

  async open() {}

  async close() {}

  async get(key) {
    return this.db.get(key);
  }

  async set(key, value) {
    this.db.set(key, value);
  }

  async remove(key) {
    return this.db.delete(key);
  }

  async clear() {
    this.db.clear();
  }

  async keys() {
    return [...this.db.keys()];
  }

  // Note: does not support rollbacks and exclusive access
  async transaction({ readonly }, cb) {
    const tx = {};

    tx.get = (key) => this.get(key);
    tx.scan = async () => {
      const entries = [...this.db];
      let pos = 0;
      const nextCursor = async () => {
        if (pos === entries.length) {
          return null;
        }
        const [key, value] = entries[pos++];
        return {
          key,
          value,
          next: nextCursor,
        };
      };
      return nextCursor();
    };

    if (!readonly) {
      tx.set = (key, value) => this.set(key, value);
      tx.remove = (key) => this.remove(key);
      tx.clear = () => this.clear();
    }

    await cb(tx);
  }

  async _dumpToMap() {
    return new Map([...this.db]);
  }

  // To be used for tests to simulate lost write when the extension restarts.
  // By cloning the database, writes can still go into the old instance
  // without unintentionally updating the live version (after the simulated
  // service worker restart).
  _clone() {
    const clone = new InMemoryDatabase();
    clone.db = new Map([...this.db]);
    return clone;
  }
}
