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

import { removeQueryParams, removeSearchHash } from '../src/url-cleaner.js';

/**
 * Note: this function is also used to implement the "removeParams" builtin.
 * The builtin tests (see ../test/patters.spec.js) operate under a stronger
 * precondition (assuming valid, absolute URL). No need to replicate these
 * tests here again.
 */
describe('#removeQueryParams', function () {
  describe('when used with valid URLs where URL.canParse(url) is true', function () {
    it('should work in a simple example', function () {
      expect(
        removeQueryParams('https://example.test/path?foo=1&bar=2#baz', ['foo']),
      ).to.eql('https://example.test/path?bar=2#baz');
    });
  });

  describe('should handle non-valid URLs gracefully', function () {
    it('should support relative URLs', function () {
      expect(removeQueryParams('/relative?foo=1&bar=2#baz', ['foo'])).to.eql(
        '/relative?bar=2#baz',
      );
    });

    describe('should support incomplete URLs', function () {
      it('with missing /', function () {
        expect(removeQueryParams('https://example.test', ['foo'])).to.eql(
          'https://example.test',
        );
        expect(
          removeQueryParams('https://example.test?foo=bar', ['foo']),
        ).to.eql('https://example.test');
        expect(
          removeQueryParams('https://example.test?foo=bar#abc', ['foo']),
        ).to.eql('https://example.test#abc');
        expect(removeQueryParams('https://example.test#abc', ['foo'])).to.eql(
          'https://example.test#abc',
        );
      });

      it('with missing /', function () {
        expect(removeQueryParams('//example.test', ['foo'])).to.eql(
          '//example.test',
        );
      });
    });
  });
});

describe('#removeSearchHash', function () {
  it('should work in the happy path', function () {
    expect(removeSearchHash('https://example.test/foo#')).to.eql(
      'https://example.test/foo',
    );
    expect(removeSearchHash('https://example.test/foo#remove-me')).to.eql(
      'https://example.test/foo',
    );
    expect(removeSearchHash('https://example.test/foo?x=y#')).to.eql(
      'https://example.test/foo?x=y',
    );
    expect(removeSearchHash('https://example.test/foo?x=y#remove-me')).to.eql(
      'https://example.test/foo?x=y',
    );
  });

  it('should not change URLs without hashes', function () {
    expect(removeSearchHash('https://example.test/foo')).to.eql(
      'https://example.test/foo',
    );
    expect(removeSearchHash('https://example.test/foo?x=y')).to.eql(
      'https://example.test/foo?x=y',
    );
  });

  it('should work with multiple hashes', function () {
    expect(removeSearchHash('https://example.test/foo#remove#me')).to.eql(
      'https://example.test/foo',
    );
    expect(removeSearchHash('https://example.test/foo##remove#me')).to.eql(
      'https://example.test/foo',
    );
    expect(removeSearchHash('https://example.test/foo##')).to.eql(
      'https://example.test/foo',
    );
    expect(removeSearchHash('https://example.test/foo#remove#me#')).to.eql(
      'https://example.test/foo',
    );
  });
});
