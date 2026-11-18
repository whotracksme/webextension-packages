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

import { BloomFilter } from '../src/bloom-filters.js';
import InMemoryDatabase from './helpers/in-memory-database.js';

const DAY = 24 * 60 * 60 * 1000;

describe('#BloomFilter', function () {
  let database;

  function newBloomFilter(options = {}) {
    return new BloomFilter({
      database,
      name: 'test',
      partitions: [1009, 1013, 1019],
      ...options,
    });
  }

  // simulates a restart of the extension at the given time
  async function restartBloomFilter(oldBloomFilter, { now, ...options }) {
    await Promise.all(oldBloomFilter.generations.map((gen) => gen.flush()));
    const uut = newBloomFilter(options);
    await uut.ready(now);
    return uut;
  }

  beforeEach(function () {
    database = new InMemoryDatabase();
  });

  describe('#mightContain', function () {
    it('should not find a value in an empty filter', async function () {
      const uut = newBloomFilter();
      expect(await uut.mightContain('foo')).to.eql(false);
    });

    it('should find a value that was added', async function () {
      const uut = newBloomFilter();
      await uut.add('foo');

      expect(await uut.mightContain('foo')).to.eql(true);
      expect(await uut.mightContain('bar')).to.eql(false);
    });

    it('should find a value that was added if there is only one generation', async function () {
      const uut = newBloomFilter({
        maxGenerations: 1,
        rotationIntervalInMs: 0,
      });
      await uut.add('foo');

      expect(await uut.mightContain('foo')).to.eql(true);
      expect(await uut.mightContain('bar')).to.eql(false);
    });

    it('should find a value after a restart', async function () {
      const now = Date.now();
      let uut = newBloomFilter();
      await uut.ready(now);
      await uut.add('foo');

      uut = await restartBloomFilter(uut, { now: now + DAY });
      expect(uut.generations).to.have.lengthOf(1);
      expect(await uut.mightContain('foo')).to.eql(true);
      expect(await uut.mightContain('bar')).to.eql(false);
    });

    describe('with a value in an older generation', function () {
      const rotationIntervalInMs = 30 * DAY;
      let uut;

      beforeEach(async function () {
        const now = Date.now();
        uut = newBloomFilter({ rotationIntervalInMs });
        await uut.ready(now);
        await uut.add('foo');

        uut = await restartBloomFilter(uut, {
          now: now + rotationIntervalInMs + DAY,
          rotationIntervalInMs,
        });
        expect(uut.generations).to.have.lengthOf(2);
      });

      it('should find the value', async function () {
        expect(await uut.mightContain('foo')).to.eql(true);
        expect(await uut.mightContain('bar')).to.eql(false);
      });

      it('should not copy the value to the latest generation by default', async function () {
        expect(await uut.mightContain('foo')).to.eql(true);

        const bits = uut._computeBits('foo');
        expect(await uut.generations[1].testMany(bits)).to.eql(false);
      });

      it('should copy the value to the latest generation with "updateTTLIfFound"', async function () {
        const found = await uut.mightContain('foo', { updateTTLIfFound: true });
        expect(found).to.eql(true);

        const bits = uut._computeBits('foo');
        expect(await uut.generations[1].testMany(bits)).to.eql(true);
      });
    });
  });
});
