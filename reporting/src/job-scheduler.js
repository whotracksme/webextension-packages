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
import { randomBetween } from './random';
import { BadJobError, BadJobHandlerError } from './errors';
import SeqExecutor from './seq-executor';
import { equalityCanBeProven } from './utils';
import SelfCheck from './self-check';

/**
 * If you need to introduce incompatible changes to the the job
 * persistence or need to recover from a bug that left the data
 * in a corrupted state, you can bump this number.
 *
 * But be aware that doing it will result in all pending jobs being
 * dropped! To avoid that, you can define an optional migration
 * (see _tryDataMigration).
 */
const DB_VERSION = 2;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

class JobTester {
  constructor(now = Date.now()) {
    this.now = now;
  }

  isJobReady(jobEntry) {
    return this.now >= jobEntry._meta.readyAt;
  }

  isJobExpired(jobEntry) {
    return this.now >= jobEntry._meta.expireAt;
  }

  // Note: this will not guarantee that all expired jobs get removed.
  // It will only look at the jobs at the begin of the queue. Typically,
  // that should be enough to eventually reap them. If you need stronger
  // guarantees, you will have to do a full scan.
  tryExpireJobs(jobEntries) {
    let pos = 0;
    while (pos < jobEntries.length && this.isJobExpired(jobEntries[pos])) {
      pos += 1;
    }
    return jobEntries.splice(0, pos);
  }

  /**
   * Computes the priority of a job. Smaller is of higher priority.
   *
   * When ordering jobs by their priority, the order should remain stable over time.
   * Formally, if "p(t,j)" is the priority function for job "j" at a given time "t",
   * the following property should hold:
   *
   * For all jobs j1,j2 and for all times t1, t2 with t2 > t1:
   * ```
   *   p(t1,j1) <= p(t1,j2)  ==>  p(t2,j1) <= p(t2,j2)
   * ```
   *
   * Note: it automatically holds if p does not rely on the time. In other
   * words, this is a sufficient, but not necessary condition:
   * ```
   *   For all times t1, t2 and for all jobs j: p(t1,j) == p(t2,j)
   * ```
   */
  computePriority(jobEntry) {
    // This will order jobs primarily by the time when they become ready.
    // It also guarantees that jobs that are ready will be sorted before
    // jobs that are still blocked.
    //
    // To break ties between multiple jobs that are ready, it will run the
    // oldest jobs first; thus, eliminating the possiblity of starvation.
    //
    // Note: preserves ordering, since the time is not used.
    return Math.max(jobEntry._meta.createdAt, jobEntry._meta.readyAt);
  }

  compareJobsByPriority(jobEntry1, jobEntry2) {
    return this.computePriority(jobEntry1) - this.computePriority(jobEntry2);
  }

  sortJobs(jobEntries) {
    jobEntries.sort((x, y) => this.compareJobsByPriority(x, y));
  }
}

/**
 * Provides a persisted job queue with jobs that can scheduled in the future.
 * Also, it provides limited support for priorities and throttling.
 *
 * Definition of a job: { type, args, config }
 * - type
 * - args: the scheduler will not into it, but merely passes it on
 * - config (optional): to overwrite job specific configurations
 *
 * Notes:
 * - The args of a job must be trivially serializable. It is recommended to use only:
 *  1) strings
 *  2) finite numbers
 *  3) arrays
 *  4) null
 *  5) nested object (but only with the simple types)
 *
 * Example:
 * {
 *   type: 'test-job',
 *   args: { foo: null, nested: { bar: ["one", 2, 3.0] } },
 * }
 *
 * Throttling:
 * - Only one job will be executed at the same time.
 * - Optionally, you can define cooldowns between jobs of identical category
 *   (these cooldowns will not be persisted, so they should be short lived).
 * - The job scheduler starts with a delay to have a higher chance of running
 *   in the background and not compete with a page load.
 * - Jobs have TTLs and each queue can have size limits. By dropping jobs,
 *   the scheduler can provide stronger guarantees about resource usage.
 *
 * Priorities:
 * - Each job type has an optional static priority. Jobs queue with higher
 *   priorities will be scheduled for execution before jobs with the
 *   lesser priorities.
 * - With queues itself and queues of the same priority, older jobs
 *   will be executed before newer jobs.
 *
 * Note:
 * - At the moment, it is intentionally not installing additional timers
 *   through the alert API. The assumption is that it will still be possible
 *   to clean up the queues fast enough. The second assumption is that
 *   executing jobs when the service worker is already running should be
 *   more resource friendly than waking up the user's device.
 */
