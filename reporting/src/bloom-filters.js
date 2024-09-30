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

import logger from './logger.js';
import { fastHash } from './utils.js';
import PersistedBitarray from './persisted-bitarray.js';
import SelfCheck from './self-check.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function allPairwiseRelativePrime(values) {
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (gcd(values[i], values[j]) !== 1) {
        return false;
      }
    }
  }
  return true;
}

/**
 * A bloom filter that is persisted.
 *
 * The implementation is bases on a "One-Hashing Bloom Filter"
 * (see https://yangtonghome.github.io/uploads/One_Hashing.pdf).
 * It uses only one hashing function, but splits the array in multiple partitions.
 * The length of the partitions are expected to be pairwise relatively prime.
 * That means, their gcd must be 1. For instance, you can take different prime numbers
 * (https://gist.github.com/philipp-classen/318c870eb848b84548448eb4b80eed55).
 *
 * In OHBF, the number of partitions is comparable to "k" (the number of
 * hashing functions) in a standard bloom filter and similar trade-offs apply.
 */
export class BloomFilter {
  constructor({
    database,
    name,
    prefix = '',
    version = 1,
    partitions,
    maxGenerations = 2,
    rotationIntervalInMs = 3 * MONTH,
  }) {
    if (partitions.length === 0 || partitions.some((x) => x <= 0)) {
      throw new Error('Partitions must be all non-empty and greater than zero');
    }
    this.partitions = partitions;
    this.totalSize = partitions.reduce((x, y) => x + y);
    this.db = database;

    if (!name) {
      throw new Error('Expected a name');
    }
    if (name.includes('|')) {
      throw new Error(
        `name=${name} it must not include the separator character |`,
      );
    }
    this.name = name;

    // bf|<name>|<version>|<generation>|<shard>
    this.version = `v${version}`;
    if (this.version.includes('|')) {
      throw new Error(
        `version=${this.version} it must not include the separator character |`,
      );
    }
    this.keyPrefix = `${prefix}bf|${name}|`;
    this.keyPrefixWithVersion = `${this.keyPrefix}${this.version}|`;

    // rotation settings
    if (maxGenerations <= 0) {
      throw new Error(
        `At least one generation is needed (got: ${maxGenerations})`,
      );
    }
    if (rotationIntervalInMs < 0) {
      throw new Error(
        `Rotation interval must not be negative (got: ${rotationIntervalInMs})`,
      );
    }
    if (maxGenerations > 1 && rotationIntervalInMs === 0) {
      throw new Error(
        'Rotations can only be disabled if you also set one generation',
      );
    }
    this.maxGenerations = maxGenerations;
    this.rotationIntervalInMs = rotationIntervalInMs;

    const logPrefix = `[bf=<${name}>]`;
    this._debug = logger.debug.bind(logger.debug, logPrefix);
    this._info = logger.info.bind(logger.info, logPrefix);
    this._warn = logger.warn.bind(logger.warn, logPrefix);
    this._error = logger.error.bind(logger.error, logPrefix);
  }

  _isOurKey(key) {
    return key.startsWith(this.keyPrefix);
  }

  _isKeyFromCurrentVersion(key) {
    return key.startsWith(this.keyPrefixWithVersion);
  }

