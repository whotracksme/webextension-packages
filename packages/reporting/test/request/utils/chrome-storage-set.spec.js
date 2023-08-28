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

import * as chai from 'chai';

import ChromeStorageSet from '../../../src/request/utils/chrome-storage-set';

describe('utils/chrome-storage-map', function () {
  it('add / has', function () {
    const set = new ChromeStorageSet({
      storageKey: 'test',
    });
    const value = 2;
    set.add(value);
    chai.expect(set.has(value)).to.equal(true);
  });

  it('normalises numbers', function () {
    const set = new ChromeStorageSet({
      storageKey: 'test',
    });
    set.add(2);
    chai.expect(set.has('2')).to.equal(true);
  });
});
