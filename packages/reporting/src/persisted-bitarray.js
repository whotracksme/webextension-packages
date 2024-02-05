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
import SelfCheck from './self-check';

const SECOND = 1000;

/**
 * A bitarray that is backed on disk.
 *
 * It only provides weak guarantees, so only use it for
 * data that can tolerate lost writes.
 */
export default class PersistedBitarray {
  constructor({ database, size, name, prefix = '', shardConfig }) {
    if (!database) {
      throw new Error('Database expected');
    }
    if (size < 0) {
      throw new Error(`Size must be negative (got ${size})`);
    }
    this.db = database;
    this.size = size;
    this.numBytes = Math.ceil(size / 8);

    if (!name) {
      throw new Error('Expected a name');
    }
    this.name = name;

    const { numShards, shardSize, version } =
      shardConfig || this._automaticallyChooseShardSize(size);
    this.numShards = numShards;
    this.shardSize = shardSize;
    this.keyPrefix = `${prefix}arr|${name}|`;
    this.keyPrefixWithVersion = `${this.keyPrefix}v${version}|`;

    this.keys = Array(this.numShards);
    for (let shard = 0; shard < this.numShards; shard += 1) {
      this.keys[shard] = `${this.keyPrefixWithVersion}${shard}`;
    }
    this.dirtyShards = new Set();
    this.lastSyncToDB = 0; // Unix epoch
    this.pendingLoads = new Map();

    const logPrefix = `[arr=<${name}>]`;
    this._debug = logger.debug.bind(logger.debug, logPrefix);
    this._info = logger.info.bind(logger.info, logPrefix);
    this._warn = logger.warn.bind(logger.warn, logPrefix);
    this._error = logger.error.bind(logger.error, logPrefix);
  }

  async ready() {
    if (!this._ready) {
      this._ready = (async () => {
        const allKeys = await this.db.keys();
        const ourKeys = allKeys.filter((key) => key.startsWith(this.keyPrefix));
        const remainingKeys = new Set(ourKeys);
        this.shards = new Array(this.numShards);
        for (let shard = 0; shard < this.numShards; shard += 1) {
          const found = remainingKeys.delete(this.keys[shard]);
          if (found) {
            this.shards[shard] = undefined; // to be loaded lazily
          } else {
            this.shards[shard] = null; // all-zero
          }
        }
        if (remainingKeys.size > 0) {
          const unmatchedKeys = [...remainingKeys];
          this._warn(
            'Found',
            unmatchedKeys.size,
            'unmatched keys (will be deleted):',
            unmatchedKeys,
          );
          Promise.all(unmatchedKeys.map((key) => this.db.deleteKey(key)))
            .then(() => this._info('Unmatched keys successfully removed'))
            .catch((e) => this._warn('Failed to delete keys', e));
        }
      })();
    }
    await this._ready;
  }

  set(pos, val = true) {
    return this.setMany([pos], val);
  }

  test(pos) {
    return this.testMany([pos]);
  }

  async setMany(posArray, val = true) {
    await this.ready();
    return Promise.all(posArray.map((pos) => this._internalSetBit(pos, val)));
  }

  async testMany(posArray) {
    await this.ready();

    // First check the once that are already loaded in memory.
    const notInMemory = [];
    for (const pos of posArray) {
      const idx = this._toIdx(pos);
      if (this.shards[idx.shard] === null) {
        return false; // the whole shard is 0
      }
      if (this.shards[idx.shard] !== undefined) {
        const isSet = (this.shards[idx.shard][idx.bytePos] & idx.bitMask) !== 0;
        if (!isSet) {
          return false;
        }
      } else {
        notInMemory.push(idx);
      }
    }

    // Continue if the shards that need to be loaded in memory.
    // Go one by one and only load them lazily.
    for (const { shard, bytePos, bitMask } of notInMemory) {
      await this._loadShard(shard);
      const isSet = (this.shards[shard][bytePos] & bitMask) !== 0;
      if (!isSet) {
        return false;
      }
    }

    return true;
  }

