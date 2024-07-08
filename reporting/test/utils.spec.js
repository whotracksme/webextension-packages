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

import {
  chunk,
  flattenObject,
  equalityCanBeProven,
  lazyInitAsync,
} from '../src/utils.js';

describe('#chunk', function () {
  it('should work in simple examples', function () {
    expect(chunk([], 1)).to.eql([]);
    expect(chunk([1], 1)).to.eql([[1]]);
    expect(chunk([1], 100)).to.eql([[1]]);
    expect(chunk([1, 2, 3], 1)).to.eql([[1], [2], [3]]);
    expect(chunk([1, 2, 3, 4, 5], 3)).to.eql([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it('should work for any array', function () {
    fc.assert(
      fc.property(
        fc.array(fc.nat()),
        fc.integer({ min: 1, max: 1000 }),
        (arr, size) => {
          const result = chunk(arr, size);
          for (let i = 0; i < result.length - 1; i += 1) {
            expect(result[i].length).to.eql(size);
          }
          expect(result.flat()).to.eql(arr);
          return true;
        },
      ),
    );
  });
});

describe('#flattenObject', function () {
  it('should work in simple examples', function () {
    expect(flattenObject({})).to.eql([]);
    expect(flattenObject({ x: 1 })).to.eql([{ path: ['x'], value: 1 }]);
    expect(flattenObject({ x: 1, y: { z: 2 } })).to.eql([
      { path: ['x'], value: 1 },
      { path: ['y', 'z'], value: 2 },
    ]);
    expect(flattenObject({ x: { y: { z: 1 } } })).to.eql([
      { path: ['x', 'y', 'z'], value: 1 },
    ]);
  });
});

describe('#equalityCanBeProven', function () {
  describe('should be able to prove equality for simple objects', function () {
    for (const x of [
      0,
      null,
      undefined,
      true,
      false,
      [],
      [1, 2, 3],
      [1, [2], [[3]]],
      {},
      { foo: 'bar' },
      { foo: { bar: [null, undefined, {}] } },
      new Date(0),
    ]) {
      it(`- value: ${JSON.stringify(x)}`, function () {
        expect(equalityCanBeProven(x, x)).to.eql(true);
      });
    }
  });

  describe('should return false when comparing unequal objects', function () {
    for (const [x, y] of [
      [0, 1],
      [null, 1],
      [undefined, null],
      [true, false],
      [false, {}],
      [[], [[]]],
      [
        [1, 2, 3],
        [3, 2, 1],
      ],
      [{}, { foo: 'bar' }],
      [{}, null],
      [new Date(0), new Date(1)],
      [new Date(0), null],
      [{ foo: 1 }, { foo: 2 }],
    ]) {
      it(`- value: ${JSON.stringify(x)} !== ${JSON.stringify(y)}`, function () {
        expect(equalityCanBeProven(x, y)).to.eql(false);
      });
    }
  });

  describe('should be able to prove equality even if fields are reordered', function () {
    for (const [x, y] of [
      [
        { x: 1, y: 2 },
        { y: 2, x: 1 },
      ],
      [[{ x: 1, y: 2, z: {} }], [{ y: 2, z: {}, x: 1 }]],
    ]) {
      it(`- value: ${JSON.stringify(x)} === ${JSON.stringify(y)}`, function () {
        expect(equalityCanBeProven(x, y)).to.eql(true);
      });
    }
  });

  it('proving equality implies deepEqual', function () {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (x, y) => {
        if (equalityCanBeProven(x, y)) {
          expect(x).to.deep.eql(y);
        }
        return true;
      }),
    );
  });

  describe('should handle edge cases found by property based testing', function () {
    it('should not throw if "toString" is set to undefined', function () {
      expect(
        equalityCanBeProven(
          {},
          {
            '': {},
            ' ': [
              {
                'toString': undefined,
              },
            ],
          },
        ),
      ).to.eql(false);
    });
  });
});

describe('#lazyInitAsync', function () {
  async function expectToThrow(func, message) {
    let error = null;
    try {
      await func();
      error = 'Expected to throw, but it did not';
    } catch (e) {
      if (message && e.message !== message) {
        error = `Expected to throw with message <${message}>, but it got <${e.message}>`;
      }
    }
    if (error) {
      assert.fail(error);
    }
  }

  describe('should support initializations and multiple calls', function () {
    it('with a simple async function', async function () {
      const x = lazyInitAsync(async () => 1 + 1);
      expect(await x()).to.eql(2);
      expect(await x()).to.eql(2);
    });

    it('with a simple non-async function', async function () {
      const x = lazyInitAsync(() => 1 + 1);
      expect(await x()).to.eql(2);
      expect(await x()).to.eql(2);
    });

    it('with a complex async function', async function () {
      const lazy2 = lazyInitAsync(async () => {
        return 1 + 1;
      });
      const lazy3 = lazyInitAsync(async () => {
        return 1 + (await lazy2());
      });
      const lazy5 = lazyInitAsync(async () => {
        const [two, three] = await Promise.all([lazy2(), lazy3()]);
        return two + three;
      });
      expect(await lazy5()).to.eql(5);
      expect(await lazy5()).to.eql(5);
    });
  });

  describe('should support falsy types as return values', function () {
    for (const value of [false, null, undefined, 0, '']) {
      it(`- value: <${value}>`, async function () {
        const x = lazyInitAsync(async () => value);
        expect(await x()).to.eql(value);
        expect(await x()).to.eql(value);
      });
    }
  });

  describe('should support raising exceptions', function () {
    it('async function', async function () {
      const x = lazyInitAsync(async () => {
        throw new Error('test');
      });
      await expectToThrow(x, 'test');
      await expectToThrow(x, 'test');
    });

    it('non-async function', async function () {
      const x = lazyInitAsync(() => {
        throw new Error('test');
      });
      await expectToThrow(x, 'test');
      await expectToThrow(x, 'test');
    });

    it('throwing falsy values as exceptions', async function () {
      const x = lazyInitAsync(() => {
        throw null;
      });
      await expectToThrow(x);
      await expectToThrow(x);
    });
  });

  describe('should not call the initializer more than once', function () {
    it('when it succeeds', async function () {
      let counter = 0;
      const x = lazyInitAsync(async () => {
        counter += 1;
      });
      for (let i = 0; i < 3; i += 1) {
        await Promise.all([x(), x(), x()]);
      }
      expect(counter).to.eql(1);
    });

    it('when it fails', async function () {
      let counter = 0;
      const x = lazyInitAsync(async () => {
        counter += 1;
        throw new Error('error');
      });
      for (let i = 0; i < 3; i += 1) {
        try {
          await Promise.all([x(), x(), x()]);
        } catch (e) {
          // expected to throw
        }
      }
      expect(counter).to.eql(1);
    });
  });

  it('should not call the initializer if never requested', async function () {
    const called = [];
    const x = lazyInitAsync(async () => {
      called.push('x');
    });
    const y = lazyInitAsync(() => {
      called.push('y');
    });
    const z = lazyInitAsync(async () => {
      await x();
      await y();
      called.push('z');
    });

    // should not have been called ...
    expect(called).to.eql([]);

    // ... even after giving async operation a chance to run
    for (let i = 0; i < 100; i += 1) {
      await Promise.resolve();
    }
    expect(called).to.eql([]);

    // ... or letting timers expire
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(called).to.eql([]);

    // however, it will trigger if requested
    await z();
    expect(called).to.eql(['x', 'y', 'z']);
    await z();
    expect(called).to.eql(['x', 'y', 'z']);
  });
});