export default class JobScheduler {
  static STATES = [
    'running', // jobs are that currently being executed
    'ready', // jobs are ready to be executed (ignoring optional cooldowns)
    'waiting', // jobs that are no ready to start
    'retryable', // jobs that failed with an ephemeral error
  ];

  static EVENTS = [
    'jobRegistered',
    'jobStarted',
    'jobSucceeded',
    'jobFailed',
    'jobExpired',
    'jobRejected',
    'syncedToDisk',
  ];

  constructor({ storage, storageKey }) {
    this.storage = storage;
    this.storageKey = storageKey;
    this._autoFlushTimer = null;

    this.active = false;
    this.handlers = {};
    this.jobExecutor = new SeqExecutor();

    this.defaultTTL = 2 * WEEK;
    this.maxTTL = 6 * MONTH;
    this.globalJobLimit = 10000;

    this.defaultConfig = {
      priority: 0, // higher values will be executed before

      // quotas:
      ttlInMs: this.defaultTTL,
      maxJobsTotal: 1000,

      // throttling:
      cooldownInMs: 0,

      // error handling:
      maxAutoRetriesAfterError: 2, // (give up after three attempts in total)
    };
    this._ensureValidHandlerConfig(this.defaultConfig);
    this.handlerConfigs = {};

    // Note: this data structure is intended to be in a format that can be
    // stored and loaded from local storage. Ideally, use only simple data
    // types (plain objects, arrays, strings and numbers).
    this.jobQueues = {}; // type -> [jobEntry] where jobEntry == { job, _meta }

    this.lastCheck = 0; // Unix epoch
    this.nextCheckTimer = null;

    // local cooldowns (not persisted across restarts)
    this.cooldowns = {}; // type -> Unix epoch
    this._resetPrecomputed();

    this._observers = Object.fromEntries(
      JobScheduler.EVENTS.map((event) => [event, []]),
    );
    this.stats = Object.fromEntries(
      JobScheduler.EVENTS.map((event) => [event, 0]),
    );
  }

  registerHandler(type, handler, config = {}) {
    const fullConfig = { ...this.defaultConfig, ...config };
    this._ensureValidHandlerConfig(fullConfig);

    if (this.active) {
      logger.warn(
        'Job handler for type',
        type,
        'was register when the scheduler is already running.',
        'This is an anti-pattern, because it introduces a race',
        '(jobs will be dropped if their handler is installed too late)',
      );
    }
    if (this.handlers[type]) {
      logger.warn('Redefining handler for type:', type);
    }
    this.handlers[type] = handler;
    this.handlerConfigs[type] = fullConfig;
    logger.debug(
      'Registered job handler for',
      type,
      'with config:',
      fullConfig,
    );
    this._resetPrecomputed();
  }

  addObserver(eventType, cb, { ignoreAfterInitWarning = false } = {}) {
    if (!this._observers[eventType]) {
      throw new Error(`Unknown event type: ${eventType}`);
    }
    if (this.active && !ignoreAfterInitWarning) {
      logger.warn(
        'Observer for event',
        eventType,
        'was added when the scheduler was already running.',
        'This is an anti-pattern because it may introduce a race.',
      );
    }
    this._observers[eventType].push(cb);
  }

