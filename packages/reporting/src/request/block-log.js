/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* eslint no-restricted-syntax: 'off' */
/* eslint guard-for-in: 'off' */

import md5 from '../md5';
import events from './utils/events';
import * as datetime from './time';

export default class BlockLog {
  constructor({ config, db, telemetry }) {
    this.telemetry = telemetry;
    this.config = config;
    this.db = db;
    this.blocked = {};
    this.localBlocked = {};
  }

  get blockReportList() {
    return this.config.reportList || {};
  }

  async init() {
    this.blocked = (await this.db.get('blocked')) || {};
    this.localBlocked = (await this.db.get('localBlocked')) || {};

    this.onHourChanged = () => {
      const delay = 24;
      const hour = datetime.newUTCDate();
      hour.setHours(hour.getHours() - delay);
      const hourCutoff = datetime.hourString(hour);

      this._cleanLocalBlocked(hourCutoff);
      this.sendTelemetry();
    };
    this._hourChangedListener = events.subscribe(
      'attrack:hour_changed',
      this.onHourChanged,
    );
  }

  unload() {
    if (this._hourChangedListener) {
      this._hourChangedListener.unsubscribe();
      this._hourChangedListener = null;
    }
  }

  /**
   * Add an entry to the block log
   * @param {String} tabUrl domain name of where this block happened
   * @param {String} tracker   the 3rd party tracker hostname which was blocked
   * @param {String} key       the key for the blocked value
   * @param {String} value     the blocked value
   * @param {String} type      the type of blocked value
   */
  add(tabUrl, tracker, key, value, type) {
    const hour = datetime.getTime();

    this.offerToReporter(tabUrl, tracker, key, value, type);

    // local logging of blocked tokens
    this._addLocalBlocked(tabUrl, tracker, key, value, hour);
  }

  clear() {
    this.localBlocked = {};
    this.blocked = {};
    this.db.set('blocked', {});
    this.db.set('localBlocked', {});
  }

  _addBlocked(tracker, key, value, type) {
    if (!(tracker in this.blocked)) {
      this.blocked[tracker] = {};
    }
    if (!(key in this.blocked[tracker])) {
      this.blocked[tracker][key] = {};
    }
    if (!(value in this.blocked[tracker][key])) {
      this.blocked[tracker][key][value] = {};
    }
    if (!(type in this.blocked[tracker][key][value])) {
      this.blocked[tracker][key][value][type] = 0;
    }
    this.blocked[tracker][key][value][type] += 1;
    this.db.set('blocked', this.blocked);
  }

  _addLocalBlocked(source, s, k, v, hour) {
    if (!(source in this.localBlocked)) {
      this.localBlocked[source] = {};
    }
    if (!(s in this.localBlocked[source])) {
      this.localBlocked[source][s] = {};
    }
    if (!(k in this.localBlocked[source][s])) {
      this.localBlocked[source][s][k] = {};
    }
    if (!(v in this.localBlocked[source][s][k])) {
      this.localBlocked[source][s][k][v] = {};
    }
    if (!(hour in this.localBlocked[source][s][k][v])) {
      this.localBlocked[source][s][k][v][hour] = 0;
    }
    this.localBlocked[source][s][k][v][hour] += 1;
    this.db.set('localBlocked', this.localBlocked);
  }

  _cleanLocalBlocked(hourCutoff) {
    // localBlocked
    for (const source in this.localBlocked) {
      for (const s in this.localBlocked[source]) {
        for (const k in this.localBlocked[source][s]) {
          for (const v in this.localBlocked[source][s][k]) {
            for (const h in this.localBlocked[source][s][k][v]) {
              if (h < hourCutoff) {
                delete this.localBlocked[source][s][k][v][h];
              }
            }
            if (Object.keys(this.localBlocked[source][s][k][v]).length === 0) {
              delete this.localBlocked[source][s][k][v];
            }
          }
          if (Object.keys(this.localBlocked[source][s][k]).length === 0) {
            delete this.localBlocked[source][s][k];
          }
        }
        if (Object.keys(this.localBlocked[source][s]).length === 0) {
          delete this.localBlocked[source][s];
        }
      }
      if (Object.keys(this.localBlocked[source]).length === 0) {
        delete this.localBlocked[source];
      }
    }
    this.db.set('localBlocked', this.localBlocked);
  }

  /**
   * Check if this block event should be reported via telemetry, and if so, add to the
   * block log
   * @param  {String} tabUrl
   * @param  {String} tracker
   * @param  {String} key
   * @param  {String} value
   * @param  {String} type
   */
  offerToReporter(tabUrl, tracker, key, value, type) {
    if (this.isInBlockReportList(tracker, key, value)) {
      this._addBlocked(tracker, key, md5(value), type);
    }
  }

  isInBlockReportList(tracker, key, value) {
    if (tracker in this.blockReportList) {
      const keyList = this.blockReportList[tracker];
      if (keyList === '*') {
        return true;
      }
      if (key in keyList || md5(key) in keyList) {
        const valueList = keyList[key] || keyList[md5(key)];
        if (valueList === '*') {
          return true;
        }
        if (value in valueList || md5(value) in valueList) {
          return true;
        }
      }
    }
    return false;
  }

  sendTelemetry() {
    if (Object.keys(this.blocked).length > 0) {
      this.telemetry({
        action: 'attrack.blocked',
        payload: this.blocked,
      });
      // reset the state
      this.blocked = {};
      this.db.set('blocked', {});
    }
  }
}
