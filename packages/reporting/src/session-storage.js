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
import SeqExecutor from './seq-executor';
import { intersectMapKeys } from './utils';
import SelfCheck from './self-check';

const SECOND = 1000;

/**
 * Stub for chrome.storage.session that won't persist. Note that in an
 * environment with persistent background scripts, this implementation
 * will be even superior to using the real API.
 */
const noopSessionStorage = {
  async get() {
    return {};
  },

  async set() {
    // do nothing
  },

  async remove() {
    // do nothing
  },

  async clear() {
    // do nothing
  },
};

/**
 * Helper class to do the necessary bookkeeping to write to session storage
 * in batched operations. By batching updates, we can keep the number of
 * API calls low and avoid exceeding browser specific quotas (writes per hour).
 */
class DirtyKeys {
  constructor() {
    this.addedKeys = new Set();
    this.removedKeys = new Set();
    this.markedDirtyAt = null;
  }

  get hasPendingUpdates() {
    return this.markedDirtyAt !== null;
  }

  scheduleAdd(key) {
    this.addedKeys.add(key);
    this.removedKeys.delete(key);
    this.markedDirtyAt = this.markedDirtyAt || Date.now();
  }

  scheduleRemoval(key) {
    this.addedKeys.delete(key);
    this.removedKeys.add(key);
    this.markedDirtyAt = this.markedDirtyAt || Date.now();
  }

  scheduleClear(allPresentKeys) {
    this.addedKeys.clear();
    allPresentKeys.forEach((key) => this.removedKeys.add(key));
    if (this.addedKeys.size + this.removedKeys.size > 0) {
      this.markedDirtyAt = this.markedDirtyAt || Date.now();
    } else {
      this.markedDirtyAt = null;
    }
  }

  prepareUpdate() {
    const keysToAdd = [...this.addedKeys];
    const keysToRemove = [...this.removedKeys];
    const markedDirtyAt = this.markedDirtyAt;
    this.addedKeys.clear();
    this.removedKeys.clear();
    this.markedDirtyAt = null;
    return { keysToAdd, keysToRemove, markedDirtyAt };
  }

  /**
   * If the update failed, we can use the following error recover strategy:
   * - reschedule all remove operations again (unless the key has been readded later)
   * - mark all existing keys to be added (forcing a full-sync)
   * - restore the dirty flag to the time before the update
   */
  rollbackAfterFailedUpdate({
    allPresentKeys,
    uncompletedRemovals,
    markedDirtyAt,
  }) {
    uncompletedRemovals.forEach((key) => {
      this.removedKeys.add(key);
    });
    allPresentKeys.forEach((key) => {
      this.addedKeys.add(key);
      this.removedKeys.delete(key);
    });
    if (this.addedKeys.size + this.removedKeys.size > 0) {
      this.markedDirtyAt = markedDirtyAt;
    } else {
      this.markedDirtyAt = null;
    }
  }
}

/**
 * This class is a wrapper around chrome.storage.session
 * (https://developer.chrome.com/docs/extensions/reference/storage/#property-session).
 * Use it to store data that does not need to be persisted on disk across browser
 * restarts.
 *
 * Why not directly use the session API? The wrapper is intended to centralize
 * workarounds to handle limitations of the API:
 * - (If needed) lift quota limits of 8K per object and 1M (or 10M) in total
 *   (Note clear if we hit those, but in principle you could workaround by
 *   storing only a key in memory, persist encrypted data on disk, and purge
 *   leftover on the next startup.)
 * - Fallback to a pure in-memory implementation if the API is not available
 *
 * For convenience, also expose simplified synchronized APIs (but enforces an
 * initial sync in "init").
 */
export default class SessionStorageWrapper {
  constructor({
    sessionApi = typeof chrome !== 'undefined' && chrome?.storage?.session,
    namespace = 'wtm::reporting::default',
    version = 1,
  } = {}) {
    this.prefix = `${namespace}::v${version}::`;
    this.data = null;
    this.sessionApi = sessionApi || noopSessionStorage;

    this._initExecutor = new SeqExecutor();
    this._dirtyKeys = new DirtyKeys();
    this._pendingFlush = null;
    this._flushExecutor = new SeqExecutor();
    this._flushExecutionInProgress = null;

    // These values control the flush logic. It tries to find a balance
    // between aggregating values and but providing guarantees that
    // changes will be eventually written. The guarantee comes from the
    // hard limit: if the hard limit is exceeded, a flush will be forced.
    // The other (soft) limit will be extended after each change. Changes
    // typically come in bursts, so trying to time the end of the burst
    // should be a reasonable strategy.
    this._minFlushIntervalInMs = 50;
    this._hardFlushIntervalInMs = 300;

    this.verboseLogging = false;
  }

  isReady() {
    return this.data !== null;
  }

  async init() {
    if (!this.isReady()) {
      await this._initExecutor.run(async () => {
        if (!this.data) {
          const allEntries = await this.sessionApi.get();
          this.data = Object.fromEntries(
            Object.entries(allEntries)
              .filter(([key]) => this._isInternalKey(key))
              .map(([key, value]) => [this._fromInternalKey(key), value]),
          );
        }
      });
    }
  }

  has(key) {
    return Object.hasOwn(this.data, key);
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.setItems({ [key]: value });
  }

  remove(key) {
    if (this.has(key)) {
      delete this.data[key];
      this._dirtyKeys.scheduleRemoval(key);
      this._scheduleFlush();
    }
  }

  // Note: clears all manages keys, but leaves the others intact.
  // Thus, it is not identical to chrome.storage.session.clear.
  clear() {
    this._ensureInit();
    const keys = Object.keys(this.data);
    if (keys.length > 0) {
      this.data = {};
      this._dirtyKeys.scheduleClear(keys);
      this._scheduleFlush();
    }
  }

