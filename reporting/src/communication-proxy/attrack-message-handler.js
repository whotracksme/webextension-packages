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

import logger from '../logger';
import { requireParam, requireString } from '../utils';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ATTRACK_JOB_TYPE = 'attrack:send-message:v1';

export default class AttrackMessageHandler {
  constructor({ communication, jobScheduler }) {
    this.communication = requireParam(communication);
    this.jobScheduler = requireParam(jobScheduler);

    this._configOverride = {
      'wtm.attrack.tokensv2': {
        readyIn: { min: 2 * SECOND, max: 4 * HOUR },
      },
      'wtm.attrack.keysv2': {
        readyIn: { min: 2 * SECOND, max: 4 * HOUR },
      },
      'wtm.attrack.tp_events': {
        readyIn: { min: 2 * SECOND, max: 30 * MINUTE },
      },
    };

    this.jobScheduler.registerHandler(
      ATTRACK_JOB_TYPE,
      async (job) => {
        const { message } = job.args;
        requireParam(message);
        requireString(message.action);

        await this.communication.send(message);
      },
      {
        priority: -1000,
        cooldownInMs: 1 * SECOND,
        maxJobsTotal: 500,
        maxTTL: 14 * DAY,
      },
    );
  }

  sendInBackground(message) {
    requireParam(message);
    requireString(message.action);

    if (this.jobScheduler.active) {
      const job = {
        type: ATTRACK_JOB_TYPE,
        args: { message },
        config: this._configOverride[message.action] || {},
      };
      this.jobScheduler.registerJob(job).catch((e) => {
        logger.warn('Failed to register job', job, e);
        this._sendNowInBackground(message);
      });
    } else {
      // Sending directly has the advantage that the request reporter
      // can be used even if the URL reporter is not available.
      // It should happen rarely enough.
      logger.info('jobScheduler not available. Send immediately...');
      this._sendNowInBackground(message);
    }
  }

  _sendNowInBackground(message) {
    this.communication.send(message).catch((e) => {
      logger.error('Failed to send message', e);
    });
  }
}
