/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* eslint no-param-reassign: 'off' */
/* eslint func-names: 'off' */

import Attrack from './attrack';
import { DEFAULT_ACTION_PREF, updateDefaultTrackerTxtRule } from './tracker-txt';
import prefs from '../core/prefs';
import Config from './config';
import { updateTimestamp } from './time';
import { parse } from './utils/url';

/**
* @namespace antitracking
* @class Background
*/
export default {
  requiresServices: ['domainInfo', 'pacemaker'],

  attrack: null,

  /**
  * @method init
  * @param settings
  */
  init(settings) {
    // Create new attrack class
    this.settings = settings;

    this.attrack = new Attrack();

    // indicates if the antitracking background is initiated
    this.enabled = true;
    this.clickCache = {};

    // load config
    this.config = new Config({});
    this.attrack.webRequestPipeline.action('getPageStore').then((pageStore) => {
      this.pageStore = pageStore;
    });
    return this.config.init().then(() => {
      return this.attrack.init(this.config, settings);
    });
  },

  /**
  * @method unload
  */
  unload() {
    if (this.attrack !== null) {
      this.attrack.unload();
      this.attrack = null;
    }

    this.enabled = false;
  },

  /**
   * State which will be passed to the content-script
   */
  getState() {
    return {
      cookieBlockingEnabled: this.config.cookieEnabled,
      compatibilityList: this.config.compatibilityList,
    };
  },

  async currentWindowStatus({ id, url: u }) {
    if (this.attrack === null) {
      return this.status();
    }

    return this.attrack.getTabBlockingInfo(id, u)
      .then((info) => {
        const url = parse(info.url);
        const ps = info.ps;
        const hostname = url ? url.hostname : '';
        const isWhitelisted = url !== null && this.attrack.urlWhitelist.isWhitelisted(
          url.href,
          url.hostname,
          url.generalDomain,
        );
        const enabled = prefs.get('modules.antitracking.enabled', true) && !isWhitelisted;
        let s;

        if (enabled) {
          s = 'active';
        } else if (isWhitelisted) {
          s = 'inactive';
        } else {
          s = 'critical';
        }

        return {
          visible: true,
          strict: prefs.get('attrackForceBlock', false),
          hostname,
          cookiesCount: info.cookies.blocked,
          requestsCount: info.requests.unsafe,
          totalCount: info.cookies.blocked + info.requests.unsafe,
          badgeData: this.getBadgeData(info),
          enabled,
          isWhitelisted: isWhitelisted || enabled,
          reload: info.reload || false,
          trackersList: info,
          ps,
          state: s
        };
      });
  },

  getBadgeData(info) {
    if (this.attrack === null || this.attrack.urlWhitelist.isWhitelisted(info.url)) {
      // do not display number if site is whitelisted
      return 0;
    }
    return info.cookies.blocked + info.requests.unsafe;
  },

  actions: {
    getBadgeData({ tabId, url }) {
      if (this.attrack === null) {
        return 0;
      }

      return this.attrack.getTabBlockingInfo(tabId, url).then(info => this.getBadgeData(info));
    },
    getCurrentTabBlockingInfo() {
      return this.attrack.getCurrentTabBlockingInfo();
    },
    addPipelineStep(stage, opts) {
      if (!this.attrack.pipelines || !this.attrack.pipelines[stage]) {
        return Promise.reject(new Error(`Could not add pipeline step: ${stage}, ${opts.name}`));
      }

      return this.attrack.pipelines[stage].addPipelineStep(opts);
    },
    removePipelineStep(stage, name) {
      if (this.attrack && this.attrack.pipelines && this.attrack.pipelines[stage]) {
        this.attrack.pipelines[stage].removePipelineStep(name);
      }
    },
    getWhitelist() {
      return this.attrack.qs_whitelist;
    },
    getTrackerListForTab(tab) {
      return this.attrack.getTrackerListForTab(tab);
    },
    getGhosteryStats(tabId) {
      if (!this.pageStore) {
        return { bugs: {}, others: {} };
      }
      const page = this.pageStore.tabs.get(tabId);
      if (!page
          || !page.annotations
          || !page.annotations.counter) {
        return {
          bugs: {},
          others: {},
        };
      }
      return page.annotations.counter.getSummary();
    },
    isEnabled() {
      return this.enabled;
    },
    disable() {
      this.unload();
    },
    enable() {
      this.init(this.settings);
    },

    isWhitelisted(url) {
      return this.attrack.urlWhitelist.isWhitelisted(url);
    },

    changeWhitelistState(url, type, action) {
      return this.attrack.urlWhitelist.changeState(url, type, action);
      this.attrack.logWhitelist(hostname);
    },

    getWhitelistState(url) {
      return this.attrack.urlWhitelist.getState(url);
    },

    // legacy api for mobile
    isSourceWhitelisted(domain) {
      return this.actions.isWhitelisted(domain);
    },

    addSourceDomainToWhitelist(domain) {
      return this.actions.changeWhitelistState(domain, 'hostname', 'add');
    },

    removeSourceDomainFromWhitelist(domain) {
      return this.actions.changeWhitelistState(domain, 'hostname', 'remove');
    },

    setConfigOption(prefName, value) {
      this.config.setPref(prefName, value);
    },

    pause() {
      this.config.paused = true;
    },

    resume() {
      this.config.paused = false;
    },

    setWhiteListCheck(fn) {
      this.attrack.isWhitelisted = fn;
    }
  },

  status() {
    const enabled = prefs.get('modules.antitracking.enabled', true);
    return {
      visible: true,
      strict: prefs.get('attrackForceBlock', false),
      state: enabled ? 'active' : 'critical',
      totalCount: 0,
    };
  },

  events: {
    prefchange: function onPrefChange(pref) {
      if (pref === DEFAULT_ACTION_PREF) {
        updateDefaultTrackerTxtRule();
      } else if (pref === 'config_ts') {
        // update date timestamp set in humanweb
        updateTimestamp(prefs.get('config_ts', null));
      }
      this.config.onPrefChange(pref);
    },
    'content:dom-ready': function onDomReady(url) {
      const domChecker = this.attrack.pipelineSteps.domChecker;

      if (!domChecker) {
        return;
      }

      domChecker.loadedTabs[url] = true;
      domChecker.recordLinksForURL(url);
      domChecker.clearDomLinks();
    },
    'antitracking:whitelist:add': function (hostname, isPrivateMode) {
      this.attrack.urlWhitelist.changeState(hostname, 'hostname', 'add');
    },
    'antitracking:whitelist:remove': function (hostname, isPrivateMode) {
      this.attrack.urlWhitelist.changeState(hostname, 'hostname', 'remove');
    },
    'control-center:antitracking-strict': () => {
      prefs.set('attrackForceBlock', !prefs.get('attrackForceBlock', false));
    },
    'core:mouse-down': function (...args) {
      if (this.attrack.pipelineSteps.cookieContext) {
        this.attrack.pipelineSteps.cookieContext.setContextFromEvent
          .call(this.attrack.pipelineSteps.cookieContext, ...args);
      }
    },
    'control-center:antitracking-clearcache': function (isPrivateMode) {
      this.attrack.clearCache();
    },
    'webrequest-pipeline:stage': function (page) {
      // send page-load telemetry
      if (this.attrack) {
        this.attrack.onPageStaged(page);
      }
    },
  },
};
