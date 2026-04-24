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
import { spy, match } from 'sinon';
import { expect } from 'chai';

import DocumentStore from '../../src/request/document-store.js';

describe('DocumentStore', function () {
  before(function () {
    chrome.storage.session = chrome.storage.local;
    globalThis.chrome = chrome;
  });

  beforeEach(function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
    chrome.tabs.query.returns([]);
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
  });

  it('starts empty', async function () {
    const store = new DocumentStore({});
    await store.init();
    expect(store.checkIfEmpty()).to.be.true;
  });

  it('creates a document eagerly on the main_frame webRequest', async function () {
    const store = new DocumentStore({});
    await store.init();
    const tabId = 1;
    chrome.tabs.onCreated.dispatch({
      id: tabId,
      incognito: false,
      active: true,
    });
    const doc = store.getDocumentForRequest({
      tabId,
      type: 'main_frame',
      documentId: 'doc-a',
      documentLifecycle: 'active',
      url: 'http://a.test/',
    });
    expect(doc).to.deep.include({
      id: tabId,
      url: 'http://a.test/',
      documentIds: ['doc-a'],
    });
  });

  it('onCommitted reaffirms the eager document and updates URL after redirect', async function () {
    const store = new DocumentStore({});
    await store.init();
    const tabId = 1;
    chrome.tabs.onCreated.dispatch({
      id: tabId,
      incognito: false,
      active: true,
    });
    store.getDocumentForRequest({
      tabId,
      type: 'main_frame',
      documentId: 'doc-a',
      documentLifecycle: 'active',
      url: 'http://pre-redirect.test/',
    });
    chrome.webNavigation.onCommitted.dispatch({
      tabId,
      frameId: 0,
      documentId: 'doc-a',
      url: 'http://final.test/',
      documentLifecycle: 'active',
    });
    const doc = store.getDocumentForRequest({
      tabId,
      type: 'image',
      documentId: 'doc-a',
      documentLifecycle: 'active',
    });
    expect(doc.url).to.equal('http://final.test/');
  });

  it('drops sub-resource requests with an unknown documentId', async function () {
    const store = new DocumentStore({});
    await store.init();
    const result = store.getDocumentForRequest({
      tabId: 1,
      type: 'image',
      documentId: 'unknown',
      documentLifecycle: 'active',
    });
    expect(result).to.equal(null);
  });

  it('drops requests whose documentLifecycle is not active', async function () {
    const store = new DocumentStore({});
    await store.init();
    const tabId = 1;
    chrome.tabs.onCreated.dispatch({ id: tabId, active: true });
    store.getDocumentForRequest({
      tabId,
      type: 'main_frame',
      documentId: 'doc-a',
      documentLifecycle: 'active',
      url: 'http://a.test/',
    });
    expect(
      store.getDocumentForRequest({
        tabId,
        documentId: 'doc-prerender',
        documentLifecycle: 'prerender',
      }),
    ).to.equal(null);
  });

  it('releases the previous document after its hold elapses', async function () {
    const onDocumentReleased = spy();
    const holdMs = 60_000;
    const store = new DocumentStore({ onDocumentReleased, holdMs });
    await store.init();
    const tabId = 1;
    chrome.tabs.onCreated.dispatch({ id: tabId, active: true });

    const mainFrame = (documentId, url) => {
      store.getDocumentForRequest({
        tabId,
        type: 'main_frame',
        documentId,
        documentLifecycle: 'active',
        url,
      });
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId,
        url,
        documentLifecycle: 'active',
      });
    };
    mainFrame('doc-a', 'http://a.test/');
    expect(onDocumentReleased).to.not.have.been.called;
    mainFrame('doc-b', 'http://b.test/');

    store.drainHeld(Date.now() + 2 * holdMs);
    expect(onDocumentReleased).to.have.been.calledWith(
      match({ id: tabId, url: 'http://a.test/', documentIds: ['doc-a'] }),
    );
  });

  it('bfcache restore cancels the hold on the restored document', async function () {
    const onDocumentReleased = spy();
    const holdMs = 60_000;
    const store = new DocumentStore({ onDocumentReleased, holdMs });
    await store.init();
    const tabId = 1;
    chrome.tabs.onCreated.dispatch({ id: tabId, active: true });

    const mainFrame = (documentId, url) => {
      store.getDocumentForRequest({
        tabId,
        type: 'main_frame',
        documentId,
        documentLifecycle: 'active',
        url,
      });
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId,
        url,
        documentLifecycle: 'active',
      });
    };
    mainFrame('doc-a', 'http://a.test/');
    mainFrame('doc-b', 'http://b.test/');
    // bfcache back to A before its hold drains — A's release is
    // cancelled, B goes into hold in its place.
    chrome.webNavigation.onCommitted.dispatch({
      tabId,
      frameId: 0,
      documentId: 'doc-a',
      url: 'http://a.test/',
      documentLifecycle: 'active',
      transitionQualifiers: ['forward_back'],
    });

    store.drainHeld(Date.now() + 2 * holdMs);
    const releasedDocs = onDocumentReleased
      .getCalls()
      .map((c) => c.args[0].documentIds[0]);
    expect(releasedDocs).to.deep.equal(['doc-b']);
  });

  it('tab removal holds the current document', async function () {
    const onDocumentReleased = spy();
    const holdMs = 60_000;
    const store = new DocumentStore({ onDocumentReleased, holdMs });
    await store.init();
    const tabId = 1;
    chrome.tabs.onCreated.dispatch({ id: tabId, active: true });
    store.getDocumentForRequest({
      tabId,
      type: 'main_frame',
      documentId: 'doc-a',
      documentLifecycle: 'active',
      url: 'http://a.test/',
    });
    chrome.tabs.onRemoved.dispatch(tabId);
    store.drainHeld(Date.now() + 2 * holdMs);
    expect(onDocumentReleased).to.have.been.calledWith(
      match({ documentIds: ['doc-a'] }),
    );
  });
});
