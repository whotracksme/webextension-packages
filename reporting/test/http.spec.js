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

import { replacePlaceholders } from '../src/http.js';

describe('#replacePlaceholders', function () {
  const emptyContext = {
    cookie: new Map(),
  };

  const cookie_x_to_y = {
    cookie: new Map([['x', 'y']]),
  };

  it('should work with empty strings', function () {
    expect(replacePlaceholders({ key: '' }, emptyContext)).to.eql({ key: '' });
  });

  it('should work with expressions without placeholders', function () {
    expect(replacePlaceholders({ key: 'foo' }, emptyContext)).to.eql({
      key: 'foo',
    });
  });

  it('should replace one placeholder in the start', function () {
    expect(
      replacePlaceholders({ key: '{{cookie:x}};bar' }, cookie_x_to_y),
    ).to.eql({ key: 'y;bar' });
  });

  it('should replace one placeholder in the middle', function () {
    expect(
      replacePlaceholders({ key: 'foo={{cookie:x}};bar' }, cookie_x_to_y),
    ).to.eql({ key: 'foo=y;bar' });
  });

  it('should replace one placeholder at the end', function () {
    expect(
      replacePlaceholders({ key: 'foo={{cookie:x}}' }, cookie_x_to_y),
    ).to.eql({ key: 'foo=y' });
  });

  it('should support multiple placeholders', function () {
    expect(
      replacePlaceholders(
        { key: 'foo={{cookie:x}};bar={{cookie:x}}' },
        cookie_x_to_y,
      ),
    ).to.eql({ key: 'foo=y;bar=y' });
  });
});
