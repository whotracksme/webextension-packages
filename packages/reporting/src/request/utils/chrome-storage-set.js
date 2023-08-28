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

export default class ChromeStorageSet extends ChromeStorageBase {
  constructor(options) {
    super(options);
    this.inMemoryData = new Set();
  }

  deserialise(entries) {
    return new Set(entries);
  }

  serialise(entries) {
    return [...entries];
  }

  add(_value) {
    this._warnIfOutOfSync();

    // This should never trigger. Yet if the sets run full (perhaps
    // as a side-effect of a bug), better reset then continuing with
    // these huge sets.
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
    const value = this.normalizeKey(_value);
    this.inMemoryData.add(value);
    this._ttlMap.set(value, Date.now() + this.ttlInMs);
    this._markAsDirty();
  }

  has(_value) {
    this._warnIfOutOfSync();
    const value = this.normalizeKey(_value);
    return this.inMemoryData.has(value);
  }

  delete(_value) {
    this._warnIfOutOfSync();
    const value = this.normalizeKey(_value);
    const wasDeleted = this.inMemoryData.delete(value);
    if (wasDeleted) {
      this._ttlMap.delete(value);
      this._markAsDirty();
    }
    return wasDeleted;
  }
}
