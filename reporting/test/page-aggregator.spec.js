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

import PageDB from '../src/pagedb.js';
import PageAggregator from '../src/page-aggregator.js';
import InMemoryDatabase from './helpers/in-memory-database.js';
import { InMemoryNewPageApprover } from './helpers/pagedb-mocks.js';

class PagesMock {
  constructor() {
    this.state = {
      openTabs: {},
      activeTab: undefined,
    };
  }

  describe() {
    return this.state;
  }

  describeTab(/*tabId*/) {
    return null;
  }

  getActiveTabId() {
    return -1;
  }
}

class FakeJobScheduler {
  registerJobs(jobs) {
    expect(jobs).to.be.not.undefined;
  }
}

describe('#PageAggregator', function () {
  let uut;
  let pages;
  let pagedb;
  let jobScheduler;
  let newPageApprover;
  let database;
  let clock;

  beforeEach(function () {
    clock?.restore();
    clock = sinon.useFakeTimers(new Date('2020-01-01'));

    pages = new PagesMock();
    newPageApprover = new InMemoryNewPageApprover();
    database = new InMemoryDatabase();
    pagedb = new PageDB({ database, newPageApprover });
    jobScheduler = new FakeJobScheduler();
    uut = new PageAggregator({ pages, pagedb, jobScheduler });
  });

  afterEach(function () {
    clock?.restore();
    clock = null;
  });

  describe('#init', function () {
    it('load + unload should not fail', async function () {
      expect(uut.active).to.be.false;
      await uut.init();
      expect(uut.active).to.be.true;
      uut.unload();
      expect(uut.active).to.be.false;
    });

    it('should support multiple init and unload calls', async function () {
      await uut.init();
      await uut.init();
      uut.unload();
      uut.unload();
    });

    it('should support concurrent init calls', async function () {
      const pending = [uut.init(), uut.init(), uut.init()];
      await Promise.all([pending]);
      uut.unload();
    });
  });

  describe('when initialized', function () {
    beforeEach(async function () {
      await uut.init();
    });

    // TODO: extend the API to able to check some assertions
    it('#fullSync', async function () {
      uut.fullSync();
      await clock.runAllAsync();
    });

    describe('#onPageEvent', function () {
      const tabId = 42;
      const landingPage = {
        status: 'complete',
        title: 'Some landing page',
        url: 'https://www.example.test/landing',
        search: { category: 'go', query: 'some query', depth: 1 },
        lastUpdatedAt: 1577836800000,
      };

      async function pagesInDb() {
        await clock.runAllAsync();
        const { memory } = await pagedb.describeState({ inMemoryOnly: true });
        return memory;
      }

      beforeEach(function () {
        pages.describeTab = (id) => (id === tabId ? landingPage : null);
      });

      it('should sync the tab when the user lands on a search result', async function () {
        uut.onPageEvent({ type: 'safe-search-landing', tabId, details: {} });

        const memory = await pagesInDb();
        expect(Object.keys(memory)).to.eql([landingPage.url]);
        expect(memory[landingPage.url].search).to.eql(landingPage.search);
      });

      it('should ignore other navigation events', async function () {
        uut.onPageEvent({
          type: 'safe-page-navigation',
          tabId,
          url: landingPage.url,
        });

        expect(await pagesInDb()).to.eql({});
      });
    });
  });
});