  getEntries(filter) {
    if (filter) {
      const shouldInclude = Array.isArray(filter)
        ? (key) => filter.includes(key)
        : filter;
      if (typeof filter !== 'function') {
        throw new Error(
          'Illegal argument: "filter" should be a function or a list of keys',
        );
      }
      return Object.fromEntries(
        Object.entries(this.data).filter(([key]) => shouldInclude(key)),
      );
    }
    return { ...this.data };
  }

  setItems(items) {
    this._ensureInit();
    for (const [key, value] of Object.entries(items)) {
      this.data[key] = value;
      this._dirtyKeys.scheduleAdd(key);
    }
    this._scheduleFlush();
  }

  replaceItems(items) {
    this.clear();
    this.setItems(items);
  }

  _scheduleFlush() {
    if (!this._dirtyKeys.hasPendingUpdates) {
      return;
    }

    const now = Date.now();
    let elapsedSinceLastFlush = now - this._dirtyKeys.markedDirtyAt;
    if (elapsedSinceLastFlush < 0) {
      logger.warn(
        `Clock jumped from ${this._dirtyKeys.markedDirtyAt} back to ${now}. Forcing flush...`,
      );
      elapsedSinceLastFlush = this._hardFlushIntervalInMs;
    }
    const timeoutInMs = Math.max(
      Math.min(
        this._minFlushIntervalInMs,
        this._hardFlushIntervalInMs - elapsedSinceLastFlush,
      ),
      0,
    );
    clearTimeout(this._pendingFlush);
    this._pendingFlush = setTimeout(() => {
      this._pendingFlush = null;
      this.flush().catch((e) => {
        logger.warn('Failed to update chrome.storage.session.', e);
        this._scheduleFlush();
      });
    }, timeoutInMs);
  }

  async flush() {
    this._ensureInit();
    await this._flushExecutor.run(async () => {
      try {
        if (this._dirtyKeys.hasPendingUpdates) {
          this._flushExecutionInProgress = this._dirtyKeys.prepareUpdate();
          const { keysToAdd, keysToRemove, markedDirtyAt } =
            this._flushExecutionInProgress;
          try {
            const pending = [];
            if (keysToAdd.length > 0) {
              const changeSet = Object.fromEntries(
                keysToAdd.map((key) => [
                  this._toInternalKey(key),
                  this.data[key],
                ]),
              );
              pending.push(this.sessionApi.set(changeSet));
            }
            if (keysToRemove.length > 0) {
              const keys = keysToRemove.map((key) => this._toInternalKey(key));
              pending.push(this.sessionApi.remove(keys));
            }
            await Promise.all(pending);
            if (this.verboseLogging) {
              logger.debug(
                'Updated chrome.storage.session:',
                keysToAdd.length,
                'keys added,',
                keysToRemove.length,
                'keys removed',
              );
            }
          } catch (e) {
            // Note: may also happen if the browser starts throtteling the API.
            // To recover, mark the whole state as modified to force a full sync.
            logger.error(
              'Unable to update chrome.storage.session.',
              'For error recovery, mark all keys as dirty (forces a full sync next time).',
              e,
            );
            this._dirtyKeys.rollbackAfterFailedUpdate({
              allPresentKeys: Object.keys(this.data),
              uncompletedRemovals: keysToRemove,
              markedDirtyAt,
            });
          }
        }
      } finally {
        this._flushExecutionInProgress = null;
      }
    });
  }

  _ensureInit() {
    if (!this.data) {
      throw new Error('Illegal state: "init" must be called first');
    }
  }

  _isInternalKey(key) {
    return key.startsWith(this.prefix);
  }

  _toInternalKey(key) {
    return this.prefix + key;
  }

  _fromInternalKey(key) {
    return key.slice(this.prefix.length);
  }

  _hasPendingUpdates() {
    return this._addedKeys.size + this._removedKeys.size > 0;
  }

  async selfChecks(check = new SelfCheck()) {
    if (this._dirtyKeys.markedDirtyAt) {
      const now = Date.now();
      if (this._dirtyKeys.markedDirtyAt + 5 * SECOND < now) {
        check.fail('Unwritten changes for more than 5 seconds');
      } else if (this._dirtyKeys.markedDirtyAt + SECOND < now) {
        check.warn('Unwritten changes for more than one second');
      }
    } else {
      check.pass('Local state in sync with session storage');
    }
    if (this._dirtyKeys.hasPendingUpdates && !this._pendingFlush) {
      check.warn('Out of sync with the session, but no flush is scheduled.');
    }
    if (this._flushExecutionInProgress) {
      check.warn(
        'Pending flush operation (this may happen, but only rarely)',
        this._flushExecutionInProgress,
      );
    }

    const duplicatedKeys = intersectMapKeys(
      this._dirtyKeys.addedKeys,
      this._dirtyKeys.removedKeys,
    );
    if (duplicatedKeys.size > 0) {
      check.fail('Data corruption: keys marked as both added and removed', {
        duplicatedKeys,
      });
    }
    const vanishedAddedKeys = [...this._dirtyKeys.addedKeys].filter(
      (key) => !this.has(key),
    );
    if (vanishedAddedKeys.length > 0) {
      check.fail('Data corruption: added keys vanished', {
        vanishedAddedKeys,
      });
    }
    const zombieKeys = [...this._dirtyKeys.removedKeys].filter((key) =>
      this.has(key),
    );
    if (zombieKeys.length > 0) {
      check.fail('Data corruption: removed keys still present', {
        zombieKeys,
      });
    }

    return check;
  }
}
