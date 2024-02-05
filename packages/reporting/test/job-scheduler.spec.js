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

import { expect, assert } from 'chai';
import sinon from 'sinon';
import * as fc from 'fast-check';

import JobScheduler from '../src/job-scheduler.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function mockStorage(storageKey) {
  return {
    async get(key) {
      expect(key).to.equal(storageKey);
      return this._content;
    },
    async set(key, obj) {
      expect(key).to.equal(storageKey);
      this._content = obj;
    },
  };
}

describe('#JobScheduler', function () {
  const storageKey = 'some-storage-key';
  let uut;
  let storage;
  let clock;

  async function passesSelfChecks() {
    const checks = await uut.selfChecks();
    if (!checks.allPassed()) {
      const fullReport = JSON.stringify(checks.report(), null, 2);
      const shortReport = JSON.stringify(checks.report().log.failures, null, 2);
      assert.fail(
        `self checks failed:\n${fullReport}:\n\nThis is the error:\n${shortReport}`,
      );
    }
  }

  function initMocks() {
    clock?.restore();
    clock = sinon.useFakeTimers(new Date('2020-01-01'));
    storage = mockStorage(storageKey);
    uut = newJobScheduler();
  }

  function newJobScheduler() {
    return new JobScheduler({
      storage,
      storageKey,
    });
  }
  // Helper that simulate an event like a restart of the service worker/background script:
  // it keeps the storage but purges everything that was in memory.
  async function simulateRestart() {
    uut.unload();
    uut = newJobScheduler();
  }

  function tearDown() {
    uut?.unload();
    uut = null;

    clock?.restore();
    clock = null;
    storage = null;
  }

  beforeEach(initMocks);
  afterEach(tearDown);

  function someJob(type = 'testjob') {
    return { type };
  }

  async function runScriptedScenario({
    jobs,
    events,
    runPeriodicSelfChecks = true,
  }) {
    let step = -1;
    try {
      let handlers;
      const installHandlers = () => {
        handlers = {};
        for (const { type, config = {}, handler = () => {} } of jobs) {
          expect(type).to.be.a('string');
          handlers[type] = handler;
          uut.registerHandler(type, handler, config);
        }
      };
      installHandlers();

      await uut.init();
      for (const { times = 1, ...event } of events) {
        step += 1;
        for (let i = 0; i < times; i += 1) {
          if (runPeriodicSelfChecks) {
            await passesSelfChecks();
          }
          if (event.run) {
            const [cmd, ...args] = event.run;
            if (cmd === 'new') {
              expect(args).to.have.a.lengthOf(1);
              let job;
              if (typeof args[0] === 'string') {
                job = { type: args[0] };
              } else {
                job = args[0];
              }
              await uut.registerJob(job);
            } else if (cmd === 'await-all') {
              await clock.runAllAsync();
            } else if (cmd === 'wait') {
              expect(args).to.have.a.lengthOf(1);
              await clock.tickAsync(args[0]);
            } else if (cmd === 'suspend') {
              expect(args).to.have.a.lengthOf(1);
              clock.jump(args[0]);
            } else if (cmd === 'process') {
              await uut.processPendingJobs();
            } else if (cmd === 'restart') {
              await simulateRestart();
              installHandlers();
              await uut.init();
            } else {
              assert.fail(`Unexpected run command: ${cmd}`);
            }
          } else if (event.assume) {
            if (typeof event.assume === 'function') {
              // user-defined hook
              event.assume();
            } else {
              const state = uut._describeJobs();
              const allStats = { ...state, ...uut.stats };
              for (const [key, value] of Object.entries(event.assume)) {
                expect(allStats[key]).to.eql(value);
              }
            }
          } else {
            assert.fail(`Unexpected command: ${event}`);
          }
        }
      }
      await clock.runAllAsync();
      if (runPeriodicSelfChecks) {
        await passesSelfChecks();
      }
    } catch (e) {
      const events_ = events.map((x, i) => ({ step: i, ...x }));
      const scenario = JSON.stringify({ jobs, events_ }, null, 2);
      const where =
        step === -1
          ? 'at init'
          : `at step #${step} (${JSON.stringify(events[step])})`;
      console.error(
        `Scenario:\n\n---\n${scenario}\nScenario failed ${where}:\nError:`,
        e,
      );
      throw e;
    }
  }

  describe('#init', function () {
    it('load + unload should not fail', async function () {
      await uut.init();
      uut.unload();
    });

    it('should support multiple init and unload calls', async function () {
      await uut.init();
      await uut.init();
      uut.unload();
      uut.unload();
    });

    it('should support concurrent init calls', async function () {
      const pending = [uut.init(), uut.init(), uut.init()];
      await Promise.all([pending]);
      uut.unload();
    });
  });

  describe('should enforce limits', function () {
    it('global job limit', async function () {
      let jobRejectedEvents = 0;
      uut.addObserver('jobRejected', () => {
        jobRejectedEvents += 1;
      });

      uut.registerHandler(someJob().type, () => {});
      expect(uut.globalJobLimit).to.be.at.least(10);
      uut.globalJobLimit = 10; // to speed up the test

      await uut.init();
      for (let i = 0; i < uut.globalJobLimit; i += 1) {
        await uut.registerJob(someJob());
        expect(jobRejectedEvents).to.eql(0);
        expect(uut.stats.jobRegistered).to.eql(i + 1);
        expect(uut.stats.jobRejected).to.eql(0);
        expect(uut.getTotalJobs()).to.eql(i + 1);
      }

      // now the limit is reached and jobs will be rejectec
      await uut.registerJob(someJob());
      expect(jobRejectedEvents).to.eql(1);
      expect(uut.stats.jobRegistered).to.eql(uut.globalJobLimit);
      expect(uut.stats.jobRejected).to.eql(1);
      expect(uut.getTotalJobs()).to.eql(uut.globalJobLimit);

      await uut.init();
    });

    it('local job limit', async function () {
      let jobRejectedEvents = 0;
      uut.addObserver('jobRejected', () => {
        jobRejectedEvents += 1;
      });

      const maxJobs = 4;
      const throttled = 'throttled';
      const nonThrottled = 'non-throttled';
      expect(uut.globalJobLimit).to.be.at.least(2 * maxJobs + 1);

      uut.registerHandler(throttled, () => {}, {
        maxJobsTotal: maxJobs,
      });
      uut.registerHandler(nonThrottled, () => {});

      await uut.init();
      for (let i = 0; i < maxJobs; i += 1) {
        await uut.registerJob(someJob(throttled));
        expect(jobRejectedEvents).to.eql(0);
        expect(uut.stats.jobRegistered).to.eql(i + 1);
        expect(uut.stats.jobRejected).to.eql(0);
        expect(uut.getTotalJobs()).to.eql(i + 1);
      }

      // now the limit is reached and jobs will be rejected
      await uut.registerJob(someJob(throttled));
      expect(jobRejectedEvents).to.eql(1);
      expect(uut.stats.jobRegistered).to.eql(maxJobs);
      expect(uut.stats.jobRejected).to.eql(1);
      expect(uut.getTotalJobs()).to.eql(maxJobs);
      expect(uut.getTotalJobsOfType(throttled)).to.eql(maxJobs);
      expect(uut.getTotalJobsOfType(nonThrottled)).to.eql(0);

      // but must still allow to register other jobs
      jobRejectedEvents = 0;
      for (let i = 0; i < maxJobs + 1; i += 1) {
        await uut.registerJob(someJob(nonThrottled));
      }
      expect(jobRejectedEvents).to.eql(0);
      expect(uut.getTotalJobsOfType(nonThrottled)).to.eql(maxJobs + 1);

      await uut.init();
    });
  });

  describe('when initialized', function () {
    it('should pass self checks', async function () {
      await uut.init();
      await passesSelfChecks();
      await clock.runAllAsync();
      await passesSelfChecks();
    });

    it('should allow to trigger processPendingJobs when the queue is empty', async function () {
      await uut.init();
      await uut.processPendingJobs();
      await passesSelfChecks();
    });

    it('should allow to trigger parallel processPendingJobs when the queue is empty', async function () {
      await uut.init();
      await Promise.all([
        uut.processPendingJobs(),
        uut.processPendingJobs(),
        uut.processPendingJobs(),
      ]);
      await passesSelfChecks();
    });

    it('should allow to processPendingJobs when the queue, but jobs are registered', async function () {
      uut.registerHandler('dummy', () => expect.fail('should never be called'));
      await uut.init();
      await uut.processPendingJobs();
      await passesSelfChecks();
    });

    it('should allow to run one job', async function () {
      let numJobsExecuted = 0;
      uut.registerHandler(someJob().type, async () => {
        numJobsExecuted += 1;
      });
      await uut.init();

      expect(uut._describeJobs().queueLength).to.eql(0);
      expect(uut.stats.jobRegistered).to.eql(0);
      expect(uut.stats.jobStarted).to.eql(0);
      expect(uut.stats.jobSucceeded).to.eql(0);
      expect(uut.stats.jobFailed).to.eql(0);
      expect(uut.stats.jobRejected).to.eql(0);

      await uut.registerJob(someJob());
      expect(uut._describeJobs().queueLength).to.eql(1);
      expect(uut.stats.jobRegistered).to.eql(1);
      expect(uut.stats.jobStarted).to.eql(0);
      expect(uut.stats.jobSucceeded).to.eql(0);
      expect(uut.stats.jobFailed).to.eql(0);
      expect(uut.stats.jobRejected).to.eql(0);

      await uut.processPendingJobs();
      expect(numJobsExecuted).to.eql(1);
      expect(uut._describeJobs().queueLength).to.eql(0);
      expect(uut.stats.jobRegistered).to.eql(1);
      expect(uut.stats.jobStarted).to.eql(1);
      expect(uut.stats.jobSucceeded).to.eql(1);
      expect(uut.stats.jobFailed).to.eql(0);
      expect(uut.stats.jobRejected).to.eql(0);
    });

    describe('should allow to run multiple, different jobs of same priority', async function () {
      for (const { types, jobsPerType } of [
        { types: ['testjob1', 'testjob2'], jobsPerType: 1 },
        { types: ['testjob1', 'testjob2'], jobsPerType: 3 },
        { types: ['testjob1', 'testjob2', 'testjob3'], jobsPerType: 5 },
      ]) {
        it(`- types=${types} and ${jobsPerType} jobs per type`, async function () {
          const jobs = [];
          const numJobsExecuted = {};

          for (const type of types) {
            numJobsExecuted[type] = 0;
            uut.registerHandler(type, async () => {
              numJobsExecuted[type] += 1;
            });
          }
          for (let i = 0; i < jobsPerType; i += 1) {
            for (const type of types) {
              jobs.push(someJob(type));
            }
          }

          await uut.init();
          await uut.registerJobs(jobs);
          expect(uut._describeJobs().queueLength).to.eql(jobs.length);
          await passesSelfChecks();

          await uut.processPendingJobs();
          for (const type of types) {
            expect(numJobsExecuted[type]).to.eql(jobsPerType);
          }
          expect(uut._describeJobs().queueLength).to.eql(0);
        });
      }
    });
  });

  describe('should allow to run multiple, different jobs of different priorities', async function () {
    for (const { types, jobsPerType } of [
      { types: ['testjob1', 'testjob2'], jobsPerType: 1 },
      { types: ['testjob1', 'testjob2'], jobsPerType: 3 },
      { types: ['testjob1', 'testjob2', 'testjob3'], jobsPerType: 5 },
    ]) {
      it(`- types=${types} and ${jobsPerType} jobs per type`, async function () {
        const jobs = [];
        const realExecutionOrder = [];

        const priorityMap = {
          testjob1: 3, // should run first
          testjob2: 2,
          testjob3: 1,
        };

        for (const type of types) {
          const config = { priority: priorityMap[type] };
          uut.registerHandler(
            type,
            () => realExecutionOrder.push(type),
            config,
          );
        }
        for (let i = 0; i < jobsPerType; i += 1) {
          for (const type of types) {
            jobs.push(someJob(type));
          }
        }

        await uut.init();
        await uut.registerJobs(jobs);
        expect(uut._describeJobs().queueLength).to.eql(jobs.length);
        await passesSelfChecks();

        await uut.processPendingJobs();
        expect(uut._describeJobs().queueLength).to.eql(0);

        const expectedExecutionOrder = jobs
          .map(({ type }) => type)
          .sort((x, y) => priorityMap[y] - priorityMap[x]);
        expect(realExecutionOrder).to.eql(expectedExecutionOrder);
      });
    }
  });

  describe('should allow jobs to spawn other jobs', function () {
    it('spawning jobs of the same type', async function () {
      const type = 'testjob';
      let nextJobId = 0;
      const newJob = ({ jobsToSpawn }) => {
        const jobId = nextJobId;
        nextJobId += 1;
        return { type, args: { jobsToSpawn, jobId } };
      };

      const finishedJobs = new Set();
      const markJobAsDone = (job) => {
        const { jobId } = job.args;
        expect(finishedJobs).not.to.include(jobId);
        finishedJobs.add(jobId);
      };
      const expectJobIsDone = (job) => {
        expect(finishedJobs).to.include(job.args.jobId);
      };

      uut.registerHandler(type, async (job) => {
        const { jobsToSpawn } = job.args;
        markJobAsDone(job);
        return jobsToSpawn;
      });
      await uut.init();

      // job1 -> null (does not spawn)
      const job1 = newJob({ jobsToSpawn: null });
      await uut.registerJob(job1);
      await uut.processPendingJobs();
      expectJobIsDone(job1);
      expect(uut.stats.jobRegistered).to.equal(1);
      expect(uut.stats.jobSucceeded).to.eql(1);

      // job2 -> undefined (does not spawn)
      const job2 = newJob({ jobsToSpawn: undefined });
      await uut.registerJob(job2);
      await uut.processPendingJobs();
      expectJobIsDone(job2);
      expect(uut.stats.jobRegistered).to.equal(2);
      expect(uut.stats.jobSucceeded).to.eql(2);

      // job3 -> [] (does not spawn)
      const job3 = newJob({ jobsToSpawn: [] });
      await uut.registerJob(job3);
      await uut.processPendingJobs();
      expectJobIsDone(job3);
      expect(uut.stats.jobRegistered).to.equal(3);
      expect(uut.stats.jobSucceeded).to.eql(3);

      // job4 -> job5
      //      -> job6 -> job7
      const job7 = newJob({ jobsToSpawn: [] });
      const job6 = newJob({ jobsToSpawn: [job7] });
      const job5 = newJob({ jobsToSpawn: [] });
      const job4 = newJob({ jobsToSpawn: [job5, job6] });
      await uut.registerJob(job4);
      await uut.processPendingJobs();
      expectJobIsDone(job4);
      expectJobIsDone(job5);
      expectJobIsDone(job6);
      expectJobIsDone(job7);
      expect(uut.stats.jobRegistered).to.equal(7);
      expect(uut.stats.jobSucceeded).to.eql(7);
    });
  });

  describe('after an extension restart', function () {
    it('should restore jobs', async function () {
      await uut.init();
      expect(uut._describeJobs().queueLength).to.eql(0);

      await simulateRestart();
      await uut.init();
      expect(uut._describeJobs().queueLength).to.eql(0);
      await clock.runAllAsync();

      await uut.registerJob(someJob());
      expect(uut._describeJobs().queueLength).to.eql(1);

      await uut.sync();
      await clock.runAllAsync();

      await simulateRestart();
      await uut.init();
      await uut.sync();
      expect(uut._describeJobs().queueLength).to.eql(1);
    });
  });

  describe('[scripted scenarios]', function () {
    describe('[cooldown]', function () {
      it('two jobs with a one second cooldown', async function () {
        const jobs = [{ type: 'testjob1', config: { cooldownInMs: 1000 } }];
        const events = [
          { run: ['await-all'] },
          { run: ['new', 'testjob1'], times: 2 },
          { assume: { queueLength: 2 } },
          { run: ['process'] },
          { assume: { queueLength: 1 } },
          { run: ['process'] },
          { assume: { queueLength: 1 } },
          { run: ['wait', 2000] },
          { run: ['process'] },
          { assume: { queueLength: 0 } },
        ];
        await runScriptedScenario({ jobs, events });
      });
    });
  });

  /**
   * To guarantee that jobs will not time out.
   */
  function configWithoutTimeouts() {
    return {
      maxWait: 1 * HOUR,
      minTTL: 1000 * YEAR,
      maxTTL: 1000 * YEAR,
      minReadyIn: 0,
      mayReadyIn: 2 * SECOND,
      maxCooldown: 2 * SECOND,
      maxClockJump: 2 * SECOND,
    };
  }

  /**
   * To guarantee that jobs will not be dropped due quotes.
   */
  function configWithoutQuotas() {
    return {
      maxJobsPerType: 10000000,
    };
  }

  function arbitraryScenario({
    minEvents = 1,
    maxEvents = 500,
    maxWait = 7 * DAY,
    maxRepeat = 10, // optionally adds "times" attributes to repeatible jobs
    maxJobTypes = 20,
    minReadyIn = 0,
    maxReadyIn = 1 * MONTH,
    minTTL = 1 * SECOND,
    maxTTL = 12 * MONTH,
    maxJobsPerType = 10000,
    maxCooldown = 24 * HOUR,
    maxAutoRetriesAfterError = 100,
    maxClockJump = 6 * MONTH, // also simulates if a machines goes to sleep
  } = {}) {
    const numToJobType = (x) => `testjob${x}`;
    const arbitraryJobType = () => fc.nat(maxJobTypes - 1).map(numToJobType);
    const arbitraryJobArgs = () => fc.array(fc.nat());
    const arbitraryJobConfig = () => {
      return fc.record({
        priority: fc.option(fc.integer()),
        ttlInMs: fc.option(fc.integer({ min: minTTL, max: maxTTL })),
        readyIn: fc.option(
          fc.record({
            min: fc.nat(minReadyIn),
            max: fc.option(fc.integer({ min: minReadyIn, max: maxReadyIn })),
          }),
        ),
        maxJobsTotal: fc.option(fc.nat(fc.nat(1, maxJobsPerType))),
        cooldownInMs: fc.option(fc.nat(maxCooldown)),
        autoRetryAfterError: fc.option(fc.boolean()),
        maxAutoRetriesAfterError: fc.option(fc.nat(maxAutoRetriesAfterError)),
      });
    };
    const arbitraryJob = () => {
      return fc
        .tuple(
          arbitraryJobType(),
          fc.option(arbitraryJobArgs()),
          fc.option(arbitraryJobConfig()),
        )
        .map(([type, args, config]) => ({
          type,
          args,
          config,
        }));
    };

    const arbitraryTimes = () => fc.option(fc.nat(maxRepeat));

    const arbitraryEvent = () => {
      return fc.oneof(
        // ["new", <job>]:
        fc
          .tuple(arbitraryJob(), arbitraryTimes())
          .map(([job, times]) => ({ run: ['new', job], times })),

        // ["await-all"]:
        fc.constant({ run: ['await-all'] }),

        // ["wait", <delay>]:
        fc.nat(maxWait).map((delay) => ({ run: ['wait', delay] })),

        // ["process"]:
        fc.constant({ run: ['process'] }),

        // ["restart"]:
        fc.constant({ run: ['restart'] }),

        // ["suspend", <clock-jump>]:
        fc.nat(maxClockJump).map((time) => ({ run: ['suspend', time] })),
      );
    };

    return fc
      .record({
        events: fc.array(arbitraryEvent(), {
          minLength: minEvents,
          maxLength: maxEvents,
        }),
        configs: fc.infiniteStream(arbitraryJobConfig()),
        runPeriodicSelfChecks: fc.boolean(),
      })
      .map(({ events, configs, runPeriodicSelfChecks }) => {
        const seenTypes = new Set();
        const jobs = [];
        for (const ev of events) {
          if (ev.run && ev.run[0] === 'new') {
            const { type } = ev.run[1];
            if (!seenTypes.has(type)) {
              seenTypes.add(type);
              const config = configs.next().value;
              jobs.push({ type, config });
            }
          }
        }
        return {
          jobs,
          events,
          runPeriodicSelfChecks,
        };
      });
  }

  describe('[property based testing]', function () {
    it('should not throw in random scenarios', async function () {
      this.timeout(20 * SECOND);
      await fc.assert(
        fc
          .asyncProperty(arbitraryScenario(), runScriptedScenario)
          .beforeEach(initMocks)
          .afterEach(tearDown),
      );
    });

    it('should eventually complete all jobs it runs consistently', async function () {
      this.timeout(20 * SECOND);
      await fc.assert(
        fc
          .asyncProperty(
            arbitraryScenario({
              ...configWithoutTimeouts(),
              ...configWithoutQuotas(),
            }),
            async (scenario) => {
              scenario.events.push({ assume: { jobExpired: 0 } });
              await runScriptedScenario(scenario);
            },
          )
          .beforeEach(initMocks)
          .afterEach(tearDown),
      );
    });
  });
});
