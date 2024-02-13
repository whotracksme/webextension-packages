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

import {
  titlesMatchAfterDoublefetch,
  sanitizeActivity,
} from '../src/doublefetch-page-handler.js';

describe('#titlesMatchAfterDoublefetch', function () {
  function shouldMatch(before, after) {
    if (!titlesMatchAfterDoublefetch({ before, after })) {
      expect.fail(
        `Expected titles to match, but they did not:\n` +
          `before: <<${before}>>\n` +
          `after:  <<${after}>>`,
      );
    }
  }

  function shouldNotMatch(before, after) {
    if (titlesMatchAfterDoublefetch({ before, after })) {
      expect.fail(
        `Did not expect titles to match, but they did:\n` +
          `before: <<${before}>>\n` +
          `after:  <<${after}>>`,
      );
    }
  }

  it('should always reject pages without titles', function () {
    shouldNotMatch({ before: '', after: '' });
    shouldNotMatch({ before: '', after: 'foo' });
    shouldNotMatch({ before: undefined, after: '' });
    shouldNotMatch({ before: null, after: '' });
  });

  it('should accept perfect matches', function () {
    shouldNotMatch({ before: 'Some title', after: 'Some title' });
  });

  it('should reject completely different titles', function () {
    shouldNotMatch({
      before: 'Some title (XYZ)',
      after: 'This is some unrelated title',
    });
  });

  it('should reject completely different titles', function () {
    shouldNotMatch({
      before: 'Some title (XYZ)',
      after: 'This is some unrelated title',
    });
  });

  describe('should not do precise matching for uppercase and lowercase letters', function () {
    for (const { before, after } of [
      { before: 'Example Search - YouTube', after: 'example search - YouTube' },
    ]) {
      it(`- ${before} --> ${after}`, function () {
        shouldMatch(before, after);
      });
    }
  });

  describe('should accept titles that are subsets of doublefetch, but not vice versa', function () {
    for (const { before, after } of [
      {
        // Note: might not be the best example, since this is still likely to
        // be dropped since it could trigger the email detector. But Mastodon
        // is an example where the title can be more detailed if you are not
        // logged in.
        before: 'muenchen.social - Die erste Mastodon Instanz für München',
        after:
          'Max Mustermann (@maxmustermann@muenchen.social) - muenchen.social - Die erste Mastodon Instanz für München',
      },
    ]) {
      it(`- ${before} --> ${after}`, function () {
        shouldMatch(before, after);
      });
      it(`- ${before} --> ${after} (swapping orders!)`, function () {
        shouldNotMatch(after, before);
      });
    }
  });
});

describe('#sanitizeActivity', function () {
  function ensureInRange(x) {
    expect(x).to.be.a('string');
    expect(Number(x)).to.be.within(0, 1);
  }

  it('should map bad inputs to "0"', function () {
    expect(sanitizeActivity(null)).to.eql('0');
    expect(sanitizeActivity(undefined)).to.eql('0');
    expect(sanitizeActivity({})).to.eql('0');
    expect(sanitizeActivity('x')).to.eql('0');
    expect(sanitizeActivity('1')).to.eql('0');
  });

  it('should reasonably normalize values like 0.33333...', function () {
    const result = sanitizeActivity(1 / 3);
    ensureInRange(result);
    expect(Number(result)).to.be.greaterThan(0.2);
    expect(Number(result)).to.be.lessThan(0.45);
    expect(result.length).to.be.lessThanOrEqual('0.1234'.length);
  });

  describe('[property based testing]', function () {
    it('should keep values between 0 and 1', function () {
      fc.assert(
        fc.property(fc.double(), (x) => {
          ensureInRange(sanitizeActivity(x));
        }),
      );
    });

    it('should not change numbers too drastically', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
          const result = sanitizeActivity(x);
          ensureInRange(result);
          expect(Number(result)).to.be.within(x - 0.1, x + 0.1);
        }),
      );
    });

    it('should not drastically change the ordering', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 0.4, noNaN: true }), (low) => {
          const high = 1.0 - low;
          const low_ = sanitizeActivity(low);
          const high_ = sanitizeActivity(high);
          ensureInRange(low_);
          ensureInRange(high_);
          expect(Number(low_)).to.be.lessThan(Number(high_));
        }),
      );
    });

    it('should not round up small numbers to 1', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 0.85, noNaN: true }), (x) => {
          const result = sanitizeActivity(x);
          expect(Number(result)).to.be.lessThan(1.0);
        }),
      );
    });

    it('should not round up big numbers to 0', function () {
      fc.assert(
        fc.property(fc.double({ min: 0.15, max: 1, noNaN: true }), (x) => {
          const result = sanitizeActivity(x);
          expect(Number(result)).to.be.greaterThan(0.0);
        }),
      );
    });

    it('should map bad inputs to "0"', function () {
      fc.assert(
        fc.property(fc.anything(), (x) => {
          if (!Number.isFinite(x)) {
            expect(sanitizeActivity(x)).to.eql('0');
          }
        }),
      );
    });

    it('should not change the mean too much', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
          const numRuns = 1000;
          let sum = 0;
          for (let i = 0; i < numRuns; i += 1) {
            sum += Number(sanitizeActivity(x));
          }
          const mean = sum / numRuns;
          expect(mean).to.be.within(x - 0.03, x + 0.03);
        }),
      );
    });
  });
});