  notifyObservers(eventType, ...args) {
    const handlers = this._observers[eventType];
    if (!handlers) {
      throw new Error(`Internal error: unknown event type: ${eventType}`);
    }

    this.stats[eventType] += 1;
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch (e) {
        logger.error(
          `Unexpected error in observer of type=${eventType}:`,
          ...args,
          e,
        );
      }
    }
  }

  async init() {
    this.active = true;
    this._scheduleProcessPendingJobs();
  }

  async ready() {
    if (!this._ready) {
      this._ready = this._restoreJobsFromDisk();
    }
    await this._ready;
  }

  /**
   * Synchronizes the cached and persisted state.
   */
  async sync() {
    await this.ready();
    await this._writeJobsToDisk();
    this.notifyObservers('syncedToDisk');
  }

  unload() {
    this.active = false;
    this._clearNextCheckTimer();
    this._clearAutoFlushTimer();
  }

  async registerJob(job, { now = Date.now(), autoTrigger = true } = {}) {
    return this.registerJobs([job], { now, autoTrigger });
  }

  async registerJobs(jobs, { now = Date.now(), autoTrigger = true } = {}) {
    await this.ready();
    jobs.forEach((job) => this._registerJob(job, now));
    if (autoTrigger) {
      this._scheduleProcessPendingJobs();
    }
  }

  _registerJob(job, now = Date.now()) {
    this._ensureValidJob(job);
    const { type } = job;
    if (!this.handlers[type]) {
      logger.warn(
        'Trying to initialize a job for type',
        type,
        'which  no handler is present',
      );
    }
    const config = job.config || {};

    const createdAt = now;

    // The "readyIn" field exists for convenience and can be converted
    // the absolute time in "readyAt". It must define a non-negative
    // "min" value and an optional "max" value (if you want randomness).
    //
    // Examples:
    // - { min: 2000 } will delay by (at least) 2 seconds
    // - { min: 2000, max: 3000 } will delay by (at least) 2-3 seconds
    //
    // Note: the real delay can be higher, since there is no guarantee
    // that the job will be executed as soon it is ready for execution.
    const toReadyAt = (readyIn) => {
      if (readyIn === undefined || readyIn === null) {
        return undefined;
      }
      let { min = -1, max } = readyIn;
      if (min < 0) {
        throw new BadJobError(
          'Config error: readyIn must be present and non-negative',
        );
      }

      max = max ?? min;
      if (max > this.maxTTL) {
        throw new BadJobError('Config error: readyIn must not exceed maxTTL');
      }
      return now + randomBetween(min, max);
    };

    // If a job does not define an absolute time when it can be run,
    // assume that it is immediately ready.
    const readyAt = config.readyAt ?? toReadyAt(config.readyIn) ?? 0;
    if (!Number.isFinite(readyAt)) {
      throw new BadJobError(`readyAt is invalid: ${readyAt}`);
    }

    // If a job defines an absolute time in "expireAt", take it;
    // otherwise, use a relative TTL (with fallbacks).
    // Note: TTLs are enforced here to improve fault tolerance.
    let { expireAt } = config;
    if (!expireAt) {
      const ttl =
        config.ttlInMs ?? this.handlerConfigs[type]?.ttlInMs ?? this.maxTTL;
      expireAt = now + ttl;
    }
    if (expireAt > now + this.maxTTL) {
      expireAt = now + this.maxTTL;
      logger.warn("job's TTL has been truncated:", job);
    }

    const jobEntry = {
      job,
      _meta: {
        createdAt,
        readyAt,
        expireAt,
      },
    };

    const { ok, reason } = this._checkJobLimits(type, now);
    if (!ok) {
      this.notifyObservers('jobRejected', jobEntry, reason);
      return;
    }

    this.notifyObservers('jobRegistered', job);
    if (now < expireAt) {
      this._pushToQueue({ jobEntry, state: 'waiting', now });
    } else {
      logger.warn('New job immediately expired:', jobEntry);
      this.notifyObservers('jobExpired', jobEntry);
    }
  }

  _checkJobLimits(jobType, now = Date.now()) {
    const reject = (reason) => ({ ok: false, reason });
    const ok = () => ({ ok: true });

    const localLimit = this.handlerConfigs[jobType]?.maxJobsTotal;
    if (localLimit && this.getTotalJobsOfType(jobType) >= localLimit) {
      // Before giving up, make a best-effort attempt to expire local jobs.
      // Not guaranteed to find something, since it will only look at the
      // start of the queue; yet it is likely that expired jobs are
      // in front.
      const {
        ready = [],
        waiting = [],
        retryable = [],
      } = this.jobQueues[jobType];

      const jobTester = new JobTester(now);
      if (
        this._tryExpireJobsInQueue(waiting, jobTester).numExpired === 0 &&
        this._tryExpireJobsInQueue(ready, jobTester).numExpired === 0 &&
        this._tryExpireJobsInQueue(retryable, jobTester).numExpired === 0
      ) {
        const deletedJob = retryable.shift();
        if (deletedJob) {
          logger.warn('Dropping oldest failed job to free space for new job:', {
            deletedJob,
          });
          this._markAsDirty();
          return ok(); // early exit since we now freed room for one job
        } else {
          return reject('local job limit reached');
        }
      }
    }

    // Currently, there are no attempts to clean up other queues.
    // That is intentional.
    //
    // The rationale is that the global job limit should be conservative
    // enough that a single queue cannot fill it. But when getting
    // near the global limits, it is likely that there are already
    // so many jobs in the system that slowing down by rejecting
    // jobs looks like a good idea anyways; it might drop more jobs
    // than necessary, but should reduce load on the system.
    if (this.getTotalJobs() >= this.globalJobLimit) {
      return reject('global job limit reached');
    }

    return ok();
  }

  _pushToQueue({ jobEntry, state, now = Date.now() }) {
    this._ensureValidState(state);
    const { type } = jobEntry.job;
    this.jobQueues[type] ||= Object.fromEntries(
      JobScheduler.STATES.map((x) => [x, []]),
    );
    this.jobQueues[type][state] ||= [];

    const len = this.jobQueues[type][state].length;
    if (len > 0 && state === 'waiting') {
      const lastJob = this.jobQueues[type][state][len - 1];
      if (new JobTester(now).compareJobsByPriority(lastJob, jobEntry) > 0) {
        this._markWaitingQueueAsUnsorted(type);
      }
    }
    this.jobQueues[type][state].push(jobEntry);
    this._markAsDirty();
  }

  _tryPushToRetryableQueue(jobEntry, now = Date.now()) {
    const { job, _meta } = jobEntry;

    let attemptsLeft;
    if (Number.isInteger(_meta.attemptsLeft)) {
      attemptsLeft = _meta.attemptsLeft - 1;
    } else {
      attemptsLeft =
        job.config?.maxAutoRetriesAfterError ??
        this.handlerConfigs[job.type]?.maxAutoRetriesAfterError ??
        this.defaultConfig.maxAutoRetriesAfterError;
    }
    if (attemptsLeft <= 0) {
      return false;
    }

    const retryJob = {
      job,
      _meta: {
        ..._meta,

        // Little detail: setting it to "now" will guarantee that it is at
        // the end of the queue (in contrast to 0). By design, all jobs in
        // the retry job are always ready (otherwise they would not have
        // been executed before).
        readyAt: now,
        attemptsLeft,
      },
    };
    this._pushToQueue({ jobEntry: retryJob, state: 'retryable', now });
    return true;
  }

  _removeFromRunningQueue(jobEntry, now = Date.now()) {
    const { type } = jobEntry.job;
    if (this.jobQueues[type].running.pop()) {
      const { cooldownInMs = 0 } = this.handlerConfigs[type];
      if (cooldownInMs > 0) {
        this.cooldowns[type] = now + cooldownInMs;
      }
      this._markAsDirty();
    }
  }

  async processPendingJobs({
    maxJobsToRun = Number.MAX_SAFE_INTEGER,
    autoResumeAfterCooldowns = false,
  } = {}) {
    this._clearNextCheckTimer();
    if (!this.active) {
      return;
    }
    await this.ready();
    await this.jobExecutor.run(async () => {
      let numJobsExecuted = 0;
      let now = Date.now();
      while (this.active) {
        if (numJobsExecuted >= maxJobsToRun) {
          autoResumeAfterCooldowns = false;
          break;
        }
        numJobsExecuted += 1;
        const jobEntry = this._findNextJobToRun(now);
        if (!jobEntry) {
          break;
        }
        this._pushToQueue({ jobEntry, state: 'running', now });
        let newJobs;
        let success = false;
        try {
          this.notifyObservers('jobStarted', jobEntry);
          newJobs = (await this._runJob(jobEntry.job)) || [];
          success = true;
          this.notifyObservers('jobSucceeded', jobEntry);
        } catch (e) {
          let pendingRetry = false;
          if (e.isPermanentError) {
            logger.error('Job failed:', jobEntry.job, e.message);
          } else if (e.isRecoverableError) {
            if (this._tryPushToRetryableQueue(jobEntry, now)) {
              pendingRetry = true;
              logger.warn('Job failed (pushed for retry):', jobEntry.job, e);
            } else {
              logger.error('Job failed (no more retries):', jobEntry.job, e);
            }
          } else {
            logger.error('Job failed (unexpected error):', jobEntry.job, e);
          }
          this.notifyObservers('jobFailed', jobEntry, {
            pendingRetry,
            exception: e,
          });
        } finally {
          now = Date.now();
          this._removeFromRunningQueue(jobEntry, now);
        }

        if (success) {
          if (newJobs.length > 0) {
            logger.debug('Job', jobEntry.job, 'spawned', newJobs);
            for (const job of newJobs) {
              try {
                this._registerJob(job, now);
              } catch (e) {
                logger.error('Failed to register spawned job:', job, e);
              }
            }
          }

          const { type } = jobEntry.job;
          const { retryable = [] } = this.jobQueues[type];
          if (retryable.length > 0) {
            this._tryExpireJobsInQueue(retryable, new JobTester(now));
            if (retryable.length > 0) {
              const jobEntry = this.jobQueues[type].retryable.shift();
              logger.debug(
                'Reinserting previously failed job into the ready queue:',
                jobEntry.job,
              );
              this._pushToQueue({ jobEntry, state: 'ready', now });
            }
          }
        }
      }
    });

    if (
      this.nextCheckTimer === null &&
      autoResumeAfterCooldowns &&
      this.active
    ) {
      const now = Date.now();
      const expirations = [];
      for (const [type, expireAt] of Object.entries(this.cooldowns)) {
        if (expireAt !== null && this.jobQueues[type].ready.length > 0) {
          logger.debug('Jobs of type', type, 'are being throttled...');
          expirations.push(expireAt - now);
        }
      }
      if (expirations.length > 0) {
        const delayInMs = Math.max(Math.min(...expirations), 0);
        logger.debug('Scheduling next job to run in', delayInMs, 'ms');
        this._scheduleProcessPendingJobs({ delayInMs });
      }
    }
  }

  _tryExpireJobsInQueue(queue, jobTester) {
    const expiredJobs = jobTester.tryExpireJobs(queue);
    const numExpired = expiredJobs.length;
    if (numExpired > 0) {
      this._markAsDirty();
      for (const jobEntry of expiredJobs) {
        this.notifyObservers('jobExpired', jobEntry);
      }
    }
    return { numExpired, expiredJobs };
  }

  _findNextJobToRun(now = Date.now()) {
    const jobTester = new JobTester(now);

    for (const types of this.queuesByPriority) {
      // 1) if there is a ready job, take it
      const queuesToRescan = [];
      for (const type of types) {
        if (this.cooldowns[type]) {
          if (now < this.cooldowns[type]) {
            continue;
          }
          this.cooldowns[type] = null;
        }
        const { ready = [], waiting = [] } = this.jobQueues[type] || {};
        this._tryExpireJobsInQueue(ready, jobTester);
        const nextJob = ready.shift();
        if (nextJob) {
          types.unshift(types.pop()); // to improve fairness
          return nextJob;
        }
        this._tryExpireJobsInQueue(waiting, jobTester);
        if (waiting.length > 0) {
          queuesToRescan.push(type);
        }
      }

      // 2) no ready job found, so scan the waiting jobs
      let bestPrio;
      let bestType = null;
      for (const type of queuesToRescan) {
        const { waiting = [] } = this.jobQueues[type];
        if (waiting.length > 0) {
          this._sortWaitingQueue(type, jobTester, { removeExpiredJobs: true });
          let pos = 0;
          while (pos < waiting.length && jobTester.isJobReady(waiting[pos])) {
            pos += 1;
          }
          if (pos > 0) {
            const newReady = waiting.splice(0, pos);
            this.jobQueues[type].ready = newReady;
            const prio = jobTester.computePriority(newReady[0]);
            if (!bestType || prio < bestPrio) {
              bestPrio = prio;
              bestType = type;
            }
          }
        }
      }
      if (bestType) {
        return this.jobQueues[bestType].ready.shift();
      }
    }

    return null;
  }

  async _runJob(job) {
    const handler = this.handlers[job.type];
    if (!handler) {
      throw new Error(`Unexpected type: ${job.type}`);
    }
    return handler(job);
  }

  _scheduleProcessPendingJobs({
    delayInMs = 2000,
    autoResumeAfterCooldowns = true,
  } = {}) {
    if (this.nextCheckTimer === null) {
      this.nextCheckTimer = setTimeout(() => {
        this.nextCheckTimer = null;
        this.processPendingJobs({ autoResumeAfterCooldowns }).catch(
          logger.error,
        );
      }, delayInMs);
    }
  }

  _clearNextCheckTimer() {
    clearTimeout(this.nextCheckTimer);
    this.nextCheckTimer = null;
  }

  async _restoreJobsFromDisk() {
    let persistedState = await this.storage.get(this.storageKey);
    if (persistedState && persistedState.dbVersion !== DB_VERSION) {
      logger.warn(
        'DB_VERSION of persisted jobs does not match:',
        persistedState.dbVersion,
        '!=',
        DB_VERSION,
      );
      try {
        persistedState = this._tryDataMigration(persistedState);
        if (persistedState && persistedState.dbVersion !== DB_VERSION) {
          logger.warn('Migration forget to update DB_VERSION. Fixing it...');
          persistedState.dbVersion = DB_VERSION;
        }
      } catch (e) {
        logger.error(
          'Failed to migrate state. Dropping the state:',
          persistedState,
          e,
        );
        persistedState = null;
      }
    }

    if (persistedState?.jobQueues) {
      const now = Date.now();
      const jobTester = new JobTester(now);
      const isJobCreationTimeOK = ({ _meta }) => _meta.createdAt < now + DAY;

      for (const [type, queues] of Object.entries(persistedState.jobQueues)) {
        try {
          if (!queues) {
            throw new Error('Missing queue');
          }
          for (const [state, jobEntries] of Object.entries(queues)) {
            this._ensureValidState(state);
            if (!Array.isArray(jobEntries)) {
              throw new Error(`Bad job queue in state=${state}`);
            }

            const corruptedJobs = [];
            jobEntries.forEach((jobEntry) => {
              this._ensureValidJobEntry(jobEntry);

              if (!isJobCreationTimeOK(jobEntry)) {
                // Note: this is an ultra-rare edge case where the system clock
                // was in the future while registering the job. Purging them
                // may be necessary, since these jobs may otherwise be blocked
                // for years - eating up slots and eventually preventing new
                // jobs from being registered.
                corruptedJobs.push(jobEntry);
              }
            });

            if (corruptedJobs.length > 0) {
              logger.warn(
                'Detected clock jump. Purging affected jobs:',
                corruptedJobs,
              );
              queues[state] = [...jobEntries].filter(isJobCreationTimeOK);
              this._markAsDirty();
            }
          }
          if (queues.running && queues.running.length > 0) {
            // TODO: potentially add the running job into the queue again (it is repeatible)
            logger.warn(
              'Detected unfinished running jobs (delete them):',
              queues.running,
            );
            queues.running = [];
            this._markAsDirty();
          }

          let alive = 0;
          for (const state of JobScheduler.STATES) {
            if (queues[state]) {
              this._tryExpireJobsInQueue(queues[state], jobTester);
              alive += queues[state].length;
            }
          }
          if (alive === 0 && !this.handlers[type]) {
            logger.info(
              'Cleaning up empty queue of type:',
              type,
              '(likely dead, since no handler was found)',
            );
            delete persistedState.jobQueues[type];
            this._markAsDirty();
          }
        } catch (e) {
          logger.warn(
            `Detected corrupted queue for type=<${type}>. Delete and continue...`,
            queues,
            e,
          );
          delete persistedState.jobQueues[type];
          this._markAsDirty();
        }
      }
      this.jobQueues = persistedState.jobQueues;

      logger.info(
        'Successfully restored jobQueue:',
        this.getTotalJobs(),
        'jobs in total',
      );
      logger.debug('Restored jobQueue:', this.jobQueues);
    } else {
      logger.info(
        'No persisted jobs found.',
        'This should only happen on the first time the extension is started',
        '(or in rare cases if the data format changed).',
      );
    }
  }

  _markAsDirty() {
    if (this._autoFlushTimer === null) {
      this._pendingFlush = setTimeout(() => {
        this._writeJobsToDisk().catch((e) => {
          logger.error('Failed to write jobs', e);
        });
      }, 0);
    }
  }

  _clearAutoFlushTimer() {
    if (this._autoFlushTimer !== null) {
      clearTimeout(this._autoFlushTimer);
      this._autoFlushTimer = null;
    }
  }

  async _writeJobsToDisk() {
    this._clearAutoFlushTimer();

    // [Experiment] Potential workaround for a Safari bug:
    // * we see indicators that Safari corrupts the data when there
    //   are concurrent write operation to chrome.storage.local
    // * as a mitigation, serialize the writes now
    this._writeToDiskExecutor ||= new SeqExecutor();
    return this._writeToDiskExecutor.run(async () =>
      this.storage.set(this.storageKey, {
        dbVersion: DB_VERSION,
        jobQueues: this.jobQueues,
      }),
    );
  }

  /**
   * This hook is intended to support data migration after a version change.
   * Whether a (full or partial) migration should be attempted, depends on
   * the concrete situation.
   *
   * The default implemenation of discarding the old state (returning "null")
   * is always correct; depending on how difficult it is to migrate, it can
   * be the best solution. For instance, if you are forced to increased the
   * version to recover from a bug that corrupted the data. However, purging
   * jobs will temporarily lead to a drop of signals. If you want to avoid
   * that, you can migrate jobs (either all or only selected types).
   */
  _tryDataMigration(persistedState) {
    // -- begin of 1 ==> 2 (2025-07) ---
    const log = (...args) => logger.info('[migrate: 1=>2]', ...args);
    if (persistedState.dbVersion === 1) {
      log('Migrating jobs...');
      for (const queue of Object.values(persistedState.jobQueues)) {
        if (queue.dlq) {
          log('"dlq" renamed as "retryable"');
          queue.retryable = queue.dlq;
          delete queue.dlq;
        }
      }
      persistedState.dbVersion = 2;
      log('Migrating jobs...DONE');
    }
    if (persistedState.dbVersion === 2) {
      return persistedState;
    }
    // -- end of 1 ==> 2 migration ---

    logger.warn(
      'DB_VERSION changed. Discarding the old state:',
      persistedState,
    );
    return null;
  }

  /**
   * This function exists primarily for testing and troubleshooting.
   * It is not intended to be used by other components.
   *
   * Since the use case are limited, there are also no performance constraints.
   * Thus, do not try to tune data structures for this function.
   */
  _describeJobs() {
    const byType = Object.fromEntries(
      Object.entries(this.jobQueues).map(([type, queue]) => {
        const all = [];
        const byState = {};
        for (const state of JobScheduler.STATES) {
          const jobs = queue[state] || [];
          jobs.forEach((x) => all.push(x));
          byState[state] = [...jobs];
        }
        return [type, { all, byState }];
      }),
    );
    const all = Object.values(byType).flatMap((x) => x.all);
    const byState = {};
    Object.values(this.jobQueues).forEach((queues) => {
      JobScheduler.STATES.forEach((state) => {
        byState[state] = byState[state] || [];
        (queues[state] || []).forEach((job) => byState[state].push(job));
      });
    });
    return {
      active: this.active,
      handlers: Object.keys(this.handlers),
      queues: {
        all,
        byState,
        byType,
      },
      queueLength: all.length,
    };
  }

  // [[type]] (first set of queues are of highest priority)
  get queuesByPriority() {
    return this._precomputed().queuesByPriority;
  }

  _markWaitingQueueAsUnsorted(type) {
    if (this._cachedPrecomputed?.waitingQueueSortedFlags[type]) {
      this._cachedPrecomputed.waitingQueueSortedFlags[type] = false;
    }
  }

  _sortWaitingQueue(type, jobTester, { removeExpiredJobs = false } = {}) {
    if (removeExpiredJobs) {
      this._tryExpireJobsInQueue(this.jobQueues[type].waiting, jobTester);
    }

    if (!this._precomputed().waitingQueueSortedFlags[type]) {
      jobTester.sortJobs(this.jobQueues[type].waiting);
      if (removeExpiredJobs) {
        this._tryExpireJobsInQueue(this.jobQueues[type].waiting, jobTester);
      }
      this._precomputed().waitingQueueSortedFlags[type] = true;
    }
  }

  getTotalJobsOfType(type) {
    let count = 0;
    const queue = this.jobQueues[type];
    if (queue) {
      for (const state of JobScheduler.STATES) {
        if (queue[state]) {
          count += queue[state].length;
        }
      }
    }
    return count;
  }

  getTotalJobs() {
    let count = 0;
    for (const queue of Object.values(this.jobQueues)) {
      for (const state of JobScheduler.STATES) {
        if (queue[state]) {
          count += queue[state].length;
        }
      }
    }
    return count;
  }

  getTotalJobsWaitingForRetry() {
    let count = 0;
    for (const queue of Object.values(this.jobQueues)) {
      if (queue.retryable) {
        count += queue.retryable.length;
      }
    }
    return count;
  }

  _precomputed() {
    if (!this._cachedPrecomputed) {
      // Group the different types into set with the same priority and sort
      // them, so in the final two-dim array, the first set has max priority.
      const queueSet = {};
      for (const [type, { priority }] of Object.entries(this.handlerConfigs)) {
        queueSet[priority] = queueSet[priority] || [];
        queueSet[priority].push(type);
      }
      const queuesByPriority = Object.entries(queueSet)
        .sort(([prio1], [prio2]) => prio2 - prio1)
        .map((x) => x[1]);

      this._cachedPrecomputed = {
        queuesByPriority,
        waitingQueueSortedFlags: {},
      };
    }
    return this._cachedPrecomputed;
  }

  _resetPrecomputed() {
    this._cachedPrecomputed = null;
  }

  _ensureValidJob(job) {
    if (typeof job?.type !== 'string') {
      throw new BadJobError('invalid job: expected a "type"');
    }
  }

  _ensureValidJobMetaData(_meta) {
    if (!_meta) {
      throw new BadJobError('no meta data found');
    }
    for (const timestamp of ['expireAt', 'readyAt', 'createdAt']) {
      if (!Number.isFinite(_meta[timestamp])) {
        throw new BadJobError(`${timestamp} corrupted`);
      }
    }
  }

  _ensureValidJobEntry({ job, _meta }) {
    this._ensureValidJob(job);
    this._ensureValidJobMetaData(_meta);
  }

  _ensureValidState(state) {
    if (!JobScheduler.STATES.includes(state)) {
      throw new Error(`Invalid state: ${state}`);
    }
  }

  // Validates the config that is passed when registering job handlers.
  _ensureValidHandlerConfig(config) {
    if (!config) {
      throw new BadJobHandlerError('Missing config');
    }
    let numCheckedKeys = 0;
    const expectInt = (key, extraCheck) => {
      if (!Number.isInteger(config[key])) {
        throw new BadJobHandlerError(
          `Expected field "${key}" to be an integer, but got: ${config[key]}`,
        );
      }
      if (extraCheck && !extraCheck(config[key])) {
        throw new BadJobHandlerError(
          `Illegal value found in field "${key}": <<${config[key]}>>`,
        );
      }
      numCheckedKeys += 1;
    };
    const nonNegative = (x) => x >= 0;

    expectInt('priority');
    expectInt('ttlInMs', nonNegative);
    expectInt('maxJobsTotal', nonNegative);
    expectInt('cooldownInMs', nonNegative);
    expectInt('maxAutoRetriesAfterError', nonNegative);

    if (numCheckedKeys !== Object.keys(config).length) {
      const unexpectedKeys = Object.keys(config).filter(
        (key) => !Object.hasOwn(this.defaultConfig, key),
      );
      throw new BadJobHandlerError(
        `Invalid config: found unexpected keys: [${unexpectedKeys.join(', ')}]`,
      );
    }
  }

  async selfChecks(check = new SelfCheck()) {
    const restoredJobs = JSON.parse(JSON.stringify(this.jobQueues));
    if (!equalityCanBeProven(this.jobQueues, restoredJobs)) {
      check.warn('Jobs may lose information when persisting and restoring');
    }

    const numJobsInTotal = this.getTotalJobs();
    if (numJobsInTotal > this.globalJobLimit) {
      check.warn('total number of jobs in the queue exceeds the global limit', {
        numJobsInTotal,
        globalJobLimit: this.globalJobLimit,
      });
    }

    for (const [type, queue] of Object.entries(this.jobQueues)) {
      if (
        !this.handlers[type] &&
        JobScheduler.STATES.some(
          (state) => queue[state] && queue[state].length > 0,
        )
      ) {
        check.warn(`Found jobs with type=${type} that have no handler`, queue);
      }
    }

    const jobDesc = this._describeJobs();

    // all jobs must be well-formed
    const corruptedJobEntries = [];
    for (const jobEntry of jobDesc.queues.all) {
      try {
        this._ensureValidJobEntry(jobEntry);
      } catch (e) {
        corruptedJobEntries.push({ jobEntry, error: `${e}` });
      }
    }
    if (corruptedJobEntries.length > 0) {
      check.fail('Corrupted job entries found', {
        total: corruptedJobEntries.length,
        samples: corruptedJobEntries.slice(0, 10),
      });
    }

    // the job's configurations should not include unknown fields
    // (these fields will be ignored, so it is an indicator of a logical bug)
    const expectedKeys = [
      'readyAt',
      'readyIn',
      'expireAt',
      'expireIn',
      ...Object.keys(this.defaultConfig),
    ];
    const unexpectedConfigs = [];
    for (const { job } of jobDesc.queues.all) {
      const unexpectedKeys = Object.keys(job.config || {}).filter(
        (x) => !expectedKeys.includes(x),
      );
      if (unexpectedKeys.length > 0) {
        unexpectedConfigs.push({ job, unexpectedKeys });
      }
    }
    if (unexpectedConfigs.length > 0) {
      check.warn('Unexpected keys in the config found', {
        total: unexpectedConfigs.length,
        samples: unexpectedConfigs.slice(0, 10),
        expectedKeys,
      });
    }

    // TODO: warn if there are jobs that should have run long time ago

    return check;
  }
}
