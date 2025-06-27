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

import Patterns from './patterns';
import PatternsUpdater from './patterns-updater';
import CountryProvider from './country-provider';
import Sanitizer from './sanitizer';
import UrlAnalyzer from './url-analyzer';
import Pages from './pages';
import PageAggregator from './page-aggregator';
import PageDB from './pagedb';
import NewPageApprover from './new-page-approver';
import NavTrackingDetector from './nav-tracking-detector';
import MessageSender from './message-sender';
import DuplicateDetector from './duplicate-detector';
import DoublefetchPageHandler from './doublefetch-page-handler';
import PageQuorumCheckHandler from './page-quorum-check-handler';
import QuorumChecker from './quorum-checker';
import SearchExtractor from './search-extractor';
import JobScheduler from './job-scheduler';
import PersistedHashes from './persisted-hashes';
import AliveCheck from './alive-check';
import AliveMessageGenerator from './alive-message-generator';
import SessionStorageWrapper from './session-storage';
import AttrackMessageHandler from './communication-proxy/attrack-message-handler';
import logger from './logger';
import SelfCheck from './self-check';
import { BloomFilter } from './bloom-filters';

const SECOND = 1000;

export default class Reporting {
  constructor({ config, storage, communication, connectDatabase }) {
    // Defines whether Reporting is fully initialized and has permission
    // to collect data.
    this.isActive = false;
    this._pendingInits = Promise.resolve();
    this._numPendingInits = 0;
    this.communication = communication;

    this.jobScheduler = new JobScheduler({
      storage,
      storageKey: 'scheduled_jobs',
    });
    this.persistedHashes = new PersistedHashes({
      storage,
      storageKey: 'deduplication_hashes',
    });
    this.bloomFilter = new BloomFilter({
      database: connectDatabase('urlreporter_bloom_filter'),
      name: 'private_pages',
      partitions: [333323, 333331, 333337], // ~ 1 million entries
    });

    this.newPageApprover = new NewPageApprover(
      this.persistedHashes,
      this.bloomFilter,
    );
    this.pagedb = new PageDB({
      database: connectDatabase('pagedb'),
      newPageApprover: this.newPageApprover,
    });

    this.patterns = new Patterns();
    this.patternsUpdater = new PatternsUpdater({
      config,
      patterns: this.patterns,
      storage,
      storageKey: 'patterns',
    });
    this.countryProvider = new CountryProvider({
      config,
      storage,
      storageKey: 'ctry',
    });
    this.sanitizer = new Sanitizer(this.countryProvider);
    this.urlAnalyzer = new UrlAnalyzer(this.patterns);

    this.pageSessionStore = new SessionStorageWrapper({
      namespace: 'wtm::reporting::page',
    });
    this.pages = new Pages({
      config,
      urlAnalyzer: this.urlAnalyzer,
      newPageApprover: this.newPageApprover,
      pageSessionStore: this.pageSessionStore,
    });
    this.pageAggregator = new PageAggregator({
      pages: this.pages,
      pagedb: this.pagedb,
      jobScheduler: this.jobScheduler,
    });
    this.pages.addObserver(
      this.pageAggregator.onPageEvent.bind(this.pageAggregator),
    );
    this.pages.addObserver(this._onPageEvent.bind(this));

    this.doublefetchPageHandler = new DoublefetchPageHandler({
      jobScheduler: this.jobScheduler,
      sanitizer: this.sanitizer,
      newPageApprover: this.newPageApprover,
    });
    this.quorumChecker = new QuorumChecker({
      config,
      storage,
      storageKey: 'quorum_check',
      bloomFilter: this.bloomFilter,
      communication,
    });
    this.pageQuorumCheckHandler = new PageQuorumCheckHandler({
      jobScheduler: this.jobScheduler,
      quorumChecker: this.quorumChecker,
      countryProvider: this.countryProvider,
    });

    this.navTrackingDetector = new NavTrackingDetector({
      sanitizer: this.sanitizer,
      persistedHashes: this.persistedHashes,
      quorumChecker: this.quorumChecker,
      jobScheduler: this.jobScheduler,
    });
    this.pages.addObserver(
      this.navTrackingDetector.onPageEvent.bind(this.navTrackingDetector),
    );

    this.duplicateDetector = new DuplicateDetector(this.persistedHashes);
    this.messageSender = new MessageSender({
      duplicateDetector: this.duplicateDetector,
      communication,
      jobScheduler: this.jobScheduler,
    });
    this.searchExtractor = new SearchExtractor({
      config,
      patterns: this.patterns,
      sanitizer: this.sanitizer,
      persistedHashes: this.persistedHashes,
      jobScheduler: this.jobScheduler,
    });

    const aliveMessageGenerator = new AliveMessageGenerator({
      quorumChecker: this.quorumChecker,
      storage,
      storageKey: 'alive_config',
    });
    this.aliveCheck = new AliveCheck({
      communication,
      countryProvider: this.countryProvider,
      trustedClock: this.communication.trustedClock,
      aliveMessageGenerator,
      storage,
      storageKey: 'alive_check',
    });

    this.attrackMessageHandler = new AttrackMessageHandler({
      communication,
      jobScheduler: this.jobScheduler,
    });
  }

