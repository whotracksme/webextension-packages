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
import telemetry from './telemetry';
import Config from './config';
import AttrackDatabase from './database';


/**
* @namespace antitracking
* @class Background
*/
export default {
  attrack: null,

  /**
  * @method init
  * @param settings
  */
  async init(settings, communicaton) {
    // Create new attrack class
    this.settings = settings;

    this.db = new AttrackDatabase();
    await this.db.init()
    this.config = new Config({}, this.db);
    this.attrack = new Attrack(this.db);

    // indicates if the antitracking background is initiated
    this.enabled = true;
    this.clickCache = {};

    telemetry.setCommunication({ communicaton });

    // load config
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

  actions: {
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

  events: {
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
      this.attrack.logWhitelist(hostname);
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
