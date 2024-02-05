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

import { titlesMatchAfterDoublefetch } from '../src/doublefetch-page-handler.js';

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
