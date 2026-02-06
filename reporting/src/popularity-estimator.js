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

import * as tldts from 'tldts-experimental';

import logger from './logger';
import SeqExecutor from './seq-executor';
import PersistedCounters from './persisted-counters';
import { randomSafeIntBetween } from './random';
import { requireParam, requireUTC, requireString, requireInt } from './utils';
import SelfCheck from './self-check';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Increase this only if you want all state (the persisted counters
 * and the rotation config) to be cleared.
 */
const DB_VERSION = 1;

function intervalTypeToMillseconds(intervalType) {
  switch (intervalType) {
    case '1d':
      return DAY;
    case '1w':
      return WEEK;
    case '4w':
      return 4 * WEEK;
    default:
      throw new Error(`Unexpected interval type: <<${intervalType}>>`);
  }
}

export function chooseNumSamplesPerInterval(intervalType) {
  switch (intervalType) {
    case '1d':
      return 3;
    case '1w':
      return 3;
    case '4w':
      return 3;
    default:
      throw new Error(`Unexpected interval type: <<${intervalType}>>`);
  }
}

export function isLegalVoteCount({ numVotes, intervalType }) {
  requireInt(numVotes);
  return numVotes >= 0 && numVotes <= chooseNumSamplesPerInterval(intervalType);
}

export default class PopularityEstimator {
  constructor({ storage, storageKey, connectDatabase, jobScheduler }) {
    this.active = false;
    this.storage = requireParam(storage);
    this.storageKey = requireString(storageKey);
    this.jobScheduler = requireParam(jobScheduler);

    // Sets up the following structure:
    // - level 1: urlProjection (how to map the URL to a key)
    // - level 2: countType (what event to count)
    // - level 3: interval (what time interval to aggregate)
    //
    // this._popularityBy = {
    //   domain: {
    //     visits: {
    //       '1d': new PersistedCounter(..),
    //       '1w': ..
    //       '4w': ..
    //     }
    //   },
    //   hostname: {
    //     visits: {
    //       '1d': ..
    //       '1w': ..
    //       '4w': ..
    //     }
    //   },
    //   hostnamePath: {
    //     visits: {
    //       ..
    //     }
    //   }
    // }
    this._popularityBy = {};
    this._allCounters = [];
    for (const urlProjection of ['domain', 'hostname', 'hostnamePath']) {
      this._popularityBy[urlProjection] = { visits: {} };
      for (const interval of ['1d', '1w', '4w']) {
        const name = `${urlProjection}::visits::${interval}`;
        const db = connectDatabase(`popularity_estimator::${name}`, {
          version: DB_VERSION,
        });
        const counter = new PersistedCounters({ name, db });
        this._popularityBy[urlProjection].visits[interval] = counter;
        this._allCounters.push(counter);
      }
    }

    // to throttle page visit updates (e.g. history updates can spam)
    this._visitCooldown = {
      hostname: '',
      expireAt: 0, // UTC timestamp
    };

    this._nextRotationCheck = 0; // UTC timestamp
    this._criticalSection = new SeqExecutor();
    this._rotationConfig = null;
    this._rotationConfigPendingWrite = null;
    this._rotationFailuresInARow = 0;
  }

  // convenience function to iterate over "_popularityBy" (see constructor)
  _forEachCounter(cb) {
    for (const [urlProjection, level2] of Object.entries(this._popularityBy)) {
      for (const [countType, level3] of Object.entries(level2)) {
        for (const [intervalType, persistedCounter] of Object.entries(level3)) {
          cb(urlProjection, countType, intervalType, persistedCounter);
        }
      }
    }
  }

  async init() {
    this.active = true;
  }

  unload() {
    this.active = false;
    this.flush().catch(logger.error);
  }

  // Forces an immediate synchronization of all pending data to disk.
  //
  // Context: Persistence usually happens automatically in the background.
  // However, explicitly calling this method is useful for scenarios
  // requiring strong consistency guarantees, such as testing.
  //
  // Once awaited, this function guarantees that all writes have completed.
  async flush() {
    await Promise.all([
      // 1. Immediate Flush
      // Trigger flush operations for all counters without delay.
      this._flushCounters(),

      // 2. Deferred Flush
      // Runs in parallel with the immediate flush but handles a specific edge case:
      // pending "onPageEvent" operations may not have triggered writes yet.
      // To ensure "flush" is intuitive, we wait for all critical sections
      // (event processing) to complete before flushing again.
      this._criticalSection
        .run(async () => {})
        .then(() => this._flushCounters()),
    ]);
  }

  async _flushCounters() {
    await Promise.all(
      this._allCounters.map((counter) =>
        counter.flush().catch((e) => {
          logger.error(`Failed to flush counter: ${counter}`, e);
        }),
      ),
    );
  }

