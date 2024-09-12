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
import { requireParam, requireString, lazyInitAsync } from './utils';

/**
 * Responsible for generating information to be included in the "alive" message.
 * The purpose of the additional information in the alive message is to detect
 * unusual traffic, for instance, if a new browser version introduced a regression.
 *
 * The information will only be included if it has been seen by multiple users.
 * The data itself should not be sensitive, still there is no point in including it
 * as only "big hitters" are interesting. For instance, should there be a problem in
 * an obscure setup, it is less interesting then if a recent Firefox or Chrome release
 * breaks something on Windows.
 */
export default class AliveMessageGenerator {
  constructor({
    browserInfoProvider,
    navigatorApi,
    quorumChecker,
    storage,
    storageKey,
  }) {
    requireParam(browserInfoProvider);
    this.quorumChecker = requireParam(quorumChecker);
    this.storage = requireParam(storage);
    this.storageKey = requireString(storageKey);
    this.navigatorApi = navigatorApi || globalThis.navigator;

    this.staticConfigProvider = lazyInitAsync(async () =>
      this._generateBaseConfig(await browserInfoProvider()),
    );
  }

  async generateMessage(ctry, hour) {
    const config = {
      ...(await this.staticConfigProvider()),
      ctry,
    };

    try {
      const reachedQuorum = await this._reachedQuorum(config);
      if (reachedQuorum) {
        config.t = hour;
        logger.debug(
          'Found the following configuration safe to share:',
          config,
        );
        return config;
      }
      logger.debug('Omitting the config, as it is not popular enough:', config);
    } catch (e) {
      logger.warn(
        'Failed to confirm that the configuration is popular enough:',
        config,
        e,
      );
    }

    return {
      browser: '',
      version: '',
      os: '',
      language: '',
      ctry: '--',
      t: hour,
    };
  }

  _generateBaseConfig(browserInfo) {
    // extracts only the major version (e.g. "96.0.1" -> 96)
    let version = parseInt(browserInfo.version, 10);
    if (isNaN(version)) {
      version = '';
    } else {
      version = String(version);
    }

    let language;
    try {
      language = this.navigatorApi.language;
    } catch (e) {
      logger.warn(
        '"navigator" API unavailable (should only happen when run in NodeJs 20 or lower)',
      );
    }
    language = language || '';

    return {
      browser: browserInfo.browser || '',
      version, // major version
      os: browserInfo.os || '',
      language: language || '', // e.g. 'en-US'
    };
  }

  /**
   * Checks that the additional configuration is popular enough to be shared.
   * As long as the configuration does not change, keep the initial result of the
   * quorum check. Otherwise, it might happen that it reaches quorum over time
   * by itself (provided that we keep sharing it and it never changes).
   *
   * If there is a false positive (a popular config being not detected), it will
   * eventually recover as the configuration will changed over time (e.g. after each
   * browser update).
   */
  async _reachedQuorum(config) {
    const newConfig = this._deterministicStringify(config);
    let reachedQuorum = null;

    try {
      const oldValue = await this.storage.get(this.storageKey);
      if (oldValue && newConfig === oldValue.config) {
        reachedQuorum = oldValue.reachedQuorum;
      }
    } catch (e) {
      logger.warn(
        'Ignore errors when reading the old state, but check the quorum again',
        e,
      );
    }

    if (reachedQuorum === null) {
      await this.quorumChecker.sendQuorumIncrement({ text: newConfig });
      reachedQuorum = await this.quorumChecker.checkQuorumConsent({
        text: newConfig,
      });
      await this.storage.set(this.storageKey, {
        config: newConfig,
        reachedQuorum,
      });
    }
    return reachedQuorum;
  }

  _deterministicStringify(obj) {
    return JSON.stringify(Object.fromEntries(Object.entries(obj).sort()));
  }
}
