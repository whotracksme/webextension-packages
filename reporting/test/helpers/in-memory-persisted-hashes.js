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

import PersistedHashes from '../../src/persisted-hashes.js';

export function createInMemoryPersistedHashes() {
  const storageKey = 'some-key';
  const storage = {
    async get(key) {
      expect(key).to.equal(storageKey);
      return this._content;
    },
    async set(key, obj) {
      expect(key).to.equal(storageKey);
      this._content = obj;
    },
  };
  return new PersistedHashes({ storage, storageKey });
}