  async init() {
    this._numPendingInits += 1;
    this._pendingInits = this._pendingInits
      .catch(logger.debug)
      .then(() => this._init())
      .finally(() => {
        this._numPendingInits -= 1;
      });
    return this._pendingInits;
  }

  unload() {
    const startingUp = this._numPendingInits > 0;
    this._unload();

    if (startingUp) {
      logger.warn('Trying to unload a module while it is still starting up...');
      this._pendingInits
        .catch(() => {})
        .then(() => {
          logger.warn('Repeating unload to ensure that it remains inactive.');
          this._unload();
        });
    }
  }

  // Must never be called directly. Always use "init" instead.
  async _init() {
    if (this.isActive) {
      logger.debug('Already initialized');
      return;
    }
    await Promise.all([
      this.pages.init(),
      this.pageAggregator.init(),
      this.navTrackingDetector.init(),
      this.duplicateDetector.init(),
      this.patternsUpdater.init(),
      this.countryProvider.init(),
      this.jobScheduler.init(),
    ]);

    logger.debug('Fully initialized and ready');
    this.isActive = true;
  }

  // Must never be called directly. Always use "unload" instead.
  _unload() {
    this.isActive = false;
    try {
      this.duplicateDetector.unload();
      this.pages.unload();
      this.navTrackingDetector.unload();
      this.pageAggregator.unload();
      this.jobScheduler.unload();

      // Attempt to finish all pending changes, though it would not
      // be critical if we lose them. Important operations should
      // already have triggered a write operation.
      this.persistedHashes.flush().catch(logger.warn);
      this.pagedb.flush().catch(logger.warn);
    } catch (e) {
      logger.error('Unexpected error during unload. This is likely a bug.', e);
    }
  }

  _onPageEvent(event) {
    if (!this.isActive) {
      return;
    }

    if (event.type === 'safe-page-navigation') {
      logger.debug('Navigation in non-private tab detected:', event.url);
      this.aliveCheck.ping();
      this._onSafePageNavigation(event.url).catch((e) => {
        logger.error('Failed to handle event', event, e);
      });
    }
  }

  async _onSafePageNavigation(url) {
    await this._ensurePatternsAreUpToDate();
    if (!this.isActive) {
      return;
    }
    const { isSupported, category, query, doublefetchRequest } =
      this.urlAnalyzer.parseSearchLinks(url);
    if (isSupported) {
      logger.debug('Potential report found on URL:', url);
      await this.jobScheduler.registerJob({
        type: 'doublefetch-query',
        args: {
          query,
          category,
          doublefetchRequest,
        },
        config: {
          readyIn: { min: 2 * SECOND, max: 8 * SECOND },
        },
      });
    }
  }

  async processPendingJobs() {
    await this._ensurePatternsAreUpToDate();
    return this.jobScheduler.processPendingJobs();
  }

  async _ensurePatternsAreUpToDate() {
    // Currently, the PatternsUpdater needs to be externally triggered.
    // This implementation detail could be avoided, if the PatternsUpdater
    // could use a browser API like timers in persistent background pages
    // or the Alert API (Manifest V3).
    // The "update" function is a quick operation unless for the rare
    // situation that the patterns are outdated and need to be fetched.
    // Thus, there should be no harm in calling it here.
    await this.patternsUpdater.update();
  }

  // Drop-in replacement for "communication.send". To be used by the
  // request reporter. It is a synchronous fire-and-forget API. The
  // message delivery will be best-effort. Also, it may be delayed.
  forwardRequestReporterMessage(msg) {
    this.attrackMessageHandler.sendInBackground(msg);
  }

  async selfChecks(check = new SelfCheck()) {
    if (!this.isActive) {
      check.warn('reporting is not enabled');
    }
    await Promise.all([
      this.pages.selfChecks(check.for('pages')),
      this.pagedb.selfChecks(check.for('pagedb')),
      this.patterns.selfChecks(check.for('patterns')),
      this.patternsUpdater.selfChecks(check.for('patternsUpdater')),
      this.bloomFilter.selfChecks(check.for('bloomFilter')),
      this.jobScheduler.selfChecks(check.for('jobScheduler')),
      this.quorumChecker.selfChecks(check.for('quorumChecker')),
      this.newPageApprover.selfChecks(check.for('newPageApprover')),
      this.pageSessionStore.selfChecks(check.for('pageSessionStore')),
    ]);
    return check;
  }
}
