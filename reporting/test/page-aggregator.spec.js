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
      await uut.init();
      uut.unload();
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
  });
});
