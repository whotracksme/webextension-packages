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
  WebrequestPipeline,
  setLogLevel,
} from '../src/index.js';
import rules from './rules.json';

setLogLevel('debug');

const storage = {
  storage: {},
  async get(key) {
    return this.storage[key];
  },
  async set(key, value) {
    this.storage[key] = value;
  },
};

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
    userAgent: 'ch',
    platform: '',
    configUrl: 'https://cdn.ghostery.com/antitracking/config.json',
    remoteWhitelistUrl: 'https://cdn.ghostery.com/antitracking/whitelist/2',
    localWhitelistUrl: '/base/assets/request',
  },
};

const webRequestPipeline = new WebrequestPipeline();
webRequestPipeline.init();

const urlReporter = new UrlReporter({
  config: config.url,
  storage,
  communication,
});

const requestReporter = new RequestReporter(config.request, {
  communication,
  webRequestPipeline,
  countryProvider: urlReporter.countryProvider,
  trustedClock: communication.trustedClock,
});

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === 'mousedown') {
    requestReporter.recordClick(
      request.event,
      request.context,
      request.href,
      sender,
    );
  }
});

(async function () {
  await urlReporter.init();
  await urlReporter.patterns.updatePatterns(rules);
  await urlReporter.analyzeUrl('https://www.google.com/search?q=shoes');
  await urlReporter.processPendingJobs();
  await requestReporter.init();
})();

globalThis.urlReporter = urlReporter;
globalThis.requestReporter = requestReporter;
