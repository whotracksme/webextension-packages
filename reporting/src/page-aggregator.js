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

import logger from './logger';
import SeqExecutor from './seq-executor';

const SECOND = 1000;

const COOLDOWN_FOR_EXPIRED_PAGES_CHECK = 2 * SECOND;
const COOLDOWN_FOR_FORCING_A_FULL_SYNC = 90 * SECOND;

export default class PageAggregator {
  constructor({ pages, pagedb, jobScheduler }) {
    this.active = false;

    this.pages = pages;
    this.pagedb = pagedb;
    this.jobScheduler = jobScheduler;

    this._dbExecutor = new SeqExecutor();
    this._lastFullSync = 0; // Unix epoch
    this._lastExpiredPagesCheck = 0; // Unix epoch
  }

  async init() {
    this.active = true;
  }

  unload() {
    this.active = false;
    this.pagedb.flush().catch(console.error);
  }

  onPageEvent(event) {
    if (!this.active) {
      return;
    }

    if (event.type === 'full-sync') {
      this.fullSync();
    } else if (event.type === 'lazy-init' || event.type === 'page-updated') {
      // TODO: is there a down-side in increasing the cooldown?
      // (especially, if there are many tabs open, it may become a problem)
      if (Date.now() > this._lastFullSync + COOLDOWN_FOR_FORCING_A_FULL_SYNC) {
        logger.debug('Forcing full sync');
        this.fullSync();
      } else {
        const { tabId } = event;
        this.syncTab(tabId);
      }
    } else if (event.type === 'activity-updated') {
      const { urls, activityEstimator } = event;
      this._dbExecutor
        .run(async () => {
          await this.pagedb.updateActivity(urls, activityEstimator);
        })
        .catch(console.error);
    } else {
      logger.warn('Unexpected signal:', event);
    }
  }

  fullSync() {
    const updateInfo = {
      fetchPagesToUpdate: () => {
        const { openTabs, activeTab } = this.pages.describe();
        const openPages = Object.values(openTabs);
        const activePage = activeTab?.tab;
        return { openPages, activePage };
      },
      isFullSync: true,
    };

    this._lastFullSync = Date.now();
    this._syncToDB(updateInfo).catch(logger.error);
  }

  syncTab(tabId) {
    const updateInfo = {
      fetchPagesToUpdate: () => {
        const page = this.pages.describeTab(tabId);
        if (!page) {
          return { openPages: [], activePage: null };
        }
        const activeTabId = this.pages.getActiveTabId();
        const activePage = activeTabId === tabId ? page : null;
        return { openPages: [page], activePage };
      },
      isFullSync: false,
    };

    this._syncToDB(updateInfo).catch(logger.error);
  }

  async _syncToDB(updateInfo) {
    await this._dbExecutor.run(async () => {
      const { openPages, activePage } = updateInfo.fetchPagesToUpdate();
      await this.pagedb.updatePages(openPages, activePage, {
        isFullSync: updateInfo.isFullSync,
      });
    });
    this._expirePagesInBackground();
  }

  /**
   * For options, see PageDB#acquireExpiredPages
   */
  async checkExpiredPages(options = {}) {
    if (!this.active) {
      logger.warn('checkExpiredPages ignored since the module is not active');
      return { numJobsCreated: 0 };
    }

    const now = Date.now();
    if (
      now < this._lastExpiredPagesCheck + COOLDOWN_FOR_EXPIRED_PAGES_CHECK &&
      !options.forceExpiration
    ) {
      return { numJobsCreated: 0 };
    }

    // The default batch size is a trade-off. For performance, bigger should
    // be better; but smaller sizes release the pagedb locks in-between
    // (needed for updates) and it also reduces the risk of losing jobs
    // (if the cannot be registered, but where already taken out of pagedb).
    const defaultBatchSize = 20;
    const maxSteps = 100;

    options = { maxEntriesToCheck: defaultBatchSize, ...options };
    let numJobsCreated = 0;
    let step;
    for (step = 0; step < maxSteps; step += 1) {
      this._lastExpiredPagesCheck = now;
      const expiredPages = await this.pagedb.acquireExpiredPages(options);
      if (expiredPages.length === 0) {
        break;
      }

      const jobs = expiredPages.map((page) => ({
        type: 'doublefetch-page',
        args: { page },
      }));
      try {
        logger.debug('Creating', jobs.length, 'jobs for expired pages:', jobs);
        await this.jobScheduler.registerJobs(jobs);
        numJobsCreated += expiredPages.length;
      } catch (e) {
        logger.error('Failed to register jobs:', jobs.length, 'jobs were lost');
        logger.debug('Lost jobs:', jobs);
        return { numJobsCreated };
      }
    }

    if (step === maxSteps) {
      logger.warn(
        'Exceeded the iteration cap of',
        maxSteps,
        'steps (no error, but highly unexpected)',
      );
    }

    if (numJobsCreated > 0) {
      logger.info(numJobsCreated, 'jobs created for expired pages');
    }
    return { numJobsCreated };
  }

  _expirePagesInBackground() {
    (async () => {
      try {
        await this.checkExpiredPages();
      } catch (e) {
        logger.error('Unexpected error while expiring pages', e);
      }
    })();
  }
}
