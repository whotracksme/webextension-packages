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

// This global provides an API like an ES Map but will sync
// with local storage from time to time. That is done to prevent
// the loss of all stats when the browser terminates the execution
// context (background script or service worker).
export default class ChromeStorageMap {
  constructor({
    sessionApi = typeof chrome !== 'undefined' && chrome?.storage?.session,
    storageKey,
    softFlushIntervalInMs = 200,
    hardFlushIntervalInMs = 1000,
    ttlInMs = 7 * 24 * 60 * 60 * 1000 /* 1 week */,
    maxEntries = 5000,
  }) {
    this.sessionApi = sessionApi;
    this._inMemoryMap = new Map();

    if (!storageKey) {
      throw new Error('Missing storage key');
    }
    this.storageKey = storageKey;
    this._initialSyncComplete = false;
    this.maxEntries = maxEntries;

    // Make sure old entries that were not cleaned up are eventually
    // removed. Otherwise, we could exceed the local storage quota.
    // Plus, when the maps get big, serializing and deserializing
    // may become expensive. If the actively triggered clean up works,
    // there should be no need to make this expiration too aggressive.
    this.ttlInMs = ttlInMs;
    this._ttlMap = new Map();

    // Flush handling logic: the difference between both limits is that
    // the soft limit does not guarantee that a flush will eventually
    // be performed. After each write operation, it will reset the soft
    // timeout and then flush. Thus, if you keep writing, it will never
    // flush. The hard limit, on the other hand, forces that data gets
    // persisted, but could result in ill-timed write operations.
    //
    // If there are bursts of operations, ideally you want to flush
    // at the end of the burst. The soft limit will result in that,
    // while the hard limit mitigates the risk that the script
    // gets killed before the data gets persisted.
    //
    // Rule of thumbs:
    // * The soft limit should be lower then the hard limit
    // * The hard limit should not be set too high. Remember, it is
    //   the protection against the browser unpredictably killing
    //   the execution.
    this.softFlushIntervalInMs = softFlushIntervalInMs;
    this.hardFlushIntervalInMs = hardFlushIntervalInMs;
    this._scheduledFlush = null;
    this._lastFlush = Date.now();
    this._dirty = false;

    // Assumption: there should be enough time during startup to load
    // the persisted map. Otherwise, the state will be inconsistent
    // whenever the script is loaded (it will eventually become consistent,
    // but that will not help if the browser kills it quickly).
    //
    // (If that assumption does not hold, _warnIfOutOfSync will detect
    // and log it. A potential improvement could be to treat the
    // in-memory map as the source of truth in that scenario.)
    this.isReady = new Promise((resolve, reject) => {
      this.sessionApi.get([this.storageKey], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          const { entries = {}, ttl = {} } = result[this.storageKey] || {};
          this._inMemoryMap = new Map(Object.entries(entries));
          this._ttlMap = new Map(Object.entries(ttl));
          this._initialSyncComplete = true;
          this._expireOldEntries();
          resolve();
        }
      });
    });
  }

  countNonExpiredKeys() {
    this._warnIfOutOfSync();
    this._expireOldEntries();
    return this._inMemoryMap.size;
  }

  get(_key) {
    this._warnIfOutOfSync();
    const key = this.normalizeKey(_key);
    if (this._expireOldEntry(key)) {
      return;
    }
    return this._inMemoryMap.get(key);
  }

  entries() {
    this._warnIfOutOfSync();
    this._expireOldEntries();
    return this._inMemoryMap.entries();
  }

  values() {
    this._warnIfOutOfSync();
    this._expireOldEntries();
    return Object.values(this._inMemoryMap);
  }

  has(_key) {
    this._warnIfOutOfSync();
    const key = this.normalizeKey(_key);
    if (this._expireOldEntry(key)) {
      return;
    }
    return this._inMemoryMap.has(key);
  }

  forEach(callback) {
    this._warnIfOutOfSync();
    this._expireOldEntries();
    this._inMemoryMap.forEach(callback);
  }

  set(_key, value) {
    this._warnIfOutOfSync();

    // This should never trigger. Yet if the maps run full (perhaps
    // as a side-effect of a bug), better reset then continuing with
    // these huge maps.
    if (
      this._inMemoryMap.size >= this.maxEntries ||
      this._ttlMap.size >= this.maxEntries
    ) {
      console.warn(
        'ChromeStorageMap: Maps are running full (maybe you found a bug?). Purging data to prevent performance impacts.',
      );
      this._inMemoryMap.clear();
      this._ttlMap.clear();
    }
    const key = this.normalizeKey(_key);
    this._inMemoryMap.set(key, value);
    this._ttlMap.set(key, Date.now() + this.ttlInMs);
    this._markAsDirty();
  }

  delete(_key) {
    this._warnIfOutOfSync();
    const key = this.normalizeKey(_key);
    const wasDeleted = this._inMemoryMap.delete(key);
    if (wasDeleted) {
      this._ttlMap.delete(key);
      this._markAsDirty();
    }
    return wasDeleted;
  }

  clear() {
    this._warnIfOutOfSync();
    this._inMemoryMap.clear();
    this._ttlMap.clear();

    this._scheduleAction(
      new Promise((resolve, reject) => {
        this.sessionApi.remove(this.storageKey, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      }),
    );
    this._dirty = false;
  }

  // Normalize numbers as strings to prevent nasty pitfalls
  // (ES6 maps support numbers, but after serializing and
  // deserializing, we end up with strings and cannot find
  // the "number" key)
  normalizeKey(key) {
    if (typeof key === 'number') {
      return key.toString();
    }
    if (typeof key === 'string') {
      return key;
    }
    throw new Error(`Unexpected key type (type: ${typeof key}, value: ${key})`);
  }

  _warnIfOutOfSync() {
    if (!this._initialSyncComplete) {
      console.warn(
        `AutoSyncingMap "${this.storageKey}": out of sync (loading is too slow...)`,
      );
    }
  }

  _expireOldEntries() {
    const now = Date.now();
    let count = 0;
    for (const [key, expireAt] of this._ttlMap.entries()) {
      if (now >= expireAt) {
        this._inMemoryMap.delete(key);
        this._ttlMap.delete(key);
        count += 1;
      }
    }

    if (count > 0) {
      this._markAsDirty();
    }
    return count;
  }

  _expireOldEntry(key) {
    const now = Date.now();
    const expireAt = this._ttlMap.get(key);
    if (expireAt && now >= expireAt) {
      this.delete(key);
      return true;
    }
    return false;
  }

  _markAsDirty() {
    const now = Date.now();
    if (!this._dirty) {
      this._lastFlush = now;
      this._dirty = true;
    }

    const nextForcedFlush = this._lastFlush + this.hardFlushIntervalInMs;
    clearTimeout(this._scheduledFlush);
    if (now >= nextForcedFlush) {
      this._flush();
      this._scheduledFlush = null;
    } else {
      this._scheduledFlush = setTimeout(() => {
        this._flush();
        this._scheduledFlush = null;
      }, Math.min(this.softFlushIntervalInMs, nextForcedFlush - now));
    }
  }

  _flush() {
    if (!this._dirty) {
      return;
    }

    this._scheduleAction(
      new Promise((resolve, reject) => {
        if (!this._dirty) {
          resolve();
          return;
        }

        this._dirty = false;
        const serialized = {
          entries: Object.fromEntries(this._inMemoryMap),
          ttl: Object.fromEntries(this._ttlMap),
        };
        this.sessionApi.set({ [this.storageKey]: serialized }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            this._lastFlush = Date.now();
            resolve();
          }
        });
      }),
    );
  }

  _scheduleAction(action) {
    const lastSyncPoint = this.isReady;
    this.isReady = lastSyncPoint.then(action).catch(console.error);
    return this.isReady;
  }
}
