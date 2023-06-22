/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import RequestMonitor from './request/index';
import Config from './request/config';
import Database from './request/database';
import logger from './logger';

export default class ReportingRequest {
  constructor(
    settings,
    {
      communication,
      countryProvider,
      trustedClock,
      webRequestPipeline,
      onTrackerInteraction,
    },
  ) {
    this.settings = settings;
    this.communication = communication;
    this.countryProvider = countryProvider;
    this.trustedClock = trustedClock;
    this.webRequestPipeline = webRequestPipeline;
    this.onTrackerInteraction = onTrackerInteraction;

    this.webRequestPipeline.addOnPageStageListener((page) => {
      if (this.attrack) {
        this.attrack.onPageStaged(page);
      } else {
        logger.warn('RequestMonitor not initilised in time');
      }
    });
  }

  async init() {
    this.db = new Database();
    await this.db.init();

    this.config = new Config(this.settings, {
      db: this.db,
      trustedClock: this.trustedClock,
    });
    this.attrack = new RequestMonitor(this.settings, {
      db: this.db,
      webRequestPipeline: this.webRequestPipeline,
      trustedClock: this.trustedClock,
      countryProvider: this.countryProvider,
      communication: this.communication,
      onTrackerInteraction: this.onTrackerInteraction,
    });

    await this.config.init();
    await this.attrack.init(this.config);
  }

  unload() {
    if (this.attrack !== null) {
      this.attrack.unload();
      this.attrack = null;
    }
    this.webRequestPipeline.unload();
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

  recordClick(event, context, href, sender) {
    this.attrack.pipelineSteps.cookieContext.setContextFromEvent(
      event,
      context,
      href,
      sender,
    );
    this.attrack.pipelineSteps.oAuthDetector.recordClick(
      event,
      context,
      href,
      sender,
    );
  }
}
