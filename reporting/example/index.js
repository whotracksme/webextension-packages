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
import { UrlReporter, RequestReporter, setLogLevel } from '../src/index.js';

(chrome.action || chrome.browserAction).onClicked.addListener(() => {
  chrome.tabs.create({
    active: true,
    url: chrome.runtime.getURL('inspector/index.html'),
  });
});

setLogLevel('debug');

function createStorage() {
  const storage = {
    storage: {},
    async get(key) {
      return this.storage[key];
    },
    async set(key, value) {
      this.storage[key] = value;
    },
    async remove(key) {
      delete this.storage[key];
    },
    async clear() {
      this.storage = {};
    },
    async keys() {
      return Object.keys(this.storage);
    },
    open() {},
    close() {},
  };
  return storage;
}

const communication = {
  send(msg) {
    console.log(
      '%c[DRY-RUN] send message:',
      'color: blue; font-size: 30px;',
      msg,
    );
  },
  // TODO: use actual anonymous-communication to access quorum
  sendInstant(msg) {
    console.warn('[Communication instant]', msg);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result: true }),
    });
  },
  trustedClock: {
    getTimeAsYYYYMMDD() {
      return '';
    },
    getTimeAsYYYYMMDDHH() {
      return '';
    },
  },
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

const urlReporter = new UrlReporter({
  config: config.url,
  storage: createStorage(),
  connectDatabase: createStorage,
  communication,
});

const collectedReporterMessages = [];
let forceFlushInFlight = null;

const requestReporter = new RequestReporter(config.request, {
  dryRunMode: true,
  onMessageReady: (msg) => {
    collectedReporterMessages.push(msg);
    console.log(
      '%c[DRY-RUN] request-reporter message ready:',
      'color: green; font-size: 30px;',
      msg,
    );
  },
  countryProvider: urlReporter.countryProvider,
  trustedClock: communication.trustedClock,
  getBrowserInfo: () => ({ name: 'xx' }),
});

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
  } else if (request.action === 'e2e') {
    (async () => {
      try {
        if (request.op === 'waitReady') {
          await readyPromise;
          sendResponse({ ready: true });
        } else if (request.op === 'getReporterMessages') {
          sendResponse({ messages: collectedReporterMessages.slice() });
        } else if (request.op === 'resetReporterMessages') {
          collectedReporterMessages.length = 0;
          sendResponse({ ok: true });
        } else if (request.op === 'forceFlushPages') {
          // Serialize concurrent invocations: the bridge re-sends the same
          // op every 500ms while waiting for a response, so without a guard
          // two invocations can clobber each other's `Date.now` patch.
          if (!forceFlushInFlight) {
            forceFlushInFlight = (async () => {
              const realNow = Date.now;
              let offsetMs = 11 * 60 * 1000;
              Date.now = () => realNow() + offsetMs;
              try {
                // First flush sets each non-live page's stageAfter to now + BFCACHE_TTL.
                await requestReporter.pageStore.flush();
                // Second flush must run after that stageAfter to actually stage.
                offsetMs = 30 * 60 * 1000;
                await requestReporter.pageStore.flush();
              } finally {
                Date.now = realNow;
                forceFlushInFlight = null;
              }
            })();
          }
          await forceFlushInFlight;
          sendResponse({ ok: true });
        } else if (request.op === 'getPages') {
          const tabs = await chrome.tabs.query({});
          const pages = await Promise.all(
            tabs.map(async (tab) => {
              let documentId;
              try {
                const frames = await chrome.webNavigation.getAllFrames({
                  tabId: tab.id,
                });
                documentId = frames?.find((f) => f.frameId === 0)?.documentId;
              } catch (e) {
                // tab may have closed between query and getAllFrames
              }
              const page = documentId
                ? requestReporter.pageStore.getPageForRequest({ documentId })
                : null;
              if (!page) return { tabId: tab.id, tabUrl: tab.url, page: null };
              return {
                tabId: tab.id,
                tabUrl: tab.url,
                page: {
                  id: page.id,
                  url: page.url,
                  isPrivate: page.isPrivate,
                  documentIds: Array.from(page.documentIds || []),
                  requestStats: page.requestStats,
                },
              };
            }),
          );
          sendResponse({ pages });
        } else {
          sendResponse({ error: `unknown op: ${request.op}` });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    return true;
  }
});

const readyPromise = (async () => {
  await urlReporter.init();
  await requestReporter.init();
})();

globalThis.urlReporter = urlReporter;
globalThis.requestReporter = requestReporter;