  onPageEvent(event) {
    if (!this.active) {
      return;
    }

    if (event.type === 'safe-page-navigation') {
      const { hostname, pathname } = new URL(event.url);
      const { domain, isIp } = tldts.parse(hostname, {
        extractHostname: false,
        mixedInputs: false,
        validateHostname: false,
      });
      if (isIp) {
        logger.info(
          '[popularity] ignoring visit, because hostname is IP address:',
          event.url,
        );
        return;
      }
      if (!domain) {
        logger.warn('Invalid domain detected in visited URL:', event.url);
        return;
      }

      // Some sites (e.g. Google maps) spam history navigations. To avoid
      // inflating the "visited" counts, ignore updates for a few seconds.
      const now = Date.now();
      try {
        if (
          event.isHistoryNavigation &&
          now < this._visitCooldown.expireAt &&
          this._visitCooldown.hostname === hostname
        ) {
          logger.debug(
            '[popularity] skip visit (cooldown not reached)',
            event.url,
          );
          return;
        }
      } finally {
        this._visitCooldown = { hostname, expireAt: now + 20 * SECOND };
      }

      this._criticalSection
        .run(async () => {
          await this._runRotationChecks(now);
          if (this._rotationFailuresInARow !== 0) {
            logger.warn(
              'Skipping visits, because the last rotation failed:',
              event,
            );
            return;
          }

          const hostnamePath = hostname + pathname;
          for (const [interval, samplingSize] of [
            ['1d', 1],
            ['1w', 10],
            ['4w', 100],
          ]) {
            if (randomSafeIntBetween(1, samplingSize) === 1) {
              this._popularityBy.domain.visits[interval].count(domain);
              this._popularityBy.hostname.visits[interval].count(hostname);
              this._popularityBy.hostnamePath.visits[interval].count(
                hostnamePath,
              );
            }
          }
        })
        .catch((e) => {
          logger.error('Unexpected error', e);
        });
    }
  }

  async _runRotationChecks(now) {
    if (requireUTC(now) >= this._nextRotationCheck) {
      try {
        this._rotationConfig ||= await this._loadRotationConfig(now);
        await this._expireRotationCooldowns(now);
        await this._processCompletedRotations(now);
        this._scheduleNextRotationCheck(now);
        this._rotationFailuresInARow = 0;
      } catch (e) {
        // Should normally not happen, because it should be doing only disk IO
        // operations (not network request, which have a higher chance to fail).
        logger.error('Error while rotating', e);

        // Keep a bit of cooldown before retrying, because the IO operation
        // may be expensive (e.g. table scans over the whole database).
        // Note: The heuristic here is not very effective, since the termination
        // of service worker will reset it. Thus, it will repeat the check on
        // each service worker restart; but perhaps that is okay. Also, when
        // we are in this situation, there are not many options. It is likely
        // that IO is not reliable at the moment (e.g. out of disk).
        this._rotationFailuresInARow += 1;
        this._nextRotationCheck = now + this._rotationFailuresInARow * SECOND;

        if (this._rotationFailuresInARow >= 3) {
          try {
            logger.error(
              'Too many rotation errors in a row. Puring state in an attempt to recover',
            );
            await this.purgeAllState();
            logger.info(
              'Successfully purge the state. Rotations will be retry on the next visit.',
            );
            this._nextRotationCheck = now;
          } catch (e) {
            // give up until the next service worker restart
            logger.error(
              'Failed to purge the state. Perhaps the browser profile is broken?',
              e,
            );
            this._nextRotationCheck = Number.MAX_SAFE_INTEGER;
          }
        }
      }
    }
  }

  async _loadRotationConfig(now) {
    requireUTC(now);

    let config = await this.storage.get(this.storageKey);
    if (!config) {
      logger.info(
        'No rotation config exists found yet.',
        'This should only happen on the first time the extension is started.',
      );
    } else if (config.dbVersion !== DB_VERSION) {
      logger.warn(
        `dbVersion mismatch: expected ${DB_VERSION}, but got ${config.dbVersion}. `,
        'Discarding it and replacing it by a fresh rotation configuration.',
      );
      await this.purgeAllState().catch((e) =>
        logger.warn('Failed to purge the state. Continuing...', e),
      );
      config = null;
    } else if (config.lastUpdatedAt > now + 2 * DAY) {
      logger.error(
        'Reverse clock jump detected: lastUpdatedAt',
        `(${new Date(config.lastUpdatedAt)})`,
        `is significantly ahead of the current time (${new Date(now)}).`,
        'Trying to reset the state and continuing...',
      );
      await this.purgeAllState().catch((e) =>
        logger.warn('Failed to purge the state. Continuing...', e),
      );
      config = null;
    } else {
      logger.debug('Successfully loaded rotation config:', config);
      return config;
    }

    if (!config) {
      config = this._createInitialRotationConfig(now);
      this._rotationConfig = config;
      this._markRotationConfigDirty(now);
      logger.info('Created initial rotation config:', config);
    }

    return config;
  }

