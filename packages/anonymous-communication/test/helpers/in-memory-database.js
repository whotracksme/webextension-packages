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
}
