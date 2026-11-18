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

import QuorumChecker from '../src/quorum-checker.js';
import { BloomFilter } from '../src/bloom-filters.js';
import InMemoryDatabase from './helpers/in-memory-database.js';

describe('#QuorumChecker', function () {
  let uut;
  let fetchStub;
  let sentIncrements;

  beforeEach(function () {
    // quorum config endpoint
    fetchStub = sinon.stub(globalThis, 'fetch').callsFake(async () => ({
      ok: true,
      json: async () => ({ oc: 42 }),
    }));

    sentIncrements = [];
    const communication = {
      async sendInstant({ path, payload }) {
        if (path === 'incrquorum') {
          sentIncrements.push(payload);
        }
        return { ok: true, json: async () => ({ result: false }) };
      },
    };

    let persistedConfig;
    const storage = {
      async get() {
        return persistedConfig;
      },
      async set(_, value) {
        persistedConfig = value;
      },
    };

    uut = new QuorumChecker({
      config: { SAFE_QUORUM_CONFIG_ENDPOINT: 'https://quorum.test/config' },
      storage,
      storageKey: 'quorum_check',
      bloomFilter: new BloomFilter({
        database: new InMemoryDatabase(),
        name: 'test',
        partitions: [1009, 1013, 1019],
      }),
      communication,
    });
  });

  afterEach(function () {
    fetchStub.restore();
  });

  describe('#sendQuorumIncrement', function () {
    it('should vote only once for the same text', async function () {
      const text = 'https://example.test/foo';
      await uut.sendQuorumIncrement({ text });
      await uut.sendQuorumIncrement({ text });
      await uut.sendQuorumIncrement({ text });

      expect(sentIncrements).to.have.lengthOf(1);
    });

    it('should vote for each text', async function () {
      await uut.sendQuorumIncrement({ text: 'https://example.test/foo' });
      await uut.sendQuorumIncrement({ text: 'https://example.test/bar' });

      expect(sentIncrements).to.have.lengthOf(2);
    });
  });
});
