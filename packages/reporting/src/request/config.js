/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import asyncPrefs from '../platform/async-storage';
import { getConfigTs } from './time';
import pacemaker from '../utils/pacemaker';

const SETTINGS = {};
const CONFIG_URL = `${SETTINGS.ANTITRACKING_BASE_URL}/config.json`;
const WHITELIST2_URL = `${SETTINGS.ANTITRACKING_BASE_URL}/whitelist/2`;
const PROTECTION = 'antitrackingProtectionEnabled';

export const VERSION = '0.102';

export const COOKIE_MODE = {
  THIRD_PARTY: 'thirdparty',
  TRACKERS: 'trackers',
  GHOSTERY: 'ghostery',
};

export const DEFAULTS = {
  safekeyValuesThreshold: 4,
  shortTokenLength: 6,
  placeHolder: SETTINGS.antitrackingPlaceholder,
  cliqzHeader: SETTINGS.antitrackingHeader,
  enabled: true,
  cookieEnabled: Object.prototype.hasOwnProperty.call(SETTINGS, PROTECTION)
    ? SETTINGS[PROTECTION] : true,
  qsEnabled: Object.prototype.hasOwnProperty.call(SETTINGS, PROTECTION)
    ? SETTINGS[PROTECTION] : true,
  bloomFilterEnabled: true,
  sendAntiTrackingHeader: true,
  blockCookieNewToken: false,
  tpDomainDepth: 2,
  firstPartyIsolation: false,
  databaseEnabled: true,
  cookieMode: COOKIE_MODE.THIRD_PARTY,
};

export const PREFS = {
  enabled: 'modules.antitracking.enabled',
  cookieEnabled: 'attrackBlockCookieTracking',
  qsEnabled: 'attrackRemoveQueryStringTracking',
  fingerprintEnabled: 'attrackCanvasFingerprintTracking',
  referrerEnabled: 'attrackRefererTracking',
  trackerTxtEnabled: 'trackerTxt',
  bloomFilterEnabled: 'attrackBloomFilter',
  forceBlockEnabled: 'attrackForceBlock',
  overrideUserAgent: 'attrackOverrideUserAgent',
  cookieTrustReferers: 'attrackCookieTrustReferers',
  sendAntiTrackingHeader: 'attrackSendHeader',
  firstPartyIsolation: 'attrack.firstPartyIsolation',
  cookieMode: 'attrack.cookieMode',
};

/**
 * These are attributes which are loaded from the remote CONFIG_URL
 * @type {Array}
 */
const REMOTELY_CONFIGURED = ['blockRules', 'reportList', 'cookieWhitelist',
  'subdomainRewriteRules', 'compatibilityList'];

export default class Config {
  constructor({
    defaults = DEFAULTS,
    whitelistUrl = WHITELIST2_URL,
  }) {
    this.debugMode = false;
    this.whitelistUrl = whitelistUrl;

    this.tokenDomainCountThreshold = 2;
    this.safeKeyExpire = 7;
    this.localBlockExpire = 24;
    this.localBaseUrl = `${SETTINGS.baseURL}antitracking`;

    Object.assign(this, defaults);

    this.paused = false;
  }

  async init() {
    await this._loadConfig();
  }

  unload() {
  }

  async _loadConfig() {
    const storedConfig = await asyncPrefs.multiGet(['attrack.configLastUpdate', 'attrack.config']);
    const lastUpdate = storedConfig.reduce((obj, kv) => Object.assign(obj, { [kv[0]]: kv[1] }), {});
    const day = getConfigTs();
    // use stored config if it was already updated today
    if (storedConfig.length === 2 && (lastUpdate['attrack.configLastUpdate'] === day)) {
      this._updateConfig(JSON.parse(lastUpdate['attrack.config']));
      return;
    }
    const fetchUrl = CONFIG_URL;
    try {
      const conf = await (await fetch(fetchUrl)).json();
      this._updateConfig(conf);
      await asyncPrefs.multiSet([
        ['attrack.configLastUpdate', day],
        ['attrack.config', JSON.stringify(conf)],
      ]);
    } catch (e) {
      pacemaker.setTimeout(this._loadConfig.bind(this), 30000);
    }
  }

  _updateConfig(conf) {
    REMOTELY_CONFIGURED.forEach((key) => {
      this[key] = conf[key];
    });
  }
}
