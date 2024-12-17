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
import { BadJobError } from './errors';
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
const DB_VERSION = 1;

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

  expireJobs(jobEntries) {
    let pos = 0;
    while (pos < jobEntries.length && this.isJobExpired(jobEntries[pos])) {
      pos += 1;
    }
    return jobEntries.splice(0, pos);
  }

  // Note: smaller is of higher priority
  computePriority(jobEntry) {
    // TODO: this could be improved (though prefer old jobs is not a bad strategy)
    return jobEntry._meta.createdAt;
  }

  compareJobsByPriority(jobEntry1, jobEntry2) {
    if (this.isJobReady(jobEntry1)) {
      return -1;
    } else if (this.isJobReady(jobEntry2)) {
      return 1;
    }
    const prio1 = this.computePriority(jobEntry1);
    const prio2 = this.computePriority(jobEntry2);
    return prio1 - prio2;
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
 *   (TODO: Revisit this statement in the future. It would not be difficult
 *   to add if needed: set an alert and call "processPendingJobs".)
 */
export default class JobScheduler {
  static STATES = ['running', 'ready', 'waiting', 'dlq'];

  static EVENTS = [
    'jobRegistered',
    'jobStarted',
    'jobSucceeded',
    'jobFailed', // TODO: what is the semantic? (permanently failed or retried?)
    'jobExpired',
    'jobRejected',
    'syncedToDisk',
  ];

  constructor({ storage, storageKey }) {
    this.storage = storage;
    this.storageKey = storageKey;

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
      autoRetryAfterError: true,
      maxAutoRetriesAfterError: 3,
      // TODO: maybe add a flag to control if failed jobs should be put in the dlq
      // (and only added back if there was was a successful execution of that type before)
    };
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
    this.handlerConfigs[type] = { ...this.defaultConfig, ...config };
    logger.debug(
      'Registered job handler for',
      type,
      'with config:',
      this.handlerConfigs[type],
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

    if (this.getTotalJobs() >= this.globalJobLimit) {
      this.notifyObservers('jobRejected', 'global job limit reached', jobEntry);
      return;
    }
    const localLimit = this.handlerConfigs[type]?.maxJobsTotal;
    if (localLimit && this.getTotalJobsOfType(type) >= localLimit) {
      this.notifyObservers('jobRejected', 'local job limit reached', jobEntry);
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

  _pushToQueue({ jobEntry, state, now = Date.now() }) {
    this._ensureValidState(state);
    const { type } = jobEntry.job;
    if (!this.jobQueues[type]) {
      this.jobQueues[type] = Object.fromEntries(
        JobScheduler.STATES.map((x) => [x, []]),
      );
    }
    this.jobQueues[type][state] = this.jobQueues[type][state] || [];
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
        try {
          this.notifyObservers('jobStarted', jobEntry);
          newJobs = await this._runJob(jobEntry.job);
          this.notifyObservers('jobSucceeded', jobEntry);
        } catch (e) {
          if (e.isPermanentError) {
            logger.warn('Job failed:', jobEntry.job, e.message);
          } else if (e.isRecoverableError) {
            // TODO: implement retry
            logger.warn('Job failed (skip retry):', jobEntry.job, e);
          } else {
            logger.error('Job failed (unexpected error):', jobEntry.job, e);
          }
          this.notifyObservers('jobFailed', jobEntry);
        } finally {
          now = Date.now();
          this._removeFromRunningQueue(jobEntry, now);
        }

        if (newJobs && newJobs.length > 0) {
          logger.debug('Job', jobEntry.job, 'spawned', newJobs);
          for (const job of newJobs) {
            try {
              this._registerJob(job, now);
            } catch (e) {
              logger.error('Failed to register spawned job:', job, e);
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

  _expireJobsInAllQueue(jobTester) {
    for (const queue of Object.values(this.jobQueue)) {
      this._expireJobsInQueue(queue, jobTester);
    }
  }

  _expireJobsInQueue(queue, jobTester) {
    for (const jobEntry of jobTester.expireJobs(queue)) {
      this.notifyObservers('jobExpired', jobEntry);
    }
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
        this._expireJobsInQueue(ready, jobTester);
        const nextJob = ready.shift();
        if (nextJob) {
          types.unshift(types.pop()); // to improve fairness
          return nextJob;
        }
        this._expireJobsInQueue(waiting, jobTester);
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
          this._sortWaitingQueue(type, jobTester);
          this._expireJobsInQueue(waiting, jobTester);
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
            jobEntries.forEach((x) => this._ensureValidJobEntry(x));
          }
          if (queues.running && queues.running.length > 0) {
            // TODO: potentially add the running job into the queue again (it is repeatible)
            logger.warn(
              'Detected unfinished running jobs (delete them):',
              queues.running,
            );
            queues.running = [];
          }
          for (const state of JobScheduler.STATES) {
            if (queues[state]) {
              this._expireJobsInQueue(queues[state], jobTester);
            }
          }
        } catch (e) {
          logger.warn(
            `Detected corrupted queue for type=<${type}>. Delete and continue...`,
            queues,
            e,
          );
          delete persistedState.jobQueues[type];
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
    if (!this._autoFlushTimer) {
      setTimeout(() => this._writeJobsToDisk(), 0);
    }
  }

  _clearAutoFlushTimer() {
    if (this._autoFlushTimer) {
      clearTimeout(this._autoFlushTimer);
      this._autoFlushTimer = null;
    }
  }

  async _writeJobsToDisk() {
    this._clearAutoFlushTimer();
    return this.storage.set(this.storageKey, {
      dbVersion: DB_VERSION,
      jobQueues: this.jobQueues,
    });
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

  _sortWaitingQueue(type, jobTester) {
    if (!this._precomputed().waitingQueueSortedFlags[type]) {
      jobTester.sortJobs(this.jobQueues[type].waiting);
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
