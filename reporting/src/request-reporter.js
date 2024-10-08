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

import RequestMonitor from './request/index.js';
import Config from './request/config.js';
import Database from './request/database.js';

export default class RequestReporter {
  constructor(
    settings,
    {
      communication,
      countryProvider,
      trustedClock,
      webRequestPipeline,
      onTrackerInteraction,
      getBrowserInfo,
      isRequestAllowed,
    },
  ) {
    this.settings = settings;
    this.communication = communication;
    this.countryProvider = countryProvider;
    this.trustedClock = trustedClock;
    this.webRequestPipeline = webRequestPipeline;
    this.onTrackerInteraction = onTrackerInteraction;
    this.getBrowserInfo = getBrowserInfo;
    this.isRequestAllowed = isRequestAllowed;
  }

  async init() {
    this.db = new Database();
    await this.db.init();

    this.config = new Config(this.settings, {
      db: this.db,
      trustedClock: this.trustedClock,
    });
    this.requestMonitor = new RequestMonitor(this.settings, {
      db: this.db,
      webRequestPipeline: this.webRequestPipeline,
      trustedClock: this.trustedClock,
      countryProvider: this.countryProvider,
      communication: this.communication,
      onTrackerInteraction: this.onTrackerInteraction,
      getBrowserInfo: this.getBrowserInfo,
      isRequestAllowed: this.isRequestAllowed,
    });

    await this.config.init();
    await this.requestMonitor.init(this.config);
  }

  unload() {
    if (this.requestMonitor) {
      this.requestMonitor.unload();
      this.requestMonitor = null;
    }
    this.webRequestPipeline.unload();
  }

  addPipelineStep(stage, opts) {
    if (
      !this.requestMonitor.pipelines ||
      !this.requestMonitor.pipelines[stage]
    ) {
      return Promise.reject(
        new Error(`Could not add pipeline step: ${stage}, ${opts.name}`),
      );
    }

    return this.requestMonitor.pipelines[stage].addPipelineStep(opts);
  }

  removePipelineStep(stage, name) {
    if (
      this.requestMonitor &&
      this.requestMonitor.pipelines &&
      this.requestMonitor.pipelines[stage]
    ) {
      this.requestMonitor.pipelines[stage].removePipelineStep(name);
    }
  }

  recordClick(event, context, href, sender) {
    this.requestMonitor.pipelineSteps.cookieContext.setContextFromEvent(
      event,
      context,
      href,
      sender,
    );
    this.requestMonitor.pipelineSteps.oAuthDetector.recordClick(
      event,
      context,
      href,
      sender,
    );
  }

  clearCache() {
    this.requestMonitor.clearCache();
  }
}
