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
import Reporting from '../src/index.js';
import RequestMonitor from '../src/reporting-request.js';
import { setLogLevel } from '../src/logger.js';
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

const reporting = new Reporting({
  config: config.url,
  storage,
  communication,
});

const requestMonitor = new RequestMonitor(config.request, {
  communication,
  countryProvider: reporting.countryProvider,
  trustedClock: communication.trustedClock,
});

(async function () {
  await reporting.init();
  await reporting.patterns.updatePatterns(rules);
  await reporting.analyzeUrl('https://www.google.com/search?q=shoes');
  await reporting.processPendingJobs();
  await requestMonitor.init();
})();

globalThis.reporting = reporting;
