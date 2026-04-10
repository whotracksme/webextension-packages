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

import PopularityEstimator from '../src/popularity-estimator.js';

import { randomSafeIntBetween } from '../src/random.js';
import { createInMemoryJobScheduler } from './helpers/in-memory-job-scheduler.js';
import InMemoryDatabase from './helpers/in-memory-database.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
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

describe('#PopularityEstimator', function () {
  let uut;
  let clock;

  let storage;
  let storageKey;
  let inMemoryDatabases;
  let connectDatabase;

  let jobScheduler;
  let jobsRegistered;

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
    clock = sinon.useFakeTimers(new Date('2026-01-01'));

    // Unless a timer was set at least once, clock.jump will fail
    // TODO: we can remove this workaround if this fix is shipped with @sinon:
    // https://github.com/sinonjs/fake-timers/pull/541
    setTimeout(() => {}, 0);

    storageKey = 'some-key';
    storage = mockStorage(storageKey);
    inMemoryDatabases = new Map();
    connectDatabase = (name) => {
      let db = inMemoryDatabases.get(name);
      if (!db) {
        db = new InMemoryDatabase();
        inMemoryDatabases.set(name, db);
      }
      return db;
    };

    jobsRegistered = [];

    // do not write into the active jobsRegistered array
    const _jobsRegistered = jobsRegistered;

    jobScheduler = createInMemoryJobScheduler();
    jobScheduler.addObserver('jobRegistered', (job) => {
      expect(job.type).to.eql('popularity-estimator:prepare-voting:v1');
      expect(job.args).to.have.all.keys(
        'urlProjection',
        'countType',
        'intervalType',
        'sample',
      );
      expect(job.args.sample).to.have.all.keys('value', 'count');
      expect(job.args.sample.value).to.be.a('string');
      expect(job.args.sample.count).to.be.a('number').greaterThan(0);

      _jobsRegistered.push(job);
    });

    uut = newPopularityEstimator();
  }

  function newPopularityEstimator() {
    return new PopularityEstimator({
      storage,
      storageKey,
      connectDatabase,
      jobScheduler,
    });
  }

  function tearDown() {
    clock?.restore();
    clock = null;
    uut = null;
    storage = null;
    storageKey = null;
    inMemoryDatabases = null;
    connectDatabase = null;
    jobScheduler = null;
    jobsRegistered = null;
  }

  // Helper that simulates an event like a restart of the service worker/background script:
  // it keeps the storage, but purges everything that was in memory.
  async function simulateRestart() {
    for (const [name, db] of [...inMemoryDatabases]) {
      inMemoryDatabases.set(name, db._clone());
    }
    uut = newPopularityEstimator();
  }

  beforeEach(initMocks);
  afterEach(tearDown);

  function navigateTo(location, { isHistoryNavigation = false } = {}) {
    let url;
    if (location.startsWith('http://') || location.startsWith('https://')) {
      url = location;
    } else {
      url = `https://${location}`;
    }

    const event = {
      type: 'safe-page-navigation',
      url,
      isHistoryNavigation,
    };
    uut.onPageEvent(event);
  }

  async function ensureAllRotationsStarted() {
    await uut.runRotationChecks();
    await clock.tickAsync(1 * YEAR);
    await clock.runToLastAsync();
  }

  async function ensureAllRotationsFinished() {
    await clock.tickAsync(1 * YEAR);
    await clock.runToLastAsync();
  }

  async function endTestByForcingRotation() {
    // This sequence triggers the processing. Note that after this point,
    // there should be no more interactions; otherwise the dummy test
    // might be drawn as a sample.
    await uut.init();
    await ensureAllRotationsFinished();
    navigateTo('dummy-location-to-force-rotation.test');
  }

  async function expectNoPreparedVotes() {
    await clock.runToLastAsync();
    expect(jobsRegistered).to.eql([]);
  }

  async function expectPreparedVotes(condition = {}) {
    await clock.runToLastAsync();
    expect(jobsRegistered).to.be.not.empty;

    const { matchesDomain } = condition;
    if (matchesDomain) {
      for (const job of jobsRegistered) {
        if (
          job.args.sample.value !== matchesDomain &&
          !job.args.sample.value.startsWith(`${matchesDomain}/`)
        ) {
          const job_ = JSON.stringify(job, null, 2);
          assert.fail(
            `Expected all jobs to match the domain ${matchesDomain}. Stopped at:\n${job_}`,
          );
        }
      }
    }
  }

  describe('#init', function () {
    it('load + unload should not fail', async () => {
      expect(uut.active).to.be.false;
      await uut.init();
      expect(uut.active).to.be.true;
      uut.unload();
      expect(uut.active).to.be.false;
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

  describe('when not initialized', function () {
    it('should ignore events when not active (no waiting)', async () => {
      expect(uut.active).to.be.false;

      navigateTo('example.test');
      await expectNoPreparedVotes();
    });

    it('should ignore events when not active (with waiting)', async () => {
      expect(uut.active).to.be.false;

      await ensureAllRotationsStarted();
      for (let i = 0; i < 100; i += 1) {
        navigateTo('example.test');
        await clock.tickAsync(10 * MINUTE);
      }

      await endTestByForcingRotation();
      await expectNoPreparedVotes();
    });
  });

  describe('when initialized', function () {
    beforeEach(async () => {
      await uut.init(); // this initializes only lazily
      navigateTo('some-random-visit-to-trigger-a-full-initialization.test');
      await clock.runToLastAsync();
    });

    afterEach(() => uut?.unload());

    it('should pass health checks once initialized', async () => {
      await passesSelfChecks();
    });

    describe('when jobScheduler.registerJobs fails', function () {
      // Documents current behavior: a registerJobs failure is silently
      // swallowed, samples are lost (counters were already cleared by the
      // rotation), and the estimator does NOT enter the failure-retry path.
      // If you change this behavior, update this test.
      it('swallows the failure and drops the rotation samples', async () => {
        await ensureAllRotationsStarted();

        // Generate enough visits that a rotation will have something to sample.
        for (let i = 0; i < 50; i += 1) {
          navigateTo(`example${i}.test`);
          await clock.tickAsync(1 * MINUTE);
        }
        await uut.flush();

        // Force registerJobs to fail just before the rotation drains samples.
        const registerJobs = sinon
          .stub(jobScheduler, 'registerJobs')
          .rejects(new Error('simulated registerJobs failure'));

        // Drive a rotation past expireAt and trigger processing.
        await ensureAllRotationsFinished();
        navigateTo('trigger-rotation.test');
        await clock.runToLastAsync();

        // The failure was swallowed: rotation checks completed normally and
        // the estimator did NOT enter its failure-retry path.
        expect(registerJobs.called).to.be.true;
        expect(uut._rotationFailuresInARow).to.equal(0);

        // No jobs reached the scheduler observer (registerJobs was stubbed),
        // so jobsRegistered is empty.
        expect(jobsRegistered).to.eql([]);

        // Sample loss: counters were cleared as part of the failed rotation,
        // so a subsequent successful rotation cannot recover them. Restore
        // registerJobs and force another rotation cycle — there should be no
        // residual samples from the previous period.
        registerJobs.restore();
        const before = jobsRegistered.length;
        await ensureAllRotationsFinished();
        navigateTo('trigger-second-rotation.test');
        await clock.runToLastAsync();
        const newJobs = jobsRegistered.slice(before);
        for (const job of newJobs) {
          expect(
            job.args.sample.value,
            'a job sampled from the previous (cleared) period leaked through',
          ).to.not.match(/^example\d+\.test/);
        }
      });
    });

    describe('#flush', function () {
      describe('it should not lose state after an extension restart', function () {
        it('when flush is explicitly called', async () => {
          await ensureAllRotationsStarted();

          navigateTo('example.test');
          await uut.flush();

          simulateRestart();

          await endTestByForcingRotation();
          await expectPreparedVotes({ matchesDomain: 'example.test' });
        });

        it('after the automatic triggering of flush', async () => {
          await ensureAllRotationsStarted();

          navigateTo('example.test');
          await clock.runToLastAsync();

          simulateRestart();

          await endTestByForcingRotation();
          await expectPreparedVotes({ matchesDomain: 'example.test' });
        });
      });
    });

    /**
     * Returns an ES6 map from unique URLs to a visit counter, for example:
     *
     * Map(2) { 'https://foo.test/' => 42, 'https://bar.test/' => 17 }
     */
    function arbitraryVisitedUrlDistribution({
      // unless there are clashes, a batch is roughly a visited URL
      minNumberOfBatches = 1,
      maxNumberOfBatches = 10,

      // controls how often a visited URL (in one batch) should be counted
      minVisitsPerBatch = 1,
      maxVisitsPerBatch = 1000,
    } = {}) {
      return fc
        .array(
          fc.record({
            url: fc.webUrl(),
            numVisits: fc.integer({
              min: minVisitsPerBatch,
              max: maxVisitsPerBatch,
            }),
          }),
          { minLength: minNumberOfBatches, maxLength: maxNumberOfBatches },
        )
        .map((batches) => {
          const distribution = new Map();
          batches.forEach(({ url, numVisits }) => {
            distribution.set(url, (distribution.get(url) || 0) + numVisits);
          });
          return distribution;
        });
    }

    describe('[property based testing]', function () {
      it('should not crash on arbitrary URLs', async function () {
        this.timeout(20 * SECOND);
        await fc.assert(
          fc
            .asyncProperty(
              fc.record({
                urlDistribution: arbitraryVisitedUrlDistribution({
                  maxNumberOfBatches: 32,
                  maxVisitsPerBatch: 4,
                }),
                quickDelayInMs: fc.integer({ min: 0, max: 20 * SECOND }),
                slowDelayInMs: fc.integer({
                  min: 20 * SECOND,
                  max: 15 * MINUTE,
                }),
                firstHistoryNavigation: fc.integer({ min: 1, max: 2 }),
                withDailyRestarts: fc.boolean(),
              }),
              async ({
                urlDistribution,
                quickDelayInMs,
                slowDelayInMs,
                firstHistoryNavigation,
                withDailyRestarts,
              }) => {
                await uut.init();
                await passesSelfChecks();

                for (let outer = 0; outer < 4; outer += 1) {
                  // so we reach at least one real monthly rotation (cooldown + one month)
                  await passesSelfChecks();
                  clock.jump(1 * WEEK);

                  if (withDailyRestarts) {
                    await clock.runToLastAsync();
                    simulateRestart();
                    await uut.init();
                  }

                  for (let inner = 0; inner < 3; inner += 1) {
                    for (const [url, count] of urlDistribution) {
                      for (
                        let sameVisit = 0;
                        sameVisit < count;
                        sameVisit += 1
                      ) {
                        // simulate quick navigations to the same URL
                        navigateTo(url, {
                          isHistoryNavigation:
                            sameVisit >= firstHistoryNavigation,
                        });
                        if (quickDelayInMs > 0) {
                          clock.tick(quickDelayInMs);
                        }
                      }

                      // longer time between navigations to a different URL
                      await clock.tickAsync(slowDelayInMs);
                      await passesSelfChecks();
                    }
                  }
                }
                await clock.runToLastAsync();
                await passesSelfChecks();

                const mustExist = (expectedField, expectedValue) => {
                  const found = jobsRegistered.some(
                    (job) => job.args[expectedValue] !== expectedValue,
                  );
                  if (!found) {
                    const jobs_ = JSON.stringify(jobsRegistered, null, 2);
                    assert.fail(
                      `Expected at least one job with ${expectedValue}=${expectedValue}. Instead got:\n${jobs_}`,
                    );
                  }
                };

                expect(jobsRegistered).to.be.not.empty;
                mustExist('intervalType', '1d');
                mustExist('intervalType', '1w');
                mustExist('intervalType', '4w');
                mustExist('countType', 'visits');
                mustExist('urlProjection', 'domain');
                mustExist('urlProjection', 'hostname');
                mustExist('urlProjection', 'hostnamePath');
              },
            )
            .beforeEach(initMocks)
            .afterEach(tearDown),
          { numRuns: 3, endOnFailure: true },
        );
      });

      it('given enough samples, it should support eventually learn the distribution', async function () {
        this.timeout(20 * SECOND);

        await fc.assert(
          fc
            .asyncProperty(
              // Only consider distributions where there is a significant
              // increase from element to element, but also not too much.
              // Otherwise, we need either too many samples or risk that the
              // test becomes flakey.
              //
              // Note: the problem is that the JavaScript tests are extremely slow.
              // I was not able to track it down; it is suprisingly not CPU bound,
              // but seems related with the time mocking. In simulations, I can
              // confirm that theoretically, it converts reliably for any number great
              // than 1. But in this test environment, everything is so slow that
              // the number of samples that we can work with is tiny. Therefore, we
              // have to pick examples that lead to fast convergence.
              //
              // The design that we use to construct the distribution:
              // - pick any starting value for the base weight (theoretically, it
              //   should not mattern and practically keep it small, before we are
              //   using intentionally a slow, but simple mechanism to pick samples
              //   based on their weight.
              fc.integer({ min: 1, max: 100 }),
              // - Based on the starting weight, we compute the next one by scaling
              //   the previous one and ensuring that it is at least one larger.
              //
              // Theoretically, max could be anything and min could be any number > 1.0.
              // But remember that if you create distributions like these
              //
              // - [1, 10000000000]
              // - [10000000000, 10000000001]
              // - [1, 2, 10000000000, 10000000001]
              //
              // ... they will converge, but you will need easily millions of samples.
              // In this current test setup, it will be impractical, since you will get
              // only a few samples per second.
              fc.array(
                fc.double({
                  min: 1.5,
                  max: 4,
                  noDefaultInfinity: true,
                  noNaN: true,
                }),
                {
                  // To make it easier to pass on CI.
                  // increase this number locally to make it much harder
                  minLength: 1,
                  maxLength: 3,
                },
              ),

              // Simulates a huge clock jump:
              fc.integer({
                // The round where it happens. On CI, we force it to be almost instantly
                // to get rid of all cooldowns, speeding up the tests. Locally, you use
                // arbitrary integers here, or let it use negative values to turn off
                // the jump completely.
                //
                min: 0, // locally, you can use negative values. But for CI, enforce the jump.
                max: 10,
              }),
              fc.integer({
                // this ensures that the cooldowns are practically skipped.
                min: 4 * WEEK - 1 * DAY,
                max: 3 * MONTH,
              }),
              async (
                startingWeight,
                factors,
                hugeClockJumpAt,
                hugeClockJumpInMs,
              ) => {
                const distributionWeights = [startingWeight];
                for (const factor of factors) {
                  const nextWeight = distributionWeights.at(-1) * factor;
                  distributionWeights.push(1 + Math.round(nextWeight));
                }

                const toUrl = (id) =>
                  `https://sub${id}.domain${id}.com/path/${id}`;

                // Reverse mapping: "value" can be any of the following:
                // - domain: domain123.com
                // - hostname: sub123.domain123.com
                // - hostnamePath: sub123.domain123.com/123
                //
                // By construction, we can just look at the first number.
                const sampleToId = (value) => {
                  const match = value.match(/[0-9]+/);
                  if (!match) {
                    assert.fail(`Bad sample received: <<${value}>>`);
                  }
                  const id = Number.parseInt(match[0], 10);
                  expect(id)
                    .to.be.at.least(0)
                    .and.lessThan(distributionWeights.length);
                  return id;
                };

                // id: 0 (lowest weight)
                // ...
                // id: N (highest weight, most likely)
                //
                // where
                // N = distributionWeights.length - 1;
                const urlDistribution = distributionWeights.map(
                  (weight, id) => [toUrl(id), weight],
                );

                const expandedUrls = urlDistribution.flatMap(([url, weight]) =>
                  Array(weight).fill(url),
                );
                const randomPageVisit = () => {
                  const pos = randomSafeIntBetween(0, expandedUrls.length - 1);
                  navigateTo(expandedUrls[pos]);
                };

                const toKey = ({ countType, intervalType, urlProjection }) =>
                  JSON.stringify([countType, intervalType, urlProjection]);
                const unpackKey = (key) => {
                  const [countType, intervalType, urlProjection] =
                    JSON.parse(key);
                  return { countType, intervalType, urlProjection };
                };

                const idsSeen = {};
                for (const countType of ['visits']) {
                  for (const intervalType of ['1d', '1w', '4w']) {
                    for (const urlProjection of [
                      'domain',
                      'hostname',
                      'hostnamePath',
                    ]) {
                      const key = toKey({
                        countType,
                        intervalType,
                        urlProjection,
                      });
                      idsSeen[key] = Array(distributionWeights.length).fill(0);
                    }
                  }
                }

                // Since the lowest ID represents the most unlikely URL and the
                // highest ID the most likely, we are done if the number of hits
                // are strictly increasing.
                const matchesRealDistributionOrder = (hits) => {
                  expect(hits.length).to.eql(distributionWeights.length);
                  for (let i = 0; i < hits.length - 1; i += 1) {
                    if (hits[i] >= hits[i + 1]) {
                      return false;
                    }
                  }
                  return true;
                };

                await uut.init();

                const stepSizeInMs = 10 * MINUTE;
                for (let run = 0; run < 1_000_000; run += 1) {
                  randomPageVisit();
                  clock.tick(stepSizeInMs);

                  // This is critical to get the async operations being processed.
                  for (let i = 0; i < 100; i += 1) {
                    await Promise.resolve();
                  }

                  if (run === hugeClockJumpAt) {
                    await clock.runToLastAsync();
                    clock.jump(hugeClockJumpInMs);
                  }

                  // Simulate weekends, but also has the side-effect that we
                  // are advancing faster to the 4-week period, which are
                  // the most difficult to approximate.
                  if (run % Math.round(WEEK / stepSizeInMs) === 0) {
                    clock.jump(2 * DAY);
                  }
                  if (run % Math.round((3 * WEEK) / stepSizeInMs) === 0) {
                    clock.jump(2 * WEEK);
                  }
                  if (run % Math.round((8 * WEEK) / stepSizeInMs) === 0) {
                    clock.jump(6 * WEEK);
                  }

                  if (jobsRegistered.length > 0) {
                    while (jobsRegistered.length > 0) {
                      const job = jobsRegistered.shift();
                      const { countType, intervalType, urlProjection, sample } =
                        job.args;

                      const key = toKey({
                        countType,
                        intervalType,
                        urlProjection,
                      });
                      if (!idsSeen[key]) {
                        const job_ = JSON.stringify(job, null, 2);
                        assert.fail(
                          `Unexpected values detected in job:\n${job_}`,
                        );
                      }
                      idsSeen[key][sampleToId(sample.value)] += sample.count;
                    }
                    if (
                      Object.values(idsSeen).every(matchesRealDistributionOrder)
                    ) {
                      // Example: [10, 27, 63] -> [0.1, 0.27, 0.63]
                      const normalizeDistribution = (arr) => {
                        const sum = arr.reduce((acc, val) => acc + val, 0);
                        return arr.map((val) => val / sum);
                      };

                      // 1 = perfect alignment (same direction), 0 = orthogonal
                      const cosineSimilarity = (v1, v2) => {
                        let dot = 0;
                        let mag1 = 0;
                        let mag2 = 0;
                        for (let i = 0; i < v1.length; i++) {
                          dot += v1[i] * v2[i];
                          mag1 += v1[i] * v1[i];
                          mag2 += v2[i] * v2[i];
                        }
                        return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
                      };

                      const realDist =
                        normalizeDistribution(distributionWeights);
                      for (const [key, hits] of Object.entries(idsSeen)) {
                        const empiricDist = normalizeDistribution(hits);
                        const similarity = cosineSimilarity(
                          empiricDist,
                          realDist,
                        );
                        const { intervalType } = unpackKey(key);
                        const expectedSimilarity = (() => {
                          switch (intervalType) {
                            case '1d':
                              return 0.85;
                            case '1w':
                              return 0.8;
                            case '4w':
                              return 0.75;
                            default:
                              throw new Error(
                                `Internal error: did not expect to see ${intervalType}`,
                              );
                          }
                        })();
                        if (similarity < expectedSimilarity) {
                          console.error(
                            'Failed to approximate the distribution:\n',
                            'Failed at:',
                            key,
                            'distributionWeights:\n',
                            JSON.stringify(distributionWeights, null, 2),
                            '\n\nidsSeen:\n',
                            JSON.stringify(idsSeen, null, 2),
                            '\n\nSimilarity is',
                            similarity,
                            'but expected at least',
                            expectedSimilarity,
                          );
                          return false;
                        }
                      }
                      return true; // test passed
                    }
                  }
                }

                console.error(
                  'Run out of iterations before learning the order of the real distribution:\n',
                  'distributionWeights:\n',
                  JSON.stringify(distributionWeights, null, 2),
                  '\n\nidsSeen:\n',
                  JSON.stringify(idsSeen, null, 2),
                );
                return false;
              },
            )
            .beforeEach(initMocks)
            .afterEach(tearDown),
          { numRuns: 3, endOnFailure: true },
        );
      });
    });
  });
});