  _toIdx(pos) {
    if (pos < 0 || pos > this.size) {
      throw new Error(`Index out of bounds: pos=${pos}, size=${this.size}`);
    }
    const shard = Math.floor(pos / this.shardSize);
    const bitPos = pos - shard * this.shardSize;
    const bytePos = Math.floor(bitPos / 8);
    const bitToSet = bitPos % 8;
    const bitMask = 1 << bitToSet;
    return { shard, bytePos, bitMask };
  }

  async _internalSetBit(pos, val) {
    const { shard, bytePos, bitMask } = this._toIdx(pos);
    await this._loadShard(shard);

    const old = this.shards[shard][bytePos];
    if (val) {
      this.shards[shard][bytePos] |= bitMask;
    } else {
      this.shards[shard][bytePos] &= ~bitMask;
    }
    if (this.shards[shard][bytePos] !== old) {
      this._markShardAsDirty(shard);
    }
  }

  async _loadShard(shard) {
    if (this.shards[shard] === null) {
      this.shards[shard] = new Uint8Array(this.shardSize);
      return;
    }
    if (this.shards[shard] !== undefined) {
      return;
    }
    const existingLoad = this.pendingLoads.get(shard);
    if (existingLoad) {
      await existingLoad;
      return;
    }

    const pendingLoad = (async () => {
      const value = await this.db.get(this.keys[shard]);
      if (this.shards[shard] === undefined) {
        this.shards[shard] = value;
      } else {
        this._warn(
          'Performance bug: shard was loaded more then one (should not be reachable)',
        );
      }
    })();

    this.pendingLoads.set(shard, pendingLoad);
    try {
      await pendingLoad;
    } finally {
      this.pendingLoads.delete(shard);
    }
  }

  _markShardAsDirty(shard) {
    this.dirtyShards.add(shard);
    if (!this._autoFlushTimer) {
      this._autoFlushTimer = setTimeout(() => {
        this.flush().catch(logger.error);
      }, 100); // TODO: reconsider
    }
  }

  _clearAutoFlush() {
    if (this._autoFlushTimer) {
      clearTimeout(this._autoFlushTimer);
      this._autoFlushTimer = null;
    }
  }

  async flush() {
    this._clearAutoFlush();
    if (this.dirtyShards.size === 0) {
      return;
    }

    const shards = [...this.dirtyShards];
    this.dirtyShards.clear();

    this._debug('flushing', shards.length, 'shards');
    await Promise.all(
      shards.map((shard) => this.db.set(this.keys[shard], this.shards[shard])),
    );
    this._debug(shards.length, 'shards successfully written');
    this.lastSyncToDB = Date.now();
  }

  _automaticallyChooseShardSize(numBytes) {
    // Increase the version if you change this function. It will force a reset
    // on the client. As this data structure does not/ provide any consistency
    // guarantees, users of the class should be anticipated to loss data.
    //
    // But if losing the old state is not an option, you can explicitly pass
    // the configuration to the constructor to remain on the old configuration.
    const version = 1;
    const MIN_SHARD_SIZE = 4096;
    const MAX_NUM_SHARDS = 128;

    const numShards = Math.min(
      Math.ceil(numBytes / MIN_SHARD_SIZE),
      MAX_NUM_SHARDS,
    );
    const shardSize = Math.ceil(numBytes / numShards);
    return { numShards, shardSize, version };
  }

  async selfChecks(check = new SelfCheck()) {
    if (this.dirtyShards.size > 0) {
      const now = Date.now();
      if (this.lastSyncToDB + 5 * SECOND > now) {
        check.fail('Unwritten changes for more than 5 seconds');
      } else if (this.lastSyncToDB + 500 > now) {
        check.warn('Unwritten changes for more than 500 ms');
      }
    } else {
      check.pass('In sync with the database');
    }
    return check;
  }
}
