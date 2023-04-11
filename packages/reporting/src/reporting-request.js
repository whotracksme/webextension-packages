/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* eslint no-param-reassign: 'off' */
/* eslint func-names: 'off' */

import RequestMonitor from './request/index';
import telemetry from './request/telemetry';
import Config from './request/config';
import Database from './request/database';
import WebrequestPipeline from './request/webrequest-pipeline/index';

/**
 * @namespace antitracking
 * @class Background
 */
export default class ReportingRequest {
  /**
   * @method init
   * @param settings
   */
  async init() {
    this.webRequestPipeline = new WebrequestPipeline();
    await this.webRequestPipeline.init();
    this.db = new Database();
    await this.db.init();
    this.config = new Config({}, this.db);
    this.attrack = new RequestMonitor(this.db, this.webRequestPipeline);

    // indicates if the antitracking background is initiated
    this.enabled = true;
    this.clickCache = {};

    telemetry.setCommunication({ communicaton: this.communicaton });

    // load config
    this.webRequestPipeline.getPageStore().then((pageStore) => {
      this.pageStore = pageStore;
    });
    return this.config.init().then(() => {
      return this.attrack.init(this.config);
    });
  }

  /**
   * @method unload
   */
  unload() {
    if (this.attrack !== null) {
      this.attrack.unload();
      this.attrack = null;
    }
    this.webRequestPipeline.unload();
    this.enabled = false;
  }

  /**
   * State which will be passed to the content-script
   */
  getState() {
    return {
      cookieBlockingEnabled: this.config.cookieEnabled,
      compatibilityList: this.config.compatibilityList,
    };
  }

  addPipelineStep(stage, opts) {
    if (!this.attrack.pipelines || !this.attrack.pipelines[stage]) {
      return Promise.reject(
        new Error(`Could not add pipeline step: ${stage}, ${opts.name}`),
      );
    }

    return this.attrack.pipelines[stage].addPipelineStep(opts);
  }

  removePipelineStep(stage, name) {
    if (
      this.attrack &&
      this.attrack.pipelines &&
      this.attrack.pipelines[stage]
    ) {
      this.attrack.pipelines[stage].removePipelineStep(name);
    }
  }

  getWhitelist() {
    return this.attrack.qs_whitelist;
  }

  isEnabled() {
    return this.enabled;
  }

  disable() {
    this.unload();
  }

  enable() {
    this.init(this.settings);
  }

  // legacy api for mobile
  isSourceWhitelisted(domain) {
    return this.actions.isWhitelisted(domain);
  }

  addSourceDomainToWhitelist(domain) {
    return this.actions.changeWhitelistState(domain, 'hostname', 'add');
  }

  removeSourceDomainFromWhitelist(domain) {
    return this.actions.changeWhitelistState(domain, 'hostname', 'remove');
  }

  pause() {
    this.config.paused = true;
  }

  resume() {
    this.config.paused = false;
  }

  setWhiteListCheck(fn) {
    this.attrack.isWhitelisted = fn;
  }

  constructor(settings, communicaton) {
    this.settings = settings;
    this.communicaton = communicaton;
    this.eventHandlers = {
      'content:dom-ready': function onDomReady(url) {
        const domChecker = this.attrack.pipelineSteps.domChecker;

        if (!domChecker) {
          return;
        }

        domChecker.loadedTabs[url] = true;
        domChecker.recordLinksForURL(url);
        domChecker.clearDomLinks();
      },
      'control-center:antitracking-strict': () => {
        prefs.set('attrackForceBlock', !prefs.get('attrackForceBlock', false));
      },
      'core:mouse-down': function (...args) {
        if (this.attrack.pipelineSteps.cookieContext) {
          this.attrack.pipelineSteps.cookieContext.setContextFromEvent.call(
            this.attrack.pipelineSteps.cookieContext,
            ...args,
          );
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
    };
  }
}