  _markRotationConfigDirty(now) {
    if (!this._rotationConfig) {
      throw new Error(
        'Illegal state: rotationConfig must have been loaded before being marked as dirty',
      );
    }
    this._rotationConfig.lastUpdatedAt = requireUTC(now);

    if (this._rotationConfigPendingWrite === null) {
      this._rotationConfigPendingWrite = setTimeout(() => {
        this._rotationConfigPendingWrite = null;
        (async () => {
          try {
            await this.storage.set(this.storageKey, this._rotationConfig);
            logger.debug('Rotation config successfully persisted');
          } catch (e) {
            logger.error('Failed to persist rotation config', e);
          }
        })();
      }, 0);
    }
  }

  _createInitialRotationConfig(now) {
    requireUTC(now);

    const cooldowns = {};
    this._forEachCounter((urlProjection, countType, intervalType) => {
      const defaultRotationPeriod = intervalTypeToMillseconds(intervalType);
      const expireAt = randomSafeIntBetween(now, now + defaultRotationPeriod);
      cooldowns[urlProjection] ||= {};
      cooldowns[urlProjection][countType] ||= {};
      cooldowns[urlProjection][countType][intervalType] = expireAt;

      logger.info('Scheduled cooldown:', {
        urlProjection,
        countType,
        intervalType,
        endsAt: new Date(expireAt),
      });
    });

    return {
      dbVersion: DB_VERSION,
      lastUpdatedAt: now,
      cooldowns,
    };
  }

  async _expireRotationCooldowns(now) {
    requireUTC(now);

    const { cooldowns } = this._rotationConfig;
    if (!cooldowns) {
      return; // all cooldowns have already expired
    }

    let stillActive = 0;
    const pendingIO = [];

    this._forEachCounter(
      (urlProjection, countType, intervalType, persistedCounter) => {
        const expireAt = cooldowns[urlProjection]?.[countType]?.[intervalType];
        if (expireAt !== undefined) {
          if (now >= expireAt) {
            logger.info(
              'Rotation cooldown expired. Ensuring that counters are empty:',
              {
                urlProjection,
                countType,
                intervalType,
              },
            );
            delete cooldowns[urlProjection][countType][intervalType];
            pendingIO.push(persistedCounter.clear());

            // Start initial rotation period:
            const defaultRotationPeriod =
              intervalTypeToMillseconds(intervalType);
            const endsAt = now + defaultRotationPeriod;

            this._rotationConfig.rotations ||= {};
            this._rotationConfig.rotations[urlProjection] ||= {};
            this._rotationConfig.rotations[urlProjection][countType] ||= {};
            this._rotationConfig.rotations[urlProjection][countType][
              intervalType
            ] = endsAt;
            this._markRotationConfigDirty(now);

            logger.info('Scheduled initial rotation:', {
              urlProjection,
              countType,
              intervalType,
              endsAt,
            });
          } else {
            stillActive += 1;
          }
        }
      },
    );
    if (pendingIO.length > 0) {
      await Promise.all(pendingIO);
      logger.debug('Successfully cleared counter.');
    }

    if (stillActive === 0) {
      logger.info('All rotation cooldowns have expired.');
      delete this._rotationConfig.cooldowns;
      this._markRotationConfigDirty(now);
    }
  }

