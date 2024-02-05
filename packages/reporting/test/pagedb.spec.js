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
import * as fc from 'fast-check';

import PageDB, { toPersistedKey, parsePersistedKey } from '../src/pagedb.js';
import InMemoryDatabase from './helpers/in-memory-database.js';
import { InMemoryNewPageApprover } from './helpers/pagedb-mocks.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

describe('#toPersistedKey and #parsePersistedKey', function () {
  it('should be invertable', function () {
    fc.assert(
      fc.property(fc.fullUnicodeString(), fc.integer(), (url, createdAt) => {
        const result = parsePersistedKey(toPersistedKey(url, createdAt));
        expect(result.url).to.eql(url);
        expect(result.createdAt).to.eql(createdAt);
      }),
    );
  });
});

describe('#PageDB', function () {
  let uut;
  let clock;
  let database;
  let newPageApprover;

  function somePage({
    url = 'https://www.ghostery.test/',
    title = 'Best Ad Blocker & Privacy Browser | Ghostery',
  } = {}) {
    return {
      status: 'complete',
      title,
      url,
      visibility: 'unknown',
      lastUpdatedAt: 1692303453063,
      preDoublefetch: {
        content: {
          numHiddenInputs: 0,
          numInputs: 0,
          numLinks: 65,
          numNodes: 402,
          numPasswordFields: 0,
        },
        meta: {
          canonicalUrl: 'https://www.ghostery.test/',
          language: 'en',
        },
        noindex: false,
        title: 'Best Ad Blocker & Privacy Browser | Ghostery',
        lastUpdatedAt: 1692303452956,
      },
      redirects: [
        {
          from: 'https://ghostery.test/',
          to: 'https://www.ghostery.test/',
          statusCode: 301,
        },
      ],
    };
  }

  async function expectUrlsInMemory(expectedUrls) {
    const { memory } = await uut.describeState();
    const urlsInMemory = Object.keys(memory);
    expect(urlsInMemory).to.have.members(expectedUrls);
  }

  async function expectUrlsInDb(expectedUrls) {
    const { disk } = await uut.describeState();
    const urlsInDb = Object.keys(disk).map((key) => parsePersistedKey(key).url);
    expect(urlsInDb).to.have.members(expectedUrls);
  }

  async function expectDbToBeEmpty() {
    await expectUrlsInDb([]);
  }

  async function passesSelfChecks() {
    const checks = await uut.selfChecks();
    expect(checks.allPassed()).to.be.true;
  }

  function initMocks() {
    clock?.restore();
    clock = sinon.useFakeTimers(new Date('2020-01-01'));

    database = new InMemoryDatabase();
    newPageApprover = new InMemoryNewPageApprover();
    uut = new PageDB({ database, newPageApprover });
  }

  function tearDown() {
    clock?.restore();
    clock = null;
    database = null;
    newPageApprover = null;
    uut = null;
  }

  beforeEach(function () {
    initMocks();
  });

  afterEach(function () {
    tearDown();
  });

  describe('#ready', function () {
    it('should pass all checks', async function () {
      await uut.ready();
      await passesSelfChecks();
    });
  });

  describe('#updatePages', function () {
    beforeEach(async function () {
      await uut.ready();
    });

    it('should support an update with an empty tab list', async function () {
      await expectDbToBeEmpty();
      const openPages = [];
      const activePage = undefined;
      await uut.updatePages(openPages, activePage);

      await expectDbToBeEmpty();
      await passesSelfChecks();

      await clock.runAllAsync();
      await expectDbToBeEmpty();
      await passesSelfChecks();
    });

    it('should support to add one active tab', async function () {
      const page = somePage();
      const openPages = [page];
      await uut.updatePages(openPages, page);
      await expectUrlsInMemory([page.url]);

      await clock.runAllAsync();
      await expectUrlsInMemory([page.url]);
      await expectUrlsInDb([page.url]);
    });

    it('should support to add one non-active tab', async function () {
      const page = somePage();
      const openPages = [page];
      await uut.updatePages(openPages, undefined);
      await expectUrlsInMemory([page.url]);

      await clock.runAllAsync();
      await expectUrlsInMemory([page.url]);
      await expectUrlsInDb([page.url]);
    });
  });

  describe('#acquireExpiredPages', function () {
    beforeEach(async function () {
      await uut.ready();
    });

    it('should not fail if no pages have been seen yet', async function () {
      expect(await uut.acquireExpiredPages()).to.eql([]);

      // make sure that all expirations expired
      clock.tick(1 * YEAR);
      await clock.runAllAsync();

      expect(await uut.acquireExpiredPages()).to.eql([]);
    });

    it('should support to add one non-active tab', async function () {
      const page = somePage();
      const openPages = [page];
      await uut.updatePages(openPages, undefined);
      await clock.runAllAsync();
      clock.tick(1 * YEAR);
      await clock.runAllAsync();
      await passesSelfChecks();

      const expiredPages = await uut.acquireExpiredPages();
      expect(expiredPages).to.have.lengthOf(1);
      expect(expiredPages[0]).to.have.property('url', page.url);
      expect(expiredPages[0]).to.have.property('title', page.title);
      await passesSelfChecks();
    });
  });

  describe('URL normalization', function () {
    it('should merge pages that are the same except for the URL fragment', async function () {
      const simplUrl = 'https://de.wikipedia.test/wiki/Elefanten';
      const urls = [
        simplUrl,
        'https://de.wikipedia.test/wiki/Elefanten#Verbreitung',
        'https://de.wikipedia.test/wiki/Elefanten#Elefanten_und_Menschen',
      ];
      const title = 'Elefanten – Wikipedia';
      const openPages = urls.map((url) => somePage({ url, title }));
      await uut.updatePages(openPages, undefined);
      await expectUrlsInMemory([simplUrl]);

      await clock.runAllAsync();
      await expectUrlsInMemory([simplUrl]);
      await expectUrlsInDb([simplUrl]);
      await passesSelfChecks();
    });
  });

  describe('emergency cleanup', function () {
    it('should purge the database if the number of keys overruns', async function () {
      expect(uut.maxAllowedMappings).to.be.above(100);
      expect(await database.keys()).to.have.lengthOf(0);

      // simulate a key overrun
      const length = uut.maxAllowedMappings + 1;
      const fakeUrls = Array.from(
        { length },
        (_, i) => `https://example.test/foo/${i}/`,
      );
      const createdAt = Date.now();
      await Promise.all(
        fakeUrls.map((url) => database.set(toPersistedKey(url, createdAt))),
      );
      expect(await database.keys()).to.have.lengthOf(length);

      // this should clean the database
      await uut.ready();
      expect(await database.keys()).to.have.lengthOf(0);
      await passesSelfChecks();
    });
  });
});
