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
import FakeSessionApi from '../../helpers/fake-session-storage.js';

import ChromeStorageMap from '../../../src/request/utils/chrome-storage-map';

describe('utils/chrome-storage-map', function () {
  it('set / get', function () {
    const map = new ChromeStorageMap({
      sessionApi: new FakeSessionApi(),
      storageKey: 'test',
    });
    const key = 1;
    const value = 2;
    map.set(key, value);
    chai.expect(map.get(key)).to.equal(value);
  });
});
