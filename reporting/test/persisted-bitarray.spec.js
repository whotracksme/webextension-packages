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

import PersistedBitarray from '../src/persisted-bitarray.js';
import InMemoryDatabase from './helpers/in-memory-database.js';

describe('#PersistedBitarray', function () {
  let database;

  beforeEach(function () {
    database = new InMemoryDatabase();
  });

  describe('#ready (cleanup of the database)', function () {
    it('should delete keys that do not match the shard configuration', async function () {
      await database.set('arr|test|v0|0', 'shard from an old version');

      const uut = new PersistedBitarray({ database, name: 'test', size: 1024 });
      await uut.ready();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await database.keys()).to.eql([]);
    });
  });
});
