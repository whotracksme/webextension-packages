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

import { IDBFactory } from 'fake-indexeddb';
import { expect } from 'chai';
import { deleteDB } from 'idb';

import Database from '../../src/request/database.js';

describe('request/database', function () {
  let database;

  beforeEach(async function () {
    globalThis.indexedDB = new IDBFactory();

    if (database) {
      await database.unload();
      await deleteDB(database.tableName);
    }
    database = new Database();
    await database.init();
  });

  afterEach(function () {
    delete globalThis.indexedDB;
  });

  describe('#tokens', function () {
    it('#bulkPut', async function () {
      const token = {
        token: '8b72dcfadc69a786b66584b8b69d0512',
        created: 10060,
        safe: false,
        lastSent: '',
        sites: ['a10104ad75306d26', '6287472925cbc9b4'],
        trackers: [
          'e10f949fcaacdb19',
          'e317a68e65ec3e72',
          '14dd5266c70789bd',
          '685c1532a4c8585c',
          'b1d934463190cb39',
          '9521166916c82eac',
          '513d8f48d45a9708',
          'aaaa9055e37b2c41',
          '04e2599b3faf050b',
          '2388a0be94d354c3',
          '0fc2925edc331870',
          'b8ea0ff0ff328509',
          'a1da39e35b260336',
          'dd9091206cde9290',
          'dbb493430c36961e',
          '7936b9e9fc6b1595',
          '6dd56db607da346c',
          '4b1f42f90487b5be',
          'fe61a5b83c837c9f',
          '1a3c9a8ebcc58dac',
          '1d5920f4b44b27a8',
          '78f46604122e0a47',
          '2952759073d266f1',
          '8ea58e416a21d5bb',
          '2343ec78a04c6ea9',
          '1df7e81cf5e2db18',
          'f989f85475637850',
          'dbbc49f14541867e',
          'e244a3dd0980a641',
          '421d522c51846d95',
          '6660d08b6d1c5653',
          '25ac106d69e67d6b',
          '135b955866e31ce0',
          'aef0ae912fccaca6',
          '3a59fb0cba397714',
          'b7961d2144027cc7',
          '39e67d76e378a4d8',
          '824a9c5b7b39d556',
          '05d986b30d7eb849',
        ],
        count: 1,
      };
      expect(await database.tokens.count()).to.equal(0);
      await database.tokens.bulkPut([
        token,
        // add the same token with a different id
        { ...token, token: 1 },
      ]);
      expect(await database.tokens.count()).to.equal(2);
    });
  });
});
