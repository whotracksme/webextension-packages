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

/**
 * Provides a standard way to gather diagnostics to display them in
 * a human-readable way. Subcomponents can be nested (with ".for(...)").
 *
 * Self-checks are not expected to run regularly in production.
 * Thus, adding expensive checks is possible.
 */
export default class SelfCheck {
  fail(...details) {
    logger.warn('[SelfCheck::FAIL]:', ...details);
    this._log('failures', details);
  }

  warn(...details) {
    logger.warn('[SelfCheck::WARN]:', ...details);
    this._log('warnings', details);
  }

  pass(...details) {
    this._log('passed', details);
  }

  skip(...details) {
    this._log('skipped', details);
  }

  _log(type, details) {
    this.checks = this.checks || {};
    this.checks[type] = this.checks[type] || [];
    this.checks[type].push(details);
  }

  for(name) {
    if (name === 'checks') {
      throw new Error('"checks" is a reserved name');
    }
    this[name] = this[name] || new SelfCheck();
    return this[name];
  }

  /**
   * Output:
   * - status: PASSED|WARN|FAILED
   * - overview: total counts by category (failures, warnings, passed, skipped)
   * - log: provides access to the full logs
   */
  report() {
    const types = ['failures', 'warnings', 'passed', 'skipped'];
    const result = {
      overview: Object.fromEntries(
        types.map((x) => [x, this.checks?.[x]?.length || 0]),
      ),
      log: {},
    };
    if (result.overview.failures > 0) {
      result.status = 'FAILED';
    } else if (result.overview.warnings > 0) {
      result.status = 'WARN';
    } else {
      result.status = 'PASSED';
    }
    types.forEach((type) => {
      if (this.checks?.[type]?.length > 0) {
        result.log[type] = { _: this.checks?.[type] };
      } else {
        result.log[type] = {};
      }
    });
    Object.keys(this)
      .filter((x) => x != 'checks')
      .map((x) => [x, this[x].report()])
      .forEach(([x, subresult]) => {
        types.forEach((type) => {
          result.overview[type] += subresult.overview[type];
          if (Object.keys(subresult.log[type]).length > 0) {
            result.log[type][x] = subresult.log[type];
          }
          if (
            result.status !== 'FAILED' &&
            ['FAILED', 'WARN'].includes(subresult.status)
          ) {
            result.status = subresult.status;
          }
        });
      });
    return result;
  }

  allPassed() {
    return this.report().status === 'PASSED';
  }
}
