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

import { expect } from 'chai';
import sinon from 'sinon';
import * as fc from 'fast-check';

import * as tldts from 'tldts-experimental';

import PopularityVoteHandler from '../src/popularity-vote-handler.js';
import { sanitizeHostname } from '../src/popularity-vote-sanitizer.js';
import { requireString, requireUTC } from '../src/utils.js';

import {
  createInMemoryJobScheduler,
  runClockUntilJobQueueIsEmpty,
} from './helpers/in-memory-job-scheduler.js';
import { arbitraryUrlWithDomain } from './helpers/fast-check-utils.js';

const SECOND = 1000;

function computeUrlProjections(url) {
  const { hostname, pathname } = new URL(url);
  const { domain } = tldts.parse(hostname, {
    extractHostname: false,
    mixedInputs: false,
    validateHostname: false,
  });
  return { domain, hostname, hostnamePath: hostname + pathname };
}

class CommunicationStub {
  _messagesSent = [];

  async send(message) {
    this._messagesSent.push({
      message,
      sentAt: Date.now(),
    });
  }
}

class QuorumCheckerStub {
  _overwrites = new Map();
  _default = false;
  _quorumIncCalls = 0;
  _quorumCheckCalls = 0;

  _everythingReachesQuorum() {
    this._default = true;
    this._overwrites.clear();
  }

  _everythingFailsQuorum() {
    this._default = false;
    this._overwrites.clear();
  }

  _everythingFailsQuorumExcept(vote) {
    requireString(vote);
    this._everythingFailsQuorum();
    this._overwrites.set(vote, true);
  }

  async sendQuorumIncrement({ text, now = Date.now() } = {}) {
    requireString(text);
    requireUTC(now);
    this._quorumIncCalls += 1;
  }

  async checkQuorumConsent({ text }) {
    this._quorumCheckCalls += 1;
    return this._overwrites.get(text) ?? this._default;
  }
}

class CountryProviderStub {
  _ctry = '--';

  getSafeCountryCode() {
    return this._ctry;
  }
}

