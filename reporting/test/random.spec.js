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
import * as fc from 'fast-check';

import { randomSafeIntBetween, shuffleInPlace } from '../src/random.js';

describe('#randomSafeIntBetween', function () {
  it('should reach all buckets of six-side dime', function () {
    const bucket = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    };
    for (let i = 0; i < 6 * 1000; i += 1) {
      bucket[randomSafeIntBetween(1, 6)] += 1;
    }

    for (let i = 1; i <= 6; i += 1) {
      expect(bucket[i]).to.be.greaterThan(800).and.lessThan(1200);
    }
  });

  it('should reach all buckets of { 0, 1, 2 }', function () {
    const bucket = [0, 0, 0];
    for (let i = 0; i < 3 * 1000; i += 1) {
      bucket[randomSafeIntBetween(0, 2)] += 1;
    }

    for (const hits of bucket) {
      expect(hits).to.be.greaterThan(800).and.lessThan(1200);
    }
  });

  describe('should support the full range of safe integers', function () {
    it('{ Number.MIN_SAFE_INTEGER, .., Number.MAX_SAFE_INTEGER }', function () {
      let above0 = 0;
      let below0 = 0;
      for (let i = 0; i < 2 * 1000; i += 1) {
        const num = randomSafeIntBetween(
          Number.MIN_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
        );
        expect(Number.isSafeInteger(num)).to.be.true;
        if (num > 0) {
          above0 += 1;
        } else if (num < 0) {
          below0 += 1;
        }
      }

      expect(above0 + below0).to.be.greaterThan(998);
      expect(above0).to.be.greaterThan(800).and.lessThan(1200);
      expect(below0).to.be.greaterThan(800).and.lessThan(1200);
    });

    describe('testing edge case that are barely within or barely outside the safe integers range', function () {
      [-3, -2, -1, 0, 1].forEach((min) => {
        [0, 1, 2, 3]
          .map((maxDec) => Number.MAX_SAFE_INTEGER - maxDec)
          .forEach((max) => {
            it(`{ ${min}, .., ${max} }`, function () {
              const middle = (max - min) / 2;
              let above = 0;
              let below = 0;
              for (let i = 0; i < 2 * 1000; i += 1) {
                const num = randomSafeIntBetween(min, max);
                expect(Number.isSafeInteger(num)).to.be.true;

                if (num > middle) {
                  above += 1;
                } else if (num < middle) {
                  below += 1;
                }
              }

              expect(above + below).to.be.greaterThan(998);
              expect(above).to.be.greaterThan(800).and.lessThan(1200);
              expect(below).to.be.greaterThan(800).and.lessThan(1200);
            });
          });
      });
    });
  });

  describe('[property based testing]', function () {
    it('should support intervals where min equals max', function () {
      fc.assert(
        fc.property(fc.maxSafeInteger(), (num) => {
          return randomSafeIntBetween(num, num) === num;
        }),
      );
    });

    it('should return an integer between min and max', function () {
      fc.assert(
        fc.property(fc.maxSafeInteger(), fc.maxSafeInteger(), (min, max) => {
          if (min > max) {
            return true;
          }

          const result = randomSafeIntBetween(min, max);
          return Number.isSafeInteger(result) && result >= min && result <= max;
        }),
      );
    });
  });
});

describe('#shuffleInPlace', function () {
  it('should have uniform distribution of elements in each position for small arrays', function () {
    const counts = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];

    for (let i = 0; i < 3 * 1000; i++) {
      const [x, y, z] = shuffleInPlace([0, 1, 2]);
      counts[0][x] += 1;
      counts[1][y] += 1;
      counts[2][z] += 1;
    }

    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        expect(counts[i][j])
          .to.be.greaterThan(1000 * 0.8)
          .and.lessThan(1000 * 1.2);
      }
    }
  });

  describe('[property based testing]', function () {
    it('should produce a permutation of the input array: sort(shuffle(arr)) == sort(arr)', function () {
      fc.assert(
        fc.property(fc.array(fc.integer()), (arr) => {
          const shuffled = shuffleInPlace([...arr]).sort((x, y) => x - y);
          const notShuffled = [...arr].sort((x, y) => x - y);
          expect(shuffled).to.eql(notShuffled);
        }),
      );
    });
  });
});
