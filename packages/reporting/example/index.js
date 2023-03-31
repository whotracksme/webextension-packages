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
import rules from './rules.json';

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
  send() {},
  getTrustedUtcTime() {
    return Date.now();
  },
};

const config = {
  ALLOWED_COUNTRY_CODES: ['de'],
  PATTERNS_URL: '',
  CONFIG_URL: 'https://api.ghostery.net/api/v1/config',
};

const requestMonitor = new RequestMonitor(config, communication);

const reporting = new Reporting({
  config,
  storage,
  communication,
});

(async function () {
  await requestMonitor.init();
  await reporting.init();
  await reporting.patterns.updatePatterns(rules);
  await reporting.analyzeUrl('https://www.google.com/search?q=shoes');
  await reporting.processPendingJobs();
})();

globalThis.reporting = reporting;
