/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import RequestMonitor from './request/index';
import telemetry from './request/telemetry';
import Config from './request/config';
import Database from './request/database';
import WebrequestPipeline from './request/webrequest-pipeline/index';
import events from './request/utils/events';

export default class ReportingRequest {
  constructor(settings, communicaton) {
    this.settings = settings;
    this.communicaton = communicaton;
  }

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

    this.pageStageListener = events.subscribe(
      'webrequest-pipeline:stage',
      (page) => {
        this.attrack.onPageStaged(page);
      },
    );

    return this.config.init().then(() => {
      return this.attrack.init(this.config);
    });
  }

  unload() {
    if (this.pageStageListener) {
      this.pageStageListener.unsubscribe();
      this.pageStageListener = null;
    }
    if (this.attrack !== null) {
      this.attrack.unload();
      this.attrack = null;
    }
    this.webRequestPipeline.unload();
    this.enabled = false;
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

  recordClick(...args) {
    this.attrack.pipelineSteps.cookieContext.setContextFromEvent(...args);
  }
}
