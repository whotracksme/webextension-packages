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
import { requireString, requireUTC } from '../src/utils.js';

import {
  createInMemoryJobScheduler,
  runClockUntilJobQueueIsEmpty,
} from './helpers/in-memory-job-scheduler.js';

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
    { ignoreMasking = false } = {},
  ) {
    await jobScheduler.init();
    try {
      // eliminate any chance of races between the tests
      const messagesSent = communication._messagesSent;
      expect(messagesSent).to.be.empty;

      await jobScheduler.registerJob(prepareVotingJob);
      await runClockUntilJobQueueIsEmpty(jobScheduler, clock);

      let actualPayloads = messagesSent.map(({ message }) => {
        const { action, payload, ver } = message;
        expect(action).to.eql('wtm.popularity');
        expect(ver).to.eql(3);
        return payload;
      });
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
              type: 'popularity-estimator:prepare-voting:v1',
              args: {
                urlProjection,
                countType,
                intervalType,
                sample: {
                  value: 'example.com',
                  count,
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
              type: 'popularity-estimator:prepare-voting:v1',
              args: {
                urlProjection,
                countType,
                intervalType,
                sample: {
                  value: 'example.com',
                  count,
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

    describe('pause state lookup', function () {
      it('queries pauseState with the unsanitized hostname', async function () {
        // UUID-formatted subdomain is guaranteed to be masked by the
        // sanitizer (the UUID prefilter in hash-detector-v2). After
        // sanitization the hostname becomes "#??#.example.com", but the
        // pause check must still see the *original* hostname — otherwise
        // anything the user has paused with an unusual subdomain would
        // always be reported as paused=false.
        const unsafeHostname =
          '12345678-1234-1234-1234-123456789012.example.com';

        const isHostnamePaused = sinon.stub();
        isHostnamePaused.withArgs(unsafeHostname).returns(true);
        isHostnamePaused.returns(false);
        pauseState.isHostnamePaused = isHostnamePaused;

        const urlProjection = 'hostname';
        const countType = 'visits';
        const intervalType = '1d';

        const prepareVotingJob = {
          type: 'popularity-estimator:prepare-voting:v1',
          args: {
            urlProjection,
            countType,
            intervalType,
            sample: {
              value: unsafeHostname,
              count: 1,
            },
          },
        };
        quorumChecker._everythingReachesQuorum();
        countryProvider._ctry = 'de';

        await expectExactlyTheseSignals(
          prepareVotingJob,
          [
            {
              type: { urlProjection, countType, intervalType },
              ctry: 'de',
              adblocker: {
                paused: true,
                mode: 'default',
              },
            },
          ],
          { ignoreMasking: true },
        );

        expect(isHostnamePaused.calledWith(unsafeHostname)).to.be.true;
      });
    });

    describe('[property based testing]', function () {
      it('should not crash for arbitrary URLs', async function () {
        this.timeout(20 * SECOND);
        await fc.assert(
          fc
            .asyncProperty(
              fc.webUrl(),
              fc.constantFrom('domain', 'hostname', 'hostnamePath'),
              fc.constantFrom('1d', '1w', '4w'),
              fc.integer({ min: 1, max: 3 }),
              async (url, urlProjection, intervalType, count) => {
                const vote = computeUrlProjections(url)[urlProjection];
                const countType = 'visits';

                const prepareVotingJob = {
                  type: 'popularity-estimator:prepare-voting:v1',
                  args: {
                    urlProjection,
                    countType,
                    intervalType,
                    sample: {
                      value: vote,
                      count,
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
    });
  });
});
