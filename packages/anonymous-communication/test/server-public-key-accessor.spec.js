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
import sinon from 'sinon';
import { Buffer } from 'buffer';

import MemoryPersistentMap from './helpers/memory-map.js';

import ServerPublicKeyAccessor from '../src/server-public-key-accessor.js';
import logger from '../src/logger.js';

logger.disable();

async function mockedResponse({ body = '', error = false } = {}) {
  return {
    ok: !error,
    statusText: error ? 500 : 200,
    async json() {
      return JSON.parse(body);
    },
  };
}

const MOCKS = {
  reset() {
    this.dates = ['20200101', '20200102', '20200103', '20200104'];
    this.today = '20200102';
    this.fakeKey =
      'BARClm1SExH0+0gDAVZzuo0h13y433m5aiLcOdD0EZ5Gpvh1MNqQO86NncHM75pQiosg4629b2Pqst5VG6jAY6M=';
    this.fakeImportedKey = 'faked-imported-key';
    this.fetch = async () => {
      this.fetch._numCalls += 1;
      const pubKeys = {};
      this.dates.forEach((d) => {
        pubKeys[d] = this.fakeKey;
      });
      const body = JSON.stringify({ pubKeys });
      return mockedResponse({ body });
    };
    this.fetch._numCalls = 0;
    this.importKey = async () => this.fakeImportedKey;
  },
};

describe('#ServerPublicKeyAccessor', function () {
  let storage;
  let uut;
  const someStorageKey = 'test-storage-key';

  const assumeKeysOnDisk = async (storedKeys) => {
    const entry = storedKeys.map(({ date, key }) => [
      date,
      Buffer.from(key, 'base64'),
    ]);
    await storage.set(someStorageKey, entry);
  };

  beforeEach(async function () {
    // in-memory implementation of storage
    storage = new MemoryPersistentMap();
    const config = {
      COLLECTOR_DIRECT_URL: '192.0.2.0', // TEST-NET-1 address
    };
    uut = new ServerPublicKeyAccessor({
      config,
      storage,
      storageKey: someStorageKey,
    });
    MOCKS.reset();
    sinon.stub(window, 'fetch').callsFake(MOCKS.fetch);
    sinon.stub(crypto.subtle, 'importKey').callsFake(MOCKS.importKey);
  });

  afterEach(function () {
    window.fetch.restore();
    crypto.subtle.importKey.restore();
  });

  it('should be able to retrieve a key and cache it (happy path)', async function () {
    expect(await uut.getKey(MOCKS.today)).to.deep.equal({
      date: MOCKS.today,
      publicKey: MOCKS.fakeImportedKey,
    });
  });

  it('should be able to retrieve a key and cache it (race during initialization)', async function () {
    const results = await Promise.all([
      uut.getKey(MOCKS.today),
      uut.getKey(MOCKS.today),
      Promise.resolve().then(() => uut.getKey(MOCKS.today)),
      uut.getKey(MOCKS.today),
    ]);

    for (const result of results) {
      expect(result).to.deep.equal({
        date: MOCKS.today,
        publicKey: MOCKS.fakeImportedKey,
      });
    }
    expect(MOCKS.fetch._numCalls).to.equal(1);
  });

  it('should persist loaded keys to disk', async function () {
    await assumeKeysOnDisk([{ date: MOCKS.today, key: MOCKS.fakeKey }]);
    expect(await uut.getKey(MOCKS.today)).to.deep.equal({
      date: MOCKS.today,
      publicKey: MOCKS.fakeImportedKey,
    });
    expect(MOCKS.fetch._numCalls).to.equal(0);
  });
});
