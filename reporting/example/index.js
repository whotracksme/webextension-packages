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
import './setup.js';
// Must stay above the src/ import: Logger binds console.* in its constructor.
import { attachConsoleSink } from './e2e/console-capture.js';
import { UrlReporter, RequestReporter, setLogLevel } from '../src/index.js';
import { createStorage, createTrustedClock } from './storage.js';
import E2EBridge, {
  createCommands,
  pipeJobEventsToHub,
} from './e2e/control.js';

(chrome.action || chrome.browserAction).onClicked.addListener(() => {
  chrome.tabs.create({
    active: true,
    url: chrome.runtime.getURL('inspector/index.html'),
  });
});

setLogLevel('debug');

const bridge = new E2EBridge({ hubUrl: 'ws://127.0.0.1:7878/ws' });
attachConsoleSink((level, text) => bridge.captureConsole(level, text));

const trustedClock = createTrustedClock();

// Stubbed: an end-to-end run exercises message construction, not quorum itself.
const quorumControl = {
  mode: 'always',
  setMode(mode) {
    if (!['always', 'never'].includes(mode)) {
      throw new Error(`unsupported quorum mode: ${mode}`);
    }
    this.mode = mode;
  },
  describe() {
    return { mode: this.mode, real: false };
  },
  verdict() {
    return this.mode === 'always';
  },
};

const communication = {
  send(msg) {
    bridge.captureMessage('url-reporter', msg);
    console.log('[DRY-RUN] send message:', msg);
  },
  sendInstant(msg) {
    const result = quorumControl.verdict();
    bridge.captureMessage('quorum', msg, { stubbedResult: result });
    console.warn('[Communication instant]', msg);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result }),
    });
  },
  trustedClock,
};

const config = {
  url: {
    ALLOWED_COUNTRY_CODES: ['de'],
    PATTERNS_URL:
      'https://cdn2.ghostery.com/staging-patterns/wtm-chrome-desktop/patterns.json',
    CONFIG_URL: 'https://api.ghostery.net/api/v1/config',
  },
  request: {
    configUrl: 'https://cdn.ghostery.com/antitracking/config.json',
    remoteWhitelistUrl: 'https://cdn.ghostery.com/antitracking/whitelist/2',
    localWhitelistUrl: '/base/assets/request',
  },
};

function connectDatabase(namespace) {
  return createStorage(namespace);
}

const urlReporter = new UrlReporter({
  config: config.url,
  storage: connectDatabase('urlreporter'),
  connectDatabase,
  communication,
});

const requestReporter = new RequestReporter(config.request, {
  dryRunMode: true,
  onMessageReady: (msg) => {
    bridge.captureMessage('request-reporter', msg);
    console.log('[DRY-RUN] request-reporter message ready:', msg);
  },
  countryProvider: urlReporter.countryProvider,
  trustedClock,
  getBrowserInfo: () => ({ name: 'xx' }),
});

pipeJobEventsToHub(urlReporter.jobScheduler, bridge);
bridge.registerCommands(
  createCommands({
    urlReporter,
    requestReporter,
    quorumControl,
    bridge,
  }),
);
bridge.connect();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'mousedown') {
    requestReporter.recordClick(
      request.event,
      request.context,
      request.href,
      sender,
    );
  } else if (request.action === 'debug') {
    (async () => {
      const tabs = await chrome.tabs.query({});

      sendResponse({
        tabs: tabs.map((tab) =>
          requestReporter.pageStore.getPageForRequest({
            tabId: tab.id,
            frameId: 0,
          }),
        ),
      });
    })();

    return true;
  }
});

(async () => {
  await urlReporter.init();
  await requestReporter.init();
})();

globalThis.urlReporter = urlReporter;
globalThis.requestReporter = requestReporter;
globalThis.e2eBridge = bridge;
