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

import SessionStorageWrapper from '../src/session-storage.js';
import FakeSessionApi from './helpers/fake-session-storage.js';
import { isSafeKeyForAnyMap } from './helpers/fast-check-utils.js';

describe('#SessionStorageWrapper', function () {
  let uut;
  let sessionApi;
  let clock;
  let set; // spy to storage.session.set
  let remove; // spy to storage.session.remove

  async function session() {
    function removePrefix(key) {
      if (!key.startsWith(uut.prefix)) {
        throw new Error(
          `Assertion failed: Found unprefixed key=<${key}> (prefix=<${uut.prefix}>)`,
        );
      }
      return key.replace(uut.prefix, '');
    }
    return Object.fromEntries(
      Object.entries(await sessionApi.get()).map(([key, val]) => [
        removePrefix(key),
        val,
      ]),
    );
  }

  async function passesSelfChecks() {
    const checks = await uut.selfChecks();
    expect(checks.allPassed()).to.be.true;
  }

  function initMocks(sessionApi_) {
    if (sessionApi_) {
      sessionApi = sessionApi_;
    } else {
      sessionApi = new FakeSessionApi();
      set = sinon.spy(sessionApi, 'set');
      remove = sinon.spy(sessionApi, 'remove');
    }

    clock?.restore();
    clock = sinon.useFakeTimers(new Date('2020-01-01'));
    uut = new SessionStorageWrapper({
      sessionApi,
    });
  }

  function tearDown() {
    clock?.restore();
    clock = null;
    sessionApi = null;
    set = null;
    remove = null;
  }

  function simulateServiceWorkerRestart() {
    initMocks(sessionApi);
  }

  beforeEach(function () {
    initMocks();
  });

  afterEach(function () {
    tearDown();
  });

  describe('when starting unitialized', function () {
    it('should be ready after initialization', async () => {
      await uut.init();
      expect(uut.isReady()).to.be.true;
    });

    it('should be supported to call init multiple times', async () => {
      await Promise.all([uut.init(), uut.init(), uut.init()]);
      expect(uut.isReady()).to.be.true;
    });
  });

  describe('when starting initialized', function () {
    beforeEach(async () => {
      await uut.init();
    });

    it('should pass self checks', async function () {
      await passesSelfChecks();
    });

    describe('basic get/set/remove operations', function () {
      it('set and get a single value', function () {
        expect(uut.get('foo')).to.be.undefined;
        uut.set('foo', 'bar');
        expect(uut.get('foo')).to.eql('bar');
      });

      it('remove a single value', function () {
        uut.set('foo', 'bar');
        expect(uut.get('foo')).to.eql('bar');

        uut.remove('foo');
        expect(uut.get('foo')).to.be.undefined;
      });
    });

    describe('should eventually write values to session storage', function () {
      beforeEach(async function () {
        await uut.init();
      });

      it('a single write should eventually write through', async function () {
        expect(await session()).to.eql({});
        uut.set('foo', 'bar');

        await clock.runAllAsync();
        expect(await session()).to.eql({ foo: 'bar' });
      });

      it('updates should eventually be written through', async function () {
        let timeout = 0;
        for (let i = 0; i < 100; i += 1) {
          setTimeout(() => {
            uut.set('key', `step${i}`);
          }, timeout);
          timeout += 100;
        }
        setTimeout(() => {
          uut.set('key', 'last_step');
        }, timeout);

        await clock.runAllAsync();

        expect(uut.get('key')).to.eql('last_step');
        expect(await session()).to.eql({ key: 'last_step' });
      });
    });

    describe('should preserve values across service worker restarts', function () {
      describe('when there is only one write', function () {
        // Note: basic keys are supported, but session storage does not support
        // complex types (e.g. ArrayBuffers, functions)
        for (const value of [
          'some string',
          42,
          3.14,
          true,
          false,
          new Date('2000-01-01T00:00:00.000Z'),
          ['some', 'array'],
          { nonNested: 'object' },
          { some: { nested: 'object' } },
        ]) {
          it(`- value: ${JSON.stringify(value)}`, async function () {
            await uut.init();

            uut.set('key', value);
            expect(uut.get('key')).to.eql(value);

            await clock.runAllAsync();
            expect(await session()).to.eql({ key: value });

            simulateServiceWorkerRestart();
            await uut.init();
            expect(uut.get('key')).to.eql(value);
            expect(await session()).to.eql({ key: value });
          });
        }
      });

      it('when there are random writes', async function () {
        await fc.assert(
          fc
            .asyncProperty(
              fc.array(
                fc.tuple(
                  fc.string(),
                  fc.string(),
                  fc.integer({ min: 0, max: 1000 }),
                ),
                { minLength: 1 },
              ),
              async (keys) => {
                await uut.init();

                const expectedMap = {};
                keys.forEach(([key, val, delay]) => {
                  if (isSafeKeyForAnyMap(key)) {
                    setTimeout(() => {
                      uut.set(key, val);
                      expectedMap[key] = val;
                    }, delay);
                  }
                });

                await clock.runAllAsync();
                expect(await session()).to.eql(expectedMap);
                await passesSelfChecks();

                simulateServiceWorkerRestart();
                await uut.init();
                expect(await session()).to.eql(expectedMap);
                await passesSelfChecks();
              },
            )
            .beforeEach(() => {
              initMocks();
            })
            .afterEach(() => {
              tearDown();
            }),
          {
            // do not let the test slow down the whole test suite
            numRuns: 10,
          },
        );
      });
    });

    describe('should batch modifications to meet session API limits', function () {
      it('multiple writes of the identical key can be joined', async function () {
        expect(set.callCount).to.eql(0);
        uut.set('key', 1);
        uut.set('key', 2);
        uut.set('key', 3);
        await clock.runAllAsync();
        expect(await session()).to.eql({ key: 3 });
        expect(set.callCount).to.eql(1);
      });

      it('multiple writes of different keys can be joined', async function () {
        expect(set.callCount).to.eql(0);
        uut.set('key1', 1);
        uut.set('key2', 2);
        uut.set('key3', 3);
        await clock.runAllAsync();
        expect(await session()).to.eql({ key1: 1, key2: 2, key3: 3 });
        expect(set.callCount).to.eql(1);
      });
    });

    describe('should support writing through in-place updates by explicitly marking the change', function () {
      it('with an array as value', async function () {
        const value = [1];
        uut.set('key', value);
        await clock.runAllAsync();
        expect(await session()).to.eql({ key: [1] });
        expect(set.callCount).to.eql(1);

        // reinsert after in-place edit
        value.push(2);
        uut.set('key', value);
        await clock.runAllAsync();

        // first, it will not be seen
        expect(await session()).to.eql({ key: [1, 2] });
        expect(set.callCount).to.eql(2);
      });

      it('with an object as value', async function () {
        const value = { foo: 1 };
        uut.set('key', value);
        await clock.runAllAsync();
        expect(await session()).to.eql({ key: { foo: 1 } });
        expect(set.callCount).to.eql(1);

        // reinsert after in-place edit
        value.bar = 2;
        uut.set('key', value);
        await clock.runAllAsync();

        // first, it will not be seen
        expect(await session()).to.eql({ key: { foo: 1, bar: 2 } });
        expect(set.callCount).to.eql(2);
      });
    });

    describe('delete operations that write through', function () {
      it('set ... wait ... remove should result in writes', async function () {
        uut.set('key', 1);
        await clock.runAllAsync();
        expect(await session()).to.eql({ key: 1 });
        expect(set.callCount).to.eql(1);
        expect(remove.callCount).to.eql(0);

        uut.remove('key');
        await clock.runAllAsync();
        expect(await session()).to.eql({});
        expect(set.callCount).to.eql(1);
        expect(remove.callCount).to.eql(1);
      });

      it('set + remove (without pausing) should not result in writes', async function () {
        uut.set('key', 1);
        uut.remove('key');
        await clock.runAllAsync();
        expect(await session()).to.eql({});
        expect(set.callCount).to.eql(0);
      });

      it('concurrent set and remove operations', async function () {
        uut.set('foo', 1);
        uut.remove('bar');
        await clock.runAllAsync();
        expect(await session()).to.eql({ foo: 1 });
        expect(set.callCount).to.eql(1);
        expect(remove.callCount).to.eql(0);

        uut.remove('foo');
        uut.set('bar', 2);
        await clock.runAllAsync();
        expect(await session()).to.eql({ bar: 2 });
        expect(set.callCount).to.eql(2);
        expect(remove.callCount).to.eql(1);
      });
    });

    describe('delete and later set again', function () {
      it('remove + set', async function () {
        uut.remove('key');
        uut.set('key', 1);

        await clock.runAllAsync();
        expect(await session()).to.eql({ key: 1 });
        expect(set.callCount).to.eql(1);
      });

      it('set + remove + set', async function () {
        uut.set('key', 1);
        uut.remove('key');
        uut.set('key', 2);

        await clock.runAllAsync();
        expect(await session()).to.eql({ key: 2 });
        expect(set.callCount).to.eql(1);
      });

      it('set + remove + set + remove ... wait ... set', async function () {
        uut.set('key', 1);
        uut.remove('key');
        uut.set('key', 2);
        uut.remove('key');
        await clock.runAllAsync();
        expect(await session()).to.eql({});
        expect(set.callCount).to.eql(0);

        uut.set('key', 3);
        await clock.runAllAsync();
        expect(await session()).to.eql({ key: 3 });
        expect(set.callCount).to.eql(1);
      });
    });

    describe('#flush', function () {
      it('should write through if there was a modification', async function () {
        uut.set('key', 1);
        await uut.flush();
        expect(set.callCount).to.eql(1);
        expect(await session()).to.eql({ key: 1 });
      });

      it('should not result in a write if there was no modification', async function () {
        await uut.flush();
        expect(set.callCount).to.eql(0);
      });

      it('should write through if a key was removed', async function () {
        uut.set('key', 1);
        await uut.flush();
        expect(await session()).to.eql({ key: 1 });

        uut.remove('key');
        await uut.flush();
        expect(await session()).to.eql({});
      });

      it('should be supported to call flush multiple times', async function () {
        uut.set('key', 1);
        await Promise.all([uut.flush(), uut.flush(), uut.flush()]);
        expect(set.callCount).to.eql(1);
        expect(await session()).to.eql({ key: 1 });
      });
    });
  });
});