  async _processCompletedRotations(now) {
    requireUTC(now);

    const { rotations } = this._rotationConfig;
    if (!rotations) {
      return; // rotations have not started yet
    }

    const pendingRotations = [];
    this._forEachCounter(
      (urlProjection, countType, intervalType, persistedCounter) => {
        const expireAt = rotations[urlProjection]?.[countType]?.[intervalType];
        if (expireAt !== undefined && now >= expireAt) {
          // We know the end of the last period ("expireAt"). To determine the
          // end of the new period, we first need to find its start. This start
          // could be right after the old period, or if too much time has elapsed,
          // we may have skipped several periods. In such cases, we need to account
          // for the missed periods to maintain accurate time intervals.
          const elapsedSinceEndOfLastPeriod = now - expireAt;
          const defaultRotationPeriod = intervalTypeToMillseconds(intervalType);
          const periodsMissed = Math.floor(
            elapsedSinceEndOfLastPeriod / defaultRotationPeriod,
          );
          const periodStart = expireAt + periodsMissed * defaultRotationPeriod;
          // Now that we know the begin of the current period, we can define
          // the new end. The simplest approach is to advance it by the default
          // period (e.g., 1d, 1w, 4w). This ensures we avoid unintended bias.
          //
          // However, introducing randomness is beneficial for two reasons:
          // 1) It reduces the likelihood of the population being unintentionally
          //    synced by external events. (Though the initial cooldown protects
          //    protection against that, it only affects the first rotation.)
          // 2) It makes it harder to predict when a client will rotate, making
          //    statistical attacks more difficult. (Although concrete attacks
          //    are hard to envision, adding noise should generally improve
          //    overall robustness against possible attacks.)
          const minPeriod = Math.round(0.9 * defaultRotationPeriod);
          const maxPeriod = Math.round(1.1 * defaultRotationPeriod);
          const newExpireAt =
            periodStart + randomSafeIntBetween(minPeriod, maxPeriod);

          rotations[urlProjection][countType][intervalType] = newExpireAt;
          this._markRotationConfigDirty(now);

          logger.info('Rotation period ended and a new one started:', {
            urlProjection,
            countType,
            intervalType,
            periodsMissed,
            newPeriod: {
              startsAt: periodStart,
              expiresAt: newExpireAt,
            },
          });

          pendingRotations.push(
            (async () => {
              // 1) draw samples from the now expired period
              const numSamples = chooseNumSamplesPerInterval(intervalType);
              const groupedSamples = await persistedCounter.sample(numSamples, {
                group: true, // helps to avoid unnecessary, duplicated quorum calls
              });

              // 2) reset counters (destructive action to enter the new period)
              await persistedCounter.clear();

              // 3) prepare jobs (but delay registration until all operations
              //    succeeded, which indicates that the system is healthy)
              return groupedSamples.map(([value, count]) => ({
                type: 'popularity-estimator:prepare-voting:v1',
                args: {
                  urlProjection,
                  countType,
                  intervalType,
                  sample: {
                    value,
                    count,
                  },
                },
                config: {
                  min: 0,
                  max: 2 * MINUTE,
                },
              }));
            })(),
          );
        }
      },
    );

    if (pendingRotations.length > 0) {
      const jobBatchesPerRotation = await Promise.all(pendingRotations);
      const allJobs = jobBatchesPerRotation.flat();
      try {
        await this.jobScheduler.registerJobs(allJobs);
      } catch (e) {
        logger.error('Failed to register jobs. These were lost:', allJobs);
      }
    }
  }

  async purgeAllState() {
    const results = await Promise.allSettled([
      this.storage.remove(this.storageKey),
      ...this._allCounters.map((counter) => counter.clear()),
    ]);
    const errors = results.filter((result) => result.status === 'rejected');
    if (errors.length == 0) {
      logger.info(
        'Successfully cleared all state (including rotation config and counters)',
      );
    } else {
      errors.forEach(({ reason }) =>
        logger.error('Error while clearing the state:', reason),
      );
      throw new Error('Failed to clear state', { cause: errors[0].reason });
    }
  }

  _scheduleNextRotationCheck() {
    let nextCheckAt = Number.MAX_SAFE_INTEGER;
    const check = (expireAt) => {
      if (expireAt !== undefined && expireAt < nextCheckAt) {
        nextCheckAt = expireAt;
      }
    };
    const { cooldowns = {}, rotations = {} } = this._rotationConfig;
    this._forEachCounter((urlProjection, countType, intervalType) => {
      check(cooldowns[urlProjection]?.[countType]?.[intervalType]);
      check(rotations[urlProjection]?.[countType]?.[intervalType]);
    });
    if (nextCheckAt === Number.MAX_SAFE_INTEGER) {
      throw new Error(
        'Illegal state: there must be at least one cooldown or rotation',
      );
    }
    logger.debug('Schedule next rotation at', nextCheckAt);
    this._nextRotationCheck = nextCheckAt;
  }

  async selfChecks(check = new SelfCheck()) {
    if (this._rotationConfig) {
      const { cooldowns, rotations } = this._rotationConfig;
      if (!cooldowns && !rotations) {
        check.fail(
          'Lack of cooldowns and rotations means the system cannot make progress',
        );
      }
    }
    if (this._rotationFailuresInARow > 0) {
      const failuresInARow = this._rotationFailuresInARow;
      check.warn(
        'Last rotation failed. All visit will be currently discarded.',
        {
          failuresInARow,
        },
      );
    }
    if (this._rotationConfigPendingWrite !== null) {
      check.warn('Rotation config modified but not synced to disk yet.');
    }
    return check;
  }

  // visible for testing
  async runRotationChecks(now = Date.now()) {
    return this._criticalSection.run(async () => this._runRotationChecks(now));
  }
}
