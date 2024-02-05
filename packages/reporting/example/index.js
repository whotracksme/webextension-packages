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
import {
  UrlReporter,
  RequestReporter,
  WebRequestPipeline,
  setLogLevel,
} from '../src/index.js';
import rules from './rules.json';

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
    console.warn('[Communication]', msg);
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
    PATTERNS_URL: '',
    CONFIG_URL: 'https://api.ghostery.net/api/v1/config',
  },
  request: {
    configUrl: 'https://cdn.ghostery.com/antitracking/config.json',
    remoteWhitelistUrl: 'https://cdn.ghostery.com/antitracking/whitelist/2',
    localWhitelistUrl: '/base/assets/request',
  },
};

const webRequestPipeline = new WebRequestPipeline();

const urlReporter = new UrlReporter({
  config: config.url,
  storage: createStorage(),
  connectDatabase: createStorage,
  communication,
});

const requestReporter = new RequestReporter(config.request, {
  communication,
  webRequestPipeline,
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
    sendResponse({
      tabs: [...webRequestPipeline.pageStore.tabs._inMemoryMap.values()],
    });
  }
});

(async function () {
  await webRequestPipeline.init();
  await urlReporter.init();
  await urlReporter.patterns.updatePatterns(rules);
  await urlReporter.analyzeUrl('https://www.google.com/search?q=shoes');
  await urlReporter.processPendingJobs();
  await requestReporter.init();
})();

globalThis.webRequestPipeline = webRequestPipeline;
globalThis.urlReporter = urlReporter;
globalThis.requestReporter = requestReporter;
