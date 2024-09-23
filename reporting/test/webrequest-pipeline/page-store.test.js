/**
 * WhoTracks.Me
 * https://ghostery.com/whotracksme
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import chrome from 'sinon-chrome';
import { mock } from 'sinon';
import { expect } from 'chai';

import PageStore from '../../src/webrequest-pipeline/page-store.js';
import { PAGE_LOADING_STATE } from '../../src/webrequest-pipeline/page.js';

describe('PageStore', function () {
  before(function () {
    chrome.storage.session = chrome.storage.local;
    globalThis.chrome = chrome;
  });

  beforeEach(function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
  });

  it('starts with empty tabs', async function () {
    const store = new PageStore({});
    await store.init();
    expect(store.tabs.countNonExpiredKeys()).to.be.equal(0);
  });

  context('on chrome.tabs.onCreated', function () {
    it('creates a page', async function () {
      const store = new PageStore({});
      await store.init();
      const tab = { id: 1 };
      chrome.tabs.onCreated.dispatch(tab);
      expect(store.tabs.has(tab.id)).to.be.true;
      expect(store.tabs.get(tab.id)).to.deep.include({
        id: tab.id,
      });
    });
  });

  context('on chrome.tabs.onUpdated', function () {
    it('creates a page', async function () {
      const store = new PageStore({});
      await store.init();
      const tab = { id: 1 };
      chrome.tabs.onUpdated.dispatch(tab.id, {}, tab);
      expect(store.tabs.has(tab.id)).to.be.true;
      expect(store.tabs.get(tab.id)).to.deep.include({
        id: tab.id,
      });
    });

    it('updates a page', async function () {
      const store = new PageStore({});
      await store.init();
      const tab = { id: 1 };
      chrome.tabs.onCreated.dispatch(tab);
      expect(store.tabs.has(tab.id)).to.be.true;
      expect(store.tabs.get(tab.id)).to.deep.include({
        id: tab.id,
      });
      expect(store.tabs.get(tab.id)).to.have.property('url', undefined);
      chrome.tabs.onUpdated.dispatch(tab.id, { url: 'about:blank' }, tab);
      expect(store.tabs.get(tab.id)).to.have.property('url', 'about:blank');
    });
  });

  context('on chrome.webNavigation.onBeforeNavigate', function () {
    it('creates a page', async function () {
      const store = new PageStore({});
      await store.init();
      const details = { tabId: 1, frameId: 0, url: 'about:blank' };
      chrome.webNavigation.onBeforeNavigate.dispatch(details);
      expect(store.tabs.has(details.tabId)).to.be.true;
      expect(store.tabs.get(details.tabId)).to.deep.include({
        id: details.tabId,
        url: details.url,
      });
    });

    it('stages the page', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      const details = {
        tabId: 1,
        frameId: 0,
        url: 'about:blank',
        timeStamp: Date.now(),
      };
      chrome.webNavigation.onBeforeNavigate.dispatch(details);
      expect(listener).to.not.have.been.called;
      const page = store.tabs.get(details.tabId);
      page.state = PAGE_LOADING_STATE.COMPLETE;
      chrome.webNavigation.onBeforeNavigate.dispatch({
        ...details,
        timeStamp: details.timeStamp + 300,
      });
      expect(listener).to.have.been.calledWith(page);
    });

    it('ignore duplicates', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      const details = {
        tabId: 1,
        frameId: 0,
        url: 'about:blank',
        timeStamp: Date.now(),
      };
      chrome.webNavigation.onBeforeNavigate.dispatch(details);
      expect(listener).to.not.have.been.called;
      store.tabs.get(details.tabId).state = PAGE_LOADING_STATE.COMPLETE;
      chrome.webNavigation.onBeforeNavigate.dispatch({
        ...details,
        timeStamp: details.timeStamp + 1,
      });
      expect(listener).to.not.have.been.called;
    });
  });
});
