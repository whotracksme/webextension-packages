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

import { expect } from 'chai';

import JobScheduler from '../../src/job-scheduler.js';

export function createInMemoryJobScheduler() {
  const storageKey = 'some-key';
  const storage = {
    async get(key) {
      expect(key).to.equal(storageKey);
      return this._content;
    },
    async set(key, obj) {
      expect(key).to.equal(storageKey);
      this._content = obj;
    },
  };
  return new JobScheduler({ storage, storageKey });
}

export async function runClockUntilJobQueueIsEmpty(
  jobScheduler,
  clock,
  { maxIterations = 1000, fallbackHandler = async () => {} } = {},
) {
  async function advanceTo(ts) {
    const diff = ts - Date.now();
    if (diff > 0) {
      await clock.tickAsync(diff);
    }
  }

  function expireCooldowns() {
    return advanceTo(Math.max(0, ...Object.values(jobScheduler.cooldowns)));
  }

  async function waitForNextJob() {
    const { queues, handlers } = jobScheduler._describeJobs();

    // to ensure progress, we need to install handlers for each message type
    for (const type of Object.keys(queues.byType)) {
      if (!handlers.includes(type)) {
        jobScheduler.registerHandler(type, fallbackHandler);
      }
    }

    const { ready, running, waiting } = queues.byState;
    if (ready.length === 0 && running.length === 0 && waiting.length > 0) {
      const nextEventAt = Math.min(
        ...waiting.flatMap(({ _meta: { expireAt, readyAt } }) => [
          expireAt,
          readyAt,
        ]),
      );
      await advanceTo(nextEventAt);
    }
  }

  let iter = 0;
  while (jobScheduler.getTotalJobs() > jobScheduler.getTotalJobsInDlq()) {
    iter += 1;
    if (iter > maxIterations) {
      throw new Error(`Exceeded maximum steps (steps=${maxIterations})`);
    }
    await expireCooldowns();
    await waitForNextJob();
    await jobScheduler.processPendingJobs();
    await clock.runAllAsync();
  }
}
