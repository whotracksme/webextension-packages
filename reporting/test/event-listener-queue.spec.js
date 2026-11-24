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

import EventListenerQueue from '../src/event-listener-queue.js';
import Pages from '../src/pages.js';

class ListenerMock {
  constructor() {
    this._listeners = new Set();
  }

  addListener(handler) {
    this._listeners.add(handler);
  }

  removeListener(handler) {
    this._listeners.delete(handler);
  }

  hasListeners() {
    return this._listeners.size > 0;
  }

  dispatch(...args) {
    this._listeners.forEach((handler) => handler(...args));
  }
}

// Like the real API: a listener without a filter is an error. Also,
// not all events accept 'responseHeaders' (e.g. onBeforeRequest).
class WebRequestListenerMock extends ListenerMock {
  constructor({ supportsResponseHeaders }) {
    super();
    this.supportsResponseHeaders = supportsResponseHeaders;
  }

  addListener(handler, filter, extraInfoSpec = []) {
    if (!filter?.urls) {
      throw new TypeError('No matching signature: filter is missing');
    }
    if (
      extraInfoSpec.includes('responseHeaders') &&
      !this.supportsResponseHeaders
    ) {
      throw new TypeError('Invalid value for extraInfoSpec');
    }
    super.addListener(handler);
  }
}

function newChromeApiMock() {
  return {
    tabs: {
      query: async () => [],
      onCreated: new ListenerMock(),
      onUpdated: new ListenerMock(),
      onRemoved: new ListenerMock(),
      onActivated: new ListenerMock(),
    },
    webNavigation: {
      onBeforeNavigate: new ListenerMock(),
      onCommitted: new ListenerMock(),
    },
    webRequest: {
      onBeforeRequest: new WebRequestListenerMock({
        supportsResponseHeaders: false,
      }),
      onBeforeRedirect: new WebRequestListenerMock({
        supportsResponseHeaders: true,
      }),
    },
  };
}

function allListenerMocks(chrome) {
  return Object.values(chrome).flatMap((api) =>
    Object.values(api).filter((x) => x instanceof ListenerMock),
  );
}

describe('#EventListenerQueue', function () {
  let originalChrome;
  let chrome;
  let uut;

  function newEventListenerQueue() {
    return new EventListenerQueue({ listeners: Pages.describeListeners() });
  }

  beforeEach(function () {
    originalChrome = globalThis.chrome;
    chrome = newChromeApiMock();
    globalThis.chrome = chrome;
  });

  afterEach(function () {
    uut?.close();
    uut = null;
    globalThis.chrome = originalChrome;
  });

  it('should listen to all events that are available', function () {
    uut = newEventListenerQueue();
    for (const listener of allListenerMocks(chrome)) {
      expect(listener.hasListeners()).to.be.true;
    }
  });

  it('should keep the events, and replay them in the same order', function () {
    uut = newEventListenerQueue();
    const tab = { id: 1, url: 'https://example.test/' };
    chrome.webRequest.onBeforeRequest.dispatch({ tabId: 1, type: 'image' });
    chrome.tabs.onUpdated.dispatch(1, { status: 'loading' }, tab);
    chrome.webNavigation.onCommitted.dispatch({ tabId: 1, frameId: 0 });

    const calls = [];
    const target = Object.fromEntries(
      Pages.describeListeners().map(({ method }) => [
        method,
        (...args) => calls.push({ method, args }),
      ]),
    );
    uut.replayEvents(target);

    expect(calls).to.eql([
      {
        method: 'chrome_webRequest_onBeforeRequest',
        args: [{ tabId: 1, type: 'image' }],
      },
      {
        method: 'chrome_tabs_onUpdated',
        args: [1, { status: 'loading' }, tab],
      },
      {
        method: 'chrome_webNavigation_onCommitted',
        args: [{ tabId: 1, frameId: 0 }],
      },
    ]);
  });

  it('should remove its listeners after the replay', function () {
    uut = newEventListenerQueue();
    uut.replayEvents({});
    for (const listener of allListenerMocks(chrome)) {
      expect(listener.hasListeners()).to.be.false;
    }
  });

  it('should not fail if the chrome API is missing', function () {
    delete globalThis.chrome;
    uut = newEventListenerQueue();
    uut.replayEvents({});
  });
});
