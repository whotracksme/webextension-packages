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

import { BloomFilter } from '../src/bloom-filters.js';
import NewPageApprover from '../src/new-page-approver.js';
import InMemoryDatabase from './helpers/in-memory-database.js';
import { createInMemoryPersistedHashes } from './helpers/in-memory-persisted-hashes.js';

describe('#NewPageApprover', function () {
  const url = 'https://example.test/foo';
  let uut;

  beforeEach(function () {
    const privatePageBloomFilter = new BloomFilter({
      database: new InMemoryDatabase(),
      name: 'test',
      partitions: [1009, 1013, 1019],
    });
    uut = new NewPageApprover(
      createInMemoryPersistedHashes(),
      privatePageBloomFilter,
    );
  });

  describe('#allowCreation', function () {
    it('should accept a new page', async function () {
      expect(await uut.allowCreation(url)).to.eql({ ok: true });
    });

    it('should reject a page until the end of its cooldown', async function () {
      expect(await uut.allowCreation(url)).to.eql({ ok: true });
      expect((await uut.allowCreation(url)).ok).to.eql(false);
    });

    it('should reject a page that was marked as private', async function () {
      await uut.markAsPrivate(url);
      expect((await uut.allowCreation(url)).ok).to.eql(false);
    });

    it('should not start the cooldown for a page that was marked as private', async function () {
      await uut.markAsPrivate(url);
      await uut.allowCreation(url);
      expect(uut.persistedHashes.entries.size).to.eql(0);
    });
  });

  describe('#mightBeMarkedAsPrivate', function () {
    it('should find only pages that were marked as private', async function () {
      expect(await uut.mightBeMarkedAsPrivate(url)).to.eql(false);

      await uut.markAsPrivate(url);
      expect(await uut.mightBeMarkedAsPrivate(url)).to.eql(true);
      expect(await uut.mightBeMarkedAsPrivate(`${url}/bar`)).to.eql(false);
    });
  });
});
