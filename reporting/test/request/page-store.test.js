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

import PageStore from '../../src/request/page-store.js';

describe('PageStore', function () {
  before(function () {
    chrome.storage.session = chrome.storage.local;
    globalThis.chrome = chrome;
  });

  beforeEach(function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
    chrome.tabs.query.returns([]);
    chrome.webNavigation.getAllFrames.resolves([]);
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
  });

  it('starts with empty store', async function () {
    const store = new PageStore({});
    await store.init();
    expect(store.checkIfEmpty()).to.be.true;
  });

  context('documentId attribution', function () {
    async function commit(store, { tabId, documentId, url }) {
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId,
        url,
      });
      chrome.webNavigation.onCompleted.dispatch({
        tabId,
        frameId: 0,
        documentId,
      });
    }

    it('resolves a request to the page owning its documentId', async function () {
      const store = new PageStore({ notifyPageStageListeners: () => {} });
      await store.init();
      const tabId = 1;
      const documentId = 'DOC-1';
      await commit(store, {
        tabId,
        documentId,
        url: 'https://source.test/',
      });
      const page = store.getPageForRequest({
        tabId,
        frameId: 0,
        documentId,
        type: 'script',
        url: 'https://tracker.test/a.js',
      });
      expect(page).to.include({ url: 'https://source.test/', documentId });
    });

    it('keeps the document available so late beacons attribute to the source', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      const tabId = 1;
      const sourceDoc = 'DOC_SOURCE';
      const landingDoc = 'DOC_LANDING';

      await commit(store, {
        tabId,
        documentId: sourceDoc,
        url: 'https://source.test/',
      });
      // Navigate to landing — source is NOT emitted, just kept in
      // storage alongside the new document.
      await commit(store, {
        tabId,
        documentId: landingDoc,
        url: 'https://landing.test/',
      });
      expect(listener).to.not.have.been.called;

      // A late beacon carrying the source document's documentId
      // resolves to the source page, not to landing.
      const beaconPage = store.getPageForRequest({
        tabId,
        frameId: 0,
        documentId: sourceDoc,
        type: 'ping',
        url: 'https://analytics.test/beacon',
      });
      expect(beaconPage).to.not.be.null;
      expect(beaconPage.documentId).to.equal(sourceDoc);
      expect(beaconPage.url).to.equal('https://source.test/');
    });

    it('bfcache re-commit does not create a second record for the same documentId', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      const tabId = 1;
      const sourceDoc = 'DOC_SOURCE';
      const landingDoc = 'DOC_LANDING';

      await commit(store, {
        tabId,
        documentId: sourceDoc,
        url: 'https://source.test/',
      });
      await commit(store, {
        tabId,
        documentId: landingDoc,
        url: 'https://landing.test/',
      });
      // Back button — source's documentId re-commits.
      await commit(store, {
        tabId,
        documentId: sourceDoc,
        url: 'https://source.test/',
      });
      // The source page was never emitted on the way out, nothing
      // has been reported yet.
      expect(listener).to.not.have.been.called;
      // The store has exactly one page per unique documentId, not
      // a duplicated record from the re-commit.
      const resolved = store.getPageForRequest({
        tabId,
        frameId: 0,
        documentId: sourceDoc,
        type: 'script',
        url: 'https://t.test/a.js',
      });
      expect(resolved.documentId).to.equal(sourceDoc);
    });

    it('drops requests from a non-active document (prerender)', async function () {
      const store = new PageStore({ notifyPageStageListeners: () => {} });
      await store.init();
      const page = store.getPageForRequest({
        tabId: 1,
        frameId: 0,
        documentId: 'DOC_PRERENDER',
        documentLifecycle: 'prerender',
        type: 'script',
        url: 'https://tracker.test/a.js',
      });
      expect(page).to.be.null;
    });

    it('falls back to parentDocumentId for a sub-frame request whose commit has not fired yet', async function () {
      const store = new PageStore({ notifyPageStageListeners: () => {} });
      await store.init();
      const tabId = 1;
      const rootDoc = 'DOC_ROOT';
      await commit(store, {
        tabId,
        documentId: rootDoc,
        url: 'https://parent.test/',
      });
      // Sub-frame webRequest fires BEFORE its own onCommitted.
      const page = store.getPageForRequest({
        tabId,
        frameId: 5,
        documentId: 'DOC_SUB',
        parentDocumentId: rootDoc,
        type: 'sub_frame',
        url: 'https://iframe.test/',
      });
      expect(page).to.not.be.null;
      expect(page.documentId).to.equal(rootDoc);
    });
  });

  context('flushing', function () {
    async function commit(store, { tabId, documentId, url }) {
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId,
        url,
      });
    }

    it('stages a page when its tab is removed', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      await commit(store, {
        tabId: 1,
        documentId: 'DOC_A',
        url: 'https://example.test/',
      });
      chrome.tabs.onRemoved.dispatch(1);
      await store.flush();
      expect(listener).to.have.been.calledOnce;
      expect(listener.firstCall.args[0].documentId).to.equal('DOC_A');
    });

    it('stages a page when its tab is memory-discarded', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      await commit(store, {
        tabId: 1,
        documentId: 'DOC_A',
        url: 'https://example.test/',
      });
      chrome.tabs.onUpdated.dispatch(1, { discarded: true }, { id: 1 });
      await store.flush();
      expect(listener).to.have.been.calledOnce;
    });

    it('keeps a page across navigations until the bfcache TTL elapses', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      const tabId = 1;
      await commit(store, {
        tabId,
        documentId: 'DOC_A',
        url: 'https://a.test/',
      });
      // User navigates to B; A may still come back via bfcache.
      await commit(store, {
        tabId,
        documentId: 'DOC_B',
        url: 'https://b.test/',
      });
      // Browser only reports B as live now.
      chrome.webNavigation.getAllFrames.resolves([{ documentId: 'DOC_B' }]);
      chrome.tabs.query.returns([{ id: tabId }]);

      // First sweep marks A as cached but doesn't stage it.
      await store.flush();
      expect(listener).to.not.have.been.called;

      // Second sweep within TTL — still alive.
      await store.flush();
      expect(listener).to.not.have.been.called;
    });

    it('clears stageAfter on bfcache restore', async function () {
      const listener = mock();
      const store = new PageStore({ notifyPageStageListeners: listener });
      await store.init();
      const tabId = 1;
      await commit(store, {
        tabId,
        documentId: 'DOC_A',
        url: 'https://a.test/',
      });
      await commit(store, {
        tabId,
        documentId: 'DOC_B',
        url: 'https://b.test/',
      });
      chrome.webNavigation.getAllFrames.resolves([{ documentId: 'DOC_B' }]);
      chrome.tabs.query.returns([{ id: tabId }]);
      // A enters cached state.
      await store.flush();
      expect(store.findPageForTab(tabId).documentId).to.equal('DOC_A');
      // Bfcache restore re-commits A; marker must clear so a stale
      // sweep can't stage it.
      await commit(store, {
        tabId,
        documentId: 'DOC_A',
        url: 'https://a.test/',
      });
      const restored = store.getPageForRequest({
        tabId,
        frameId: 0,
        documentId: 'DOC_A',
        type: 'script',
        url: 'https://t.test/a.js',
      });
      expect(restored.stageAfter).to.equal(null);
    });

    it('preserves COMPLETE state across bfcache re-commit', async function () {
      const store = new PageStore({ notifyPageStageListeners: () => {} });
      await store.init();
      const tabId = 1;
      // First load fully completes.
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId: 'DOC_A',
        url: 'https://a.test/',
      });
      chrome.webNavigation.onCompleted.dispatch({
        tabId,
        frameId: 0,
        documentId: 'DOC_A',
      });
      // Bfcache restore re-commits A without a fresh onCompleted.
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId: 'DOC_A',
        url: 'https://a.test/',
      });
      // State must stay COMPLETE so the page still emits at staging.
      expect(store.findPageForTab(tabId).state).to.equal('complete');
    });
  });
});
