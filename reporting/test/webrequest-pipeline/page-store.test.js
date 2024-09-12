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

import { mock } from 'sinon';
import { expect } from 'chai';

import PageStore from '../../src/webrequest-pipeline/page-store.js';
import { PAGE_LOADING_STATE } from '../../src/webrequest-pipeline/page.js';

describe('PageStore', () => {
  beforeEach(() => {
    chrome.flush();
    chrome.storage.session.get.yields({});
  });

  afterEach(() => {
    chrome.flush();
  });

  it('starts with empty tabs', async () => {
    const store = new PageStore({});
    await store.init();
    expect(store.tabs._inMemoryMap).to.deep.equal(new Map());
  });

  context('on chrome.tabs.onCreated', () => {
    it('creates a tab', async () => {
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

  context('on chrome.tabs.onUpdated', () => {
    it('creates a tab', async () => {
      const store = new PageStore({});
      await store.init();
      const tab = { id: 1 };
      chrome.tabs.onUpdated.dispatch(tab.id, {}, tab);
      expect(store.tabs.has(tab.id)).to.be.true;
      expect(store.tabs.get(tab.id)).to.deep.include({
        id: tab.id,
      });
    });

    it('updates a tab', async () => {
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

  context('on chrome.webNavigation.onBeforeNavigate', () => {
    it('creates a tab', async () => {
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

    it('stages the page', async () => {
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
      store.tabs.get(details.tabId).updateState(PAGE_LOADING_STATE.COMPLETE);
      chrome.webNavigation.onBeforeNavigate.dispatch({
        ...details,
        timeStamp: details.timeStamp + 300,
      });
      expect(listener).to.have.been.called;
    });

    it('ignore duplicates', async () => {
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
      store.tabs.get(details.tabId).updateState(PAGE_LOADING_STATE.COMPLETE);
      chrome.webNavigation.onBeforeNavigate.dispatch({
        ...details,
        timeStamp: details.timeStamp + 1,
      });
      expect(listener).to.not.have.been.called;
    });
  });
});
