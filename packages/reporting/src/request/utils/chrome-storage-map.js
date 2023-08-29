// TODO @chrmod: share with ghostery-extension
/**
 * Ghostery Browser Extension
 * https://www.ghostery.com/
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import ChromeStorageBase from './chrome-storage-base';

// This global provides an API like an ES Map but will sync
// with local storage from time to time. That is done to prevent
// the loss of all stats when the browser terminates the execution
// context (background script or service worker).
export default class ChromeStorageMap extends ChromeStorageBase {
  constructor(options) {
    super(options);
    this.inMemoryData = new Map();
  }

  deserialise(entries) {
    return new Map(Object.entries(entries));
  }

  serialise(entries) {
    return Object.fromEntries(entries);
  }

  get(_key) {
    this._warnIfOutOfSync();
    const key = this.normalizeKey(_key);
    return this.inMemoryData.get(key);
  }

  has(_key) {
    this._warnIfOutOfSync();
    const key = this.normalizeKey(_key);
    return this.inMemoryData.has(key);
  }

  forEach(callback) {
    this._warnIfOutOfSync();
    this.inMemoryData.forEach(callback);
  }

  set(_key, value) {
    this._warnIfOutOfSync();

    // This should never trigger. Yet if the maps run full (perhaps
    // as a side-effect of a bug), better reset then continuing with
    // these huge maps.
    if (
      this.inMemoryData.size >= this.maxEntries ||
      this._ttlMap.size >= this.maxEntries
    ) {
      console.warn(
        'AutoSyncingMap: Maps are running full (maybe you found a bug?). Purging data to prevent performance impacts.',
      );
      this.inMemoryData.clear();
      this._ttlMap.clear();
    }
    const key = this.normalizeKey(_key);
    this.inMemoryData.set(key, value);
    this._ttlMap.set(key, Date.now() + this.ttlInMs);
    this._markAsDirty();
  }

  delete(_key) {
    this._warnIfOutOfSync();
    const key = this.normalizeKey(_key);
    const wasDeleted = this.inMemoryData.delete(key);
    if (wasDeleted) {
      this._ttlMap.delete(key);
      this._markAsDirty();
    }
    return wasDeleted;
  }
}
