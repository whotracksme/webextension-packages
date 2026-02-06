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
import * as fc from 'fast-check';

import PersistedCounters from '../src/persisted-counters.js';

import InMemoryDatabase from './helpers/in-memory-database.js';

describe('#PersistedCounters', function () {
  let db;
  let uut;

  function initMocks() {
    db = new InMemoryDatabase();
    uut = new PersistedCounters({ name: 'test', db });
  }

  function tearDown() {
    db = null;
    uut = null;
  }

  beforeEach(initMocks);
  afterEach(tearDown);

  describe('#sample', function () {
    it('should return an empty array if nothing has been counted yet', async function () {
      expect(await uut.sample()).to.eql([]);
    });

    it('should pick only element', async function () {
      uut.count('foo');
      expect(await uut.sample()).to.eql(['foo']);
    });

    it('should pick elements based on their counts', async function () {
      uut.count('foo');
      uut.count('bar');
      uut.count('bar');

      let foo = 0;
      let bar = 0;
      const samples = await uut.sample(1000);
      for (const sample of samples) {
        if (sample === 'foo') {
          foo += 1;
        } else if (sample === 'bar') {
          bar += 1;
        } else {
          assert.fail(`Expected "foo" or "sample", but got: ${sample}`);
        }
      }
      expect(foo + bar).to.eql(1000);
      expect(foo).to.be.greaterThan(0);
      expect(bar).to.be.greaterThan(0);
      expect(bar).to.be.greaterThan(1.5 * foo);
      expect(bar).to.be.lessThan(3 * foo);
    });
  });

  describe('[property based testing]', function () {
    describe('with default options', function () {
      it('should return the expected number of samples, all with valid keys', async function () {
        await fc.assert(
          fc
            .asyncProperty(
              fc.array(fc.string()),
              fc.nat(100),
              async (keys, numSamples) => {
                keys.forEach((key) => uut.count(key));
                const result = await uut.sample(numSamples);
                if (keys.length === 0) {
                  expect(result).to.eql([]);
                } else {
                  expect(result).to.have.lengthOf(numSamples);
                  for (const key of result) {
                    expect(keys).to.include(key);
                  }
                }
              },
            )
            .beforeEach(initMocks)
            .afterEach(tearDown),
        );
      });
    });

    describe('with grouping (option: { group: true })', function () {
      it('should return groups summing to the expected number of samples, all with valid keys', async function () {
        await fc.assert(
          fc
            .asyncProperty(
              fc.array(fc.string()),
              fc.nat(100),
              async (keys, numSamples) => {
                keys.forEach((key) => uut.count(key));
                const result = await uut.sample(numSamples, { group: true });
                if (keys.length === 0) {
                  expect(result).to.eql([]);
                } else {
                  let sum = 0;
                  const keysSeen = new Set();
                  for (const [key, count] of result) {
                    expect(keys).to.include(key);
                    expect(count).to.be.a('number').greaterThan(0);
                    sum += count;

                    // there should be also no duplicates
                    expect(keysSeen).to.not.include(key);
                    keysSeen.add(key);
                  }
                  expect(sum).to.eql(numSamples);
                }
              },
            )
            .beforeEach(initMocks)
            .afterEach(tearDown),
        );
      });
    });
  });
});
