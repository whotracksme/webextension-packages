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
import fc from 'fast-check';

import ActivityEstimator from '../src/activity-estimator.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

class Listeners {
  constructor() {
    this.reset();
  }

  reset() {
    this.events = [];
    this.counts = {
      onActivityUpdated: 0,
      onInternalStateChanged: 0,
    };
  }

  onActivityUpdated(...args) {
    expect(args).to.have.lengthOf(1);
    const urls = args[0];
    for (const url of urls) {
      if (!URL.canParse(url)) {
        assert.fail(`Failed to parse URL: ${url}`);
      }
    }

    const type = 'onActivityUpdated';
    this.events.push({ type, ts: Date.now(), urls });
    this.counts[type] += 1;
  }

  onInternalStateChanged(...args) {
    expect(args).to.be.empty;
    const type = 'onInternalStateChanged';
    this.events.push({ type, ts: Date.now() });
    this.counts[type] += 1;
  }

  wasCalled(type) {
    if (this.counts[type] === undefined) {
      throw new Error(`Unknown type: ${type}`);
    }
    expect(this.counts[type]).to.be.greaterThan(0);
  }
}

describe('#ActivityEstimator', function () {
  let uut;
  let clock;
  let listeners;

  function initMocks() {
    clock?.restore();
    clock = sinon.useFakeTimers(new Date('2020-01-01'));

    // workaround for a weird Sinon bug: unless a timer was set at least once, clock.jump will fail
    // TODO: report upstream: https://github.com/sinonjs/sinon
    setTimeout(() => {}, 0);

    listeners = new Listeners();
    uut = new ActivityEstimator({
      onActivityUpdated: (...args) => {
        listeners.onActivityUpdated(...args);
      },
      onInternalStateChanged: (...args) => {
        listeners.onInternalStateChanged(...args);
      },
    });
  }

  function tearDown() {
    clock?.restore();
    clock = null;
    listeners = null;
  }

  beforeEach(initMocks);
  afterEach(tearDown);

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

  const SOME_URL = 'https://example.test/';
  const ANOTHER_URL = 'https://example2.test/';

  function expectLowestScore(url) {
    const score = uut.estimate(url);
    expect(score).to.eql(0.0);
  }

  function expectNonZeroScore(url) {
    const score = uut.estimate(url);
    expect(score).to.be.greaterThan(0.0);
  }

  it('should treat unknown URLs as inactive', function () {
    expectLowestScore(SOME_URL);
  });

  describe('should recognize that the current active URL is somewhat active', function () {
    it('after the URL has been activated', function () {
      uut.updateActiveUrl(SOME_URL);
      expectNonZeroScore(SOME_URL);
    });

    it('after a dynamic load has been detected', function () {
      uut.dynamicLoadDetected(SOME_URL);
      expectNonZeroScore(SOME_URL);
    });
  });

  describe('should not instanty reduce activity scores if a URL becomes as inactive', function () {
    for (const delay of [
      1,
      5,
      100,
      1 * SECOND,
      5 * SECOND,
      30 * SECOND,
      4 * MINUTE,
      20 * MINUTE,
      29 * MINUTE,
      2 * HOUR,
      3 * DAY,
      2 * WEEK,
    ]) {
      it(`after the URL has been active for ${delay} ms`, async function () {
        const url = SOME_URL;
        uut.updateActiveUrl(url);
        expectNonZeroScore(url);
        clock.tick(delay);

        const now = Date.now();
        const scoreBeforeDisabling = uut.estimate(url, now);
        uut.updateActiveUrl(null);
        const scoreAfterDisabling = uut.estimate(url, now);
        expect(scoreBeforeDisabling).to.eql(scoreAfterDisabling);
        return { defaultHandler: false };
      });
    }
  });

  it('should no long increase the score of inactive tabs', function () {
    const scores = [];
    const pushScores = () => {
      const now = Date.now();
      scores.push({
        [SOME_URL]: uut.estimate(SOME_URL, now),
        [ANOTHER_URL]: uut.estimate(ANOTHER_URL, now),
      });
    };
    pushScores();

    const scoreIncreased = (url) => {
      const curr = scores[scores.length - 1];
      const prev = scores[scores.length - 2];
      return curr[url] > prev[url];
    };

    const scoreDidNotIncrease = (url) => {
      const curr = scores[scores.length - 1];
      const prev = scores[scores.length - 2];
      return curr[url] <= prev[url];
    };

    pushScores();
    scoreDidNotIncrease(SOME_URL);
    scoreDidNotIncrease(ANOTHER_URL);

    uut.updateActiveUrl(SOME_URL);
    pushScores();
    scoreIncreased(SOME_URL);
    scoreDidNotIncrease(ANOTHER_URL);

    clock.tick(SECOND);
    pushScores();
    scoreIncreased(SOME_URL);
    scoreDidNotIncrease(ANOTHER_URL);

    uut.updateActiveUrl(null);
    clock.tick(SECOND);
    pushScores();
    scoreDidNotIncrease(SOME_URL);
    scoreDidNotIncrease(ANOTHER_URL);

    clock.tick(SECOND);
    pushScores();
    scoreDidNotIncrease(SOME_URL);
    scoreDidNotIncrease(ANOTHER_URL);

    clock.tick(HOUR);
    pushScores();
    scoreDidNotIncrease(SOME_URL);
    scoreDidNotIncrease(ANOTHER_URL);

    uut.dynamicLoadDetected(ANOTHER_URL);
    pushScores();
    scoreDidNotIncrease(SOME_URL);
    scoreIncreased(ANOTHER_URL);
  });

  it('should handle situations without active tabs', async function () {
    uut.updateActiveUrl(null);
    await passesSelfChecks();

    await clock.tickAsync(1 * SECOND);
    uut.updateActiveUrl(null);
    await passesSelfChecks();
  });

  describe('events', function () {
    it('activating an URL should trigger events', async function () {
      uut.updateActiveUrl(SOME_URL);
      await clock.runAllAsync();
      listeners.wasCalled('onActivityUpdated');
      listeners.wasCalled('onInternalStateChanged');
    });
  });

  describe('[property based testing]', function () {
    function arbitraryScenario({
      urls = [
        'https://example1.test/',
        'https://example2.test/',
        'https://example3.test/',
        null,
      ],
    } = {}) {
      return fc.array(
        fc.record({
          url: fc.option(...urls.map((url) => fc.constant(url))),
          isDynamicLoad: fc.boolean(),
          delay: fc.nat(1 * WEEK),
          jump: fc.nat(1 * WEEK),
        }),
      );
    }

    async function runScenario(steps, { customHook } = {}) {
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        try {
          const { url, delay = 0, jump = 0, isDynamicLoad = false } = step;
          const handleDelays = async () => {
            if (delay > 0) {
              clock.tick(delay);
              await passesSelfChecks();
            }
            if (jump > 0) {
              clock.jump(jump);
              await passesSelfChecks();
            }
          };
          const defaultHandler = async () => {
            await clock.runAllAsync();
            await passesSelfChecks();
            await handleDelays();
            if (url !== undefined) {
              if (url && isDynamicLoad) {
                uut.dynamicLoadDetected(url);
              } else {
                uut.updateActiveUrl(url);
              }
              if (url) {
                expectNonZeroScore(url);
              }
            }
          };

          if (customHook) {
            await customHook({
              ...step,
              runDefaultHandler: defaultHandler,
              handleDelays,
            });
          } else {
            await defaultHandler();
          }
          await passesSelfChecks();
          await clock.runAllAsync();
        } catch (e) {
          const allSteps = JSON.stringify(steps, null, 2);
          const lastStep = JSON.stringify(step);
          console.error(
            `Scenario:\n\n---\n${allSteps}\nScenario failed at step ${i} (${lastStep}):\nError:`,
            e,
          );
          throw e;
        }
      }
    }

    describe('should not reach an inconsistent state', function () {
      it('when switching between URLs and doing dynamic loads', async function () {
        this.timeout(20 * SECOND);
        await fc.assert(
          fc
            .asyncProperty(arbitraryScenario(), runScenario)
            .beforeEach(initMocks)
            .afterEach(tearDown),
        );
      });
    });

    it('should not change the current activity score when a page becomes inactive', async function () {
      this.timeout(20 * SECOND);
      await fc.assert(
        fc
          .asyncProperty(arbitraryScenario(), async (steps) => {
            await runScenario(steps, {
              customHook: async ({ url, runDefaultHandler, handleDelays }) => {
                if (url) {
                  await handleDelays();
                  const scoreBeforeDisabling = uut.estimate(url);
                  uut.updateActiveUrl(null);
                  const scoreAfterDisabling = uut.estimate(url);
                  expect(scoreBeforeDisabling).to.eql(scoreAfterDisabling);
                } else {
                  await runDefaultHandler();
                }
              },
            });
          })
          .beforeEach(initMocks)
          .afterEach(tearDown),
      );
    });
  });
});
