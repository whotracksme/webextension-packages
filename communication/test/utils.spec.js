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

import * as fc from 'fast-check';
import { expect } from 'chai';
import { sortObjectKeys } from '../src/utils.js';

describe('#sortObjectKeys', function () {
  it('should ignore the creation order of keys', function () {
    const obj1 = {
      one: 'eins',
      two: 'zwei',
      three: 'drei',
    };
    const obj2 = {
      two: 'zwei',
      three: 'drei',
      one: 'eins',
    };

    const obj1Json = JSON.stringify(sortObjectKeys(obj1));
    const obj2Json = JSON.stringify(sortObjectKeys(obj2));
    expect(obj1Json).to.eql(obj2Json);
  });

  it('should be idempotent', function () {
    fc.assert(
      fc.property(fc.object(), (obj) => {
        const once = sortObjectKeys(obj);
        const twice = sortObjectKeys(once);
        expect(JSON.stringify(once)).to.eql(JSON.stringify(twice));
      }),
    );
  });

  describe('should handle primitive values', function () {
    for (const x of [
      true,
      false,
      undefined,
      null,
      0,
      1,
      1.23,
      '',
      'foo',
      // not primitive, but include:
      [],
      {},
    ]) {
      it(`- <<${x}>>`, function () {
        const { x: xAfter } = sortObjectKeys({ x });
        expect(xAfter).to.eql(x);
      });

      it(`- [${x}]`, function () {
        const { x: xAfter } = sortObjectKeys({ x: [x] });
        expect(xAfter).to.eql([x]);
      });
    }
  });

  it('should sort keys in nested structures', function () {
    const obj1 = {
      payload: {
        paused: false,
        mode: 'default',
      },
    };
    const obj2 = {
      payload: {
        mode: 'default',
        paused: false,
      },
    };

    const obj1Json = JSON.stringify(sortObjectKeys(obj1));
    const obj2Json = JSON.stringify(sortObjectKeys(obj2));
    expect(obj1Json).to.eql(obj2Json);
  });

  it('should sort numeric-string keys in numeric order', function () {
    const obj = {
      payload: {
        r: {
          '11': { foo: 42, bar: null },
          '10': { foo: 42, bar: null },
          '2': { foo: 42, bar: null },
          '1': { foo: 42, bar: null },
          '0': { foo: 42, bar: null },
        },
      },
    };
    const objJson = JSON.stringify(sortObjectKeys(obj));

    const expectedJson = JSON.stringify({
      payload: {
        r: {
          '0': { bar: null, foo: 42 },
          '1': { bar: null, foo: 42 },
          '2': { bar: null, foo: 42 },
          '10': { bar: null, foo: 42 },
          '11': { bar: null, foo: 42 },
        },
      },
    });
    expect(objJson).to.eql(expectedJson);
  });

  it('should support object with "toString" property', function () {
    // Note: used to throw (found by QuickCheck)
    const obj1 = {
      x: {
        toString: null,
      },
      y: {},
    };
    const obj2 = {
      y: {},
      x: {
        toString: null,
      },
    };

    const obj1Json = JSON.stringify(sortObjectKeys(obj1));
    const obj2Json = JSON.stringify(sortObjectKeys(obj2));
    expect(obj1Json).to.eql(obj2Json);
  });
});
