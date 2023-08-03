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
import { deleteDB } from 'idb';

import Database from '../../src/request/database.js';

describe('Database', function () {
  let database;

  beforeEach(async function () {
    if (database) {
      await database.unload();
      await deleteDB(database.tableName);
    }
    database = new Database();
    await database.init();
  });

  describe('key-value storage', function () {
    const key = 'test';

    it('saves strings', async function () {
      const value = 'test';
      await database.set(key, value);
      return expect(database.get(key)).to.eventually.equal(value);
    });

    it('saves numbers', async function () {
      const value = Date.now();
      await database.set(key, value);
      return expect(database.get(key)).to.eventually.equal(value);
    });

    it('saves objects', async function () {
      const value = {
        a: 1,
        b: '2',
      };
      await database.set(key, value);
      return expect(database.get(key)).to.eventually.deep.equal(value);
    });

    it('saves ArrayBuffers', async function () {
      const value = new Uint8Array([0, 1, 2, 3]);
      await database.set(key, value.buffer);
      return expect(database.get(key)).to.eventually.deep.equal(value.buffer);
    });
  });
});