  async ready(now = Date.now()) {
    if (!this._ready) {
      this._ready = (async () => {
        // First, load all keys and detect keys that are own by the bloom filter.
        // All keys that start with the prefix will be own by the bloom filter. Since the
        // prefix includes its name, collisions should be unlikely. Yet it is still
        // recommended to create separate databases to eliminate all potential clashes
        // and to simplify the cleanup of obsolete values.
        //
        // Valid keys (owned by the bloom filter) have to follow this naming fconvention:
        // <bf|<name>|<version>|<generation>|<shard>
        //
        // where
        //   <prefix>: "bf|<name>|<version>"
        //   <generation>: a Unix epoch (corresponding to the creation date)
        //   <shard>: unspecified (internal to the persisted bitarray)
        const allKeys = await this.db.keys();
        const keysByGen = new Map();
        const obsoleteKeys = [];
        const corruptedKeys = [];
        const unknownKeys = [];

        // Partition keys into:
        // 1) valid keys (owned by us); group by generation
        // 2) obsolete keys (owned by us but from old version)
        // 3) corrupted keys (owned by us but invalid)
        // 4) unknown (not owned by us)
        for (const key of allKeys) {
          if (this._isKeyFromCurrentVersion(key)) {
            const [genString, shard] = key
              .slice(this.keyPrefixWithVersion.length)
              .split('|');
            if (genString && shard) {
              const gen = Number.parseInt(genString, 10);
              if (gen > 0) {
                const entry = keysByGen.get(gen);
                if (entry) {
                  entry.push(key);
                } else {
                  keysByGen.set(gen, [key]);
                }
                continue; // valid key
              }
            }
            corruptedKeys.push(key);
          } else if (this._isOurKey(key)) {
            obsoleteKeys.push(key);
          } else {
            unknownKeys.push(key);
          }
        }

        // Clean up obsolete and corrupted keys
        const pendingCleanups = [];
        if (corruptedKeys.length + obsoleteKeys.length > 0) {
          if (corruptedKeys.length > 0) {
            this._warn(
              corruptedKeys.length,
              'corrupted keys found (will be deleted):',
              corruptedKeys,
            );
          }
          if (obsoleteKeys.length > 0) {
            this._info(
              obsoleteKeys.length,
              'keys from old version found (will be deleted):',
              obsoleteKeys,
            );
          }
          pendingCleanups.push(async () => {
            try {
              await Promise.all(
                [...corruptedKeys, ...obsoleteKeys].map((key) =>
                  this.db.delete(key),
                ),
              );
              this._info('Successfully cleaned up keys');
            } catch (e) {
              this._warn('Failed to cleanup keys', e);
            }
          });
        }

        // The presence of keys that are owned by us is not neccesarily a problem,
        // although it is recommended to use a separate databases for each bloom filter.
        // Doing that should fix the warning (or if you still get errors, it is an
        // indicator that there is a bug in the persistence).
        if (unknownKeys.length > 0) {
          this._warn(
            unknownKeys.length,
            'unknown keys found (use a dedicated database per bloom filter)',
          );
          this._debug('List of unknown keys:', unknownKeys);
        }

        const gensToDelete = [];
        const currentGens = [...keysByGen.keys()].sort((x, y) => x - y);
        if (currentGens.length === 0) {
          this._debug('No existing generations found');
        }

        // remove everything that has a creation date far in the future
        const isTooNew = (ts) => ts > now + 2 * this.rotationIntervalInMs;
        while (
          currentGens.length > 0 &&
          isTooNew(currentGens[currentGens.length - 1])
        ) {
          const newestGen = currentGens.pop();
          gensToDelete.push(newestGen);
          this._warn(
            'Clock jump detected: purging corrupted generation:',
            newestGen,
          );
        }

        // if we use rotations, first remove generations that should be rotated out by age
        if (this.maxGenerations > 1) {
          const isTooOld = (ts) =>
            ts < now - this.rotationIntervalInMs * this.maxGenerations;
          while (currentGens.size > 0 && isTooOld(currentGens[0])) {
            const oldestGen = currentGens.shift();
            gensToDelete.push(oldestGen);
            this._info('detected old generation:', oldestGen);
          }
        }

        if (
          currentGens.length === 0 ||
          (this.maxGenerations > 1 &&
            currentGens[currentGens.length - 1] <
              now - this.rotationIntervalInMs)
        ) {
          this._info('Start new generation:', now);
          currentGens.push(now);
        }

        const rotatedOut = currentGens.splice(
          0,
          currentGens.length - this.maxGenerations,
        );
        if (rotatedOut.length > 0) {
          this._info('Rotated out the following generations:', rotatedOut);
          gensToDelete.push(...rotatedOut);
        }

        for (const gen of gensToDelete) {
          pendingCleanups.push(async () => {
            this._info('Deleting generation', gen);
            const keys = keysByGen.get(gen);
            try {
              await Promise.all(keys.map((key) => this.db.delete(key)));
              this._info(
                `Generation ${gen} successfully deleted (${keys.length} keys in total)`,
              );
            } catch (e) {
              this._warn('Failed to delete keys from generation', gen, e);
            }
          });
        }
        await Promise.all(pendingCleanups);

        this.generations = currentGens.map(
          (gen) =>
            new PersistedBitarray({
              database: this.db,
              size: this.totalSize,
              prefix: `${this.keyPrefixWithVersion}${gen}|`,
              name: `bf=<${this.name}:${gen}}>`,
            }),
        );
      })();
    }
    await this._ready;
  }

  async add(value) {
    await this.ready();

    const latestGeneration = this.generations[this.generations.length - 1];
    const bitsToSet = this._computeBits(value);
    await latestGeneration.setMany(bitsToSet);
  }

  async mightContain(value, { updateTTLIfFound = false } = {}) {
    await this.ready();

    const bitsToTest = this._computeBits(value);
    for (let i = this.generations.length - 1; i >= 0; i -= 1) {
      const generation = this.generations[i];
      const found = await generation.testMany(bitsToTest);
      if (found && updateTTLIfFound && i !== this.generations.length - 1) {
        const latestGeneration = this.generations[this.generations.length - 1];
        await latestGeneration.setMany(bitsToTest);
        return true;
      }
    }
    return false;
  }

  _computeBits(value) {
    const hash = fastHash(value, { output: 'number' });
    let offset = 0;
    return this.partitions.map((partitionSize) => {
      const posInPartition = hash % partitionSize;
      const index = offset + posInPartition;
      offset += partitionSize;
      return index;
    });
  }

  async selfChecks(check = new SelfCheck()) {
    if (!allPairwiseRelativePrime(this.partitions)) {
      check.warn('partitions should be pairwise relative prime', {
        partitions: this.partitions,
      });
    }
    if (this.generations) {
      await Promise.all(
        this.generations.map((gen) => gen.selfChecks(check.for(gen.name))),
      );
    }
    return check;
  }
}
