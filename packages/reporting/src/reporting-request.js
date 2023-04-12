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
  constructor(settings, communication) {
    this.settings = settings;
    this.communication = communication;
  }

  async init() {
    this.webRequestPipeline = new WebrequestPipeline();
    this.db = new Database();

    await this.webRequestPipeline.init();
    await this.db.init();

    this.config = new Config(this.settings, this.db);
    this.attrack = new RequestMonitor(this.db, this.webRequestPipeline);

    telemetry.setCommunication({ communication: this.communication });

    this.pageStageListener = events.subscribe(
      'webrequest-pipeline:stage',
      (page) => {
        this.attrack.onPageStaged(page);
      },
    );

    await this.config.init();
    await this.attrack.init(this.config);
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