describe('#PopularityVoteHandler', function () {
  // The PopularityVoteHandler constructor registers job handlers
  // as a side-effect. The linter does not understand that.
  // eslint-disable-next-line no-unused-vars
  let uut;
  let clock;

  let jobScheduler;
  let communication;
  let quorumChecker;
  let countryProvider;
  let pauseState;

  function initMocks() {
    clock?.restore();
    clock = sinon.useFakeTimers(new Date('2026-01-01'));

    // Unless a timer was set at least once, clock.jump will fail
    // TODO: we can remove this workaround if this fix is shipped with @sinon:
    // https://github.com/sinonjs/fake-timers/pull/541
    setTimeout(() => {}, 0);

    jobScheduler = createInMemoryJobScheduler();
    communication = new CommunicationStub();
    quorumChecker = new QuorumCheckerStub();
    countryProvider = new CountryProviderStub();
    pauseState = {
      isHostnamePaused(hostname) {
        requireString(hostname);
        return false;
      },
      getFilteringMode() {
        return 'default';
      },
    };
    uut = newPopularityVoteHandler();
  }

  function newPopularityVoteHandler() {
    return new PopularityVoteHandler({
      jobScheduler,
      communication,
      quorumChecker,
      countryProvider,
      pauseState,
    });
  }

  function tearDown() {
    clock?.restore();
    clock = null;
    uut = null;
    jobScheduler = null;
    communication = null;
    quorumChecker = null;
    countryProvider = null;
    pauseState = null;
  }

  beforeEach(initMocks);
  afterEach(tearDown);

  async function expectExactlyTheseSignals(
    prepareVotingJob,
    expectedPayloads,
    { ignoreMasking = false, ignoreFailedJobs = false } = {},
  ) {
    let unexpectedFailedJobs = [];
    jobScheduler.addObserver('jobFailed', (jobEntry, { exception }) => {
      unexpectedFailedJobs.push({ jobEntry, exception });
    });

    await jobScheduler.init();
    try {
      // eliminate any chance of races between the tests
      const messagesSent = communication._messagesSent;
      expect(messagesSent).to.be.empty;

      await jobScheduler.registerJob(prepareVotingJob);
      await runClockUntilJobQueueIsEmpty(jobScheduler, clock);

      if (unexpectedFailedJobs.length > 0 && !ignoreFailedJobs) {
        console.error('Detected failed jobs:', unexpectedFailedJobs);
        throw (
          unexpectedFailedJobs[0].exception || Error('Failed jobs detected')
        );
      }

      let actualPayloads = messagesSent.map(({ message }) => {
        const { action, payload, ver } = message;
        expect(action).to.eql('wtm.popularity');
        expect(ver).to.eql(4);

        // "payload.activity" is an edge case, because random noise will be applied.
        // The best that we can do is a sanity check here, and then ignoring the field.
        const { activity, ...rest } = payload;
        const activityBeforeNoise = prepareVotingJob.args.sample.activity;

        // We could make the test stricter, but the conservative estimation here
        // will hold even if the scaling factor changes in the production code.
        expect(activity).to.be.a('string');
        expect(Number(activity)).to.be.within(0, 2 * activityBeforeNoise);

        return { ...rest, activity: '<ignore>' };
      });
      expectedPayloads = expectedPayloads.map((payload) => ({
        ...payload,
        activity: '<ignore>',
      }));

      if (ignoreMasking) {
        actualPayloads = actualPayloads.map((payload) => ({
          ...payload,
          vote: '<ignore>',
        }));
        expectedPayloads = expectedPayloads.map((payload) => ({
          ...payload,
          vote: '<ignore>',
        }));
      }

      try {
        expect(actualPayloads).to.have.deep.members(expectedPayloads);
      } catch (e) {
        console.error(
          'Mismatch detected: expected messages\n',
          JSON.stringify(expectedPayloads, null, 2),
          '\n---\nBut got:\n',
          JSON.stringify(actualPayloads, null, 2),
        );
        throw e;
      }
    } finally {
      jobScheduler.unload();
    }
  }

  describe('#PopularityVoteHandler', function () {
    describe('simple domain vote that reaches quorum', function () {
      for (const count of [1, 2, 3]) {
        describe(`with count=${count}`, function () {
          it('should send messages with the original domain', async function () {
            const urlProjection = 'domain';
            const countType = 'visits';
            const intervalType = '1d';

            const prepareVotingJob = {
              type: 'popularity-estimator:prepare-voting:v2',
              args: {
                urlProjection,
                countType,
                intervalType,
                sample: {
                  value: 'example.com',
                  count,
                  activity: 42,
                },
              },
            };
            quorumChecker._everythingReachesQuorum();
            countryProvider._ctry = 'de';

            const payload = {
              type: {
                urlProjection,
                countType,
                intervalType,
              },
              vote: 'example.com',
              ctry: 'de',
              adblocker: {
                paused: false,
                mode: 'default',
              },
            };

            const expected = Array(count).fill(payload);
            await expectExactlyTheseSignals(prepareVotingJob, expected);
          });
        });
      }
    });

    describe('simple domain vote that fails quorum', function () {
      for (const count of [1, 2, 3]) {
        describe(`with count=${count}`, function () {
          it('should send messages but mask the domain', async function () {
            const urlProjection = 'domain';
            const countType = 'visits';
            const intervalType = '1d';

            const prepareVotingJob = {
              type: 'popularity-estimator:prepare-voting:v2',
              args: {
                urlProjection,
                countType,
                intervalType,
                sample: {
                  value: 'example.com',
                  count,
                  activity: 42,
                },
              },
            };
            quorumChecker._everythingFailsQuorum();
            countryProvider._ctry = 'fr';

            const payload = {
              type: {
                urlProjection,
                countType,
                intervalType,
              },
              vote: '--',
              ctry: 'fr',
              adblocker: {
                paused: false,
                mode: 'default',
              },
            };

            const expected = Array(count).fill(payload);
            await expectExactlyTheseSignals(prepareVotingJob, expected);
          });
        });
      }
    });

    describe('[property based testing]', function () {
      it('should not crash for arbitrary URLs', async function () {
        this.timeout(60 * SECOND);
        await fc.assert(
          fc
            .asyncProperty(
              arbitraryUrlWithDomain,
              fc.constantFrom('domain', 'hostname', 'hostnamePath'),
              fc.constantFrom('1d', '1w', '4w'),
              fc.integer({ min: 1, max: 3 }),
              async (url, urlProjection, intervalType, count) => {
                const vote = computeUrlProjections(url)[urlProjection];
                const countType = 'visits';

                const prepareVotingJob = {
                  type: 'popularity-estimator:prepare-voting:v2',
                  args: {
                    urlProjection,
                    countType,
                    intervalType,
                    sample: {
                      value: vote,
                      count,
                      activity: 42,
                    },
                  },
                };

                quorumChecker._everythingReachesQuorum();
                countryProvider._ctry = 'de';

                const payload = {
                  type: {
                    urlProjection,
                    countType,
                    intervalType,
                  },
                  vote,
                  ctry: 'de',
                  adblocker: {
                    paused: false,
                    mode: 'default',
                  },
                };
                const expected = Array(count).fill(payload);
                await expectExactlyTheseSignals(prepareVotingJob, expected, {
                  ignoreMasking: true,
                });
                return true;
              },
            )
            .beforeEach(initMocks)
            .afterEach(tearDown),
          { numRuns: 10 },
        );
      });

      it('network requests (quorum and final message) must be sanitized, but pauseState must use the original value', async function () {
        this.timeout(60 * SECOND);
        await fc.assert(
          fc
            .asyncProperty(
              arbitraryUrlWithDomain,
              fc.constantFrom('domain', 'hostname'),
              fc.constantFrom('1d', '1w', '4w'),
              async (url, urlProjection, intervalType) => {
                const projections = computeUrlProjections(url);
                const unmaskedVote = projections[urlProjection];
                const countType = 'visits';

                const { hostname } = new URL(url);
                if (urlProjection === 'domain') {
                  expect(hostname.endsWith(unmaskedVote)).to.be.true;
                } else {
                  expect(unmaskedVote).to.eql(hostname);
                }

                pauseState.isHostnamePaused = (actual) => {
                  expect(actual).to.eql(unmaskedVote); // <- original value
                  return true;
                };

                const vote = sanitizeHostname(unmaskedVote);
                quorumChecker._everythingFailsQuorumExcept(vote); // <- masked value
                countryProvider._ctry = 'de';

                const prepareVotingJob = {
                  type: 'popularity-estimator:prepare-voting:v2',
                  args: {
                    urlProjection,
                    countType,
                    intervalType,
                    sample: {
                      value: unmaskedVote,
                      count: 1,
                      activity: 42,
                    },
                  },
                };

                await expectExactlyTheseSignals(prepareVotingJob, [
                  {
                    type: { urlProjection, countType, intervalType },
                    vote, // <- masked value
                    ctry: 'de',
                    adblocker: {
                      paused: true,
                      mode: 'default',
                    },
                  },
                ]);
                return true;
              },
            )
            .beforeEach(initMocks)
            .afterEach(tearDown),
          { numRuns: 10 },
        );
      });

      /**
       * Sends "numJobs" identical vote jobs through the scheduler and returns
       * the "activity" values of all messages that ended up being sent.
       */
      async function collectNoisyActivities(prepareVotingJob, numJobs) {
        // If we register too many jobs at once, the jobScheduler will start
        // dropping them. So why not flush after each job? Unfortunately, that
        // slows down the test setup too much.
        const flushJobs = 32; // even with 3 votes, it is 3 * 32 < 100

        await jobScheduler.init();
        try {
          for (let i = 0; i < numJobs; i += 1) {
            await jobScheduler.registerJob(prepareVotingJob);
            if ((i + 1) % flushJobs === 0) {
              await runClockUntilJobQueueIsEmpty(jobScheduler, clock);
            }
          }
          await runClockUntilJobQueueIsEmpty(jobScheduler, clock);
          return communication._messagesSent.map(({ message }) =>
            Number(message.payload.activity),
          );
        } finally {
          jobScheduler.unload();
        }
      }

      it('should preserve the mean of "activity" when applying noise', async function () {
        this.timeout(60 * SECOND);

        await fc.assert(
          fc
            .asyncProperty(
              fc.integer({ min: 1, max: 10000 }),
              async (activity) => {
                quorumChecker._everythingReachesQuorum();

                // trade-off: do not set too high, or the test will be too slow.
                // But also it must be high enough, so it is not flakey.
                const numJobs = 80;
                const votesPerJob = 3; // the most that a client may send

                const activities = await collectNoisyActivities(
                  {
                    type: 'popularity-estimator:prepare-voting:v2',
                    args: {
                      urlProjection: 'domain',
                      countType: 'visits',
                      intervalType: '1d',
                      sample: {
                        value: 'example.com',
                        count: votesPerJob,
                        activity,
                      },
                    },
                  },
                  numJobs,
                );
                expect(activities).to.have.lengthOf(numJobs * votesPerJob);

                const mean =
                  activities.reduce((x, y) => x + y, 0) / activities.length;
                expect(mean).to.be.closeTo(activity, 0.1 * activity);

                return true;
              },
            )
            .beforeEach(initMocks)
            .afterEach(tearDown),
          { numRuns: 2, endOnFailure: true },
        );
      });

      it('should apply the noise to each message individually', async function () {
        // Otherwise, votes of the same client would remain trivially linkable.
        // Note that one job is enough: it is the noise within a single job that
        // could be lost (e.g. by drawing it once instead of once per message).
        quorumChecker._everythingReachesQuorum();
        const activities = await collectNoisyActivities(
          {
            type: 'popularity-estimator:prepare-voting:v2',
            args: {
              urlProjection: 'domain',
              countType: 'visits',
              intervalType: '1d',
              sample: { value: 'example.com', count: 3, activity: 42 },
            },
          },
          1,
        );

        // Note: there is a theoretical potential for getting the
        // identical random numbers, but practically it is so
        // unlikely that we can ignore it here.
        expect(new Set(activities).size).to.eql(3);
      });
    });
  });
});
