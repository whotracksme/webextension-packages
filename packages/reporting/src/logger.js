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

const noop = () => {};

export class Logger {
  static get(name) {
    return new Logger(name);
  }

  constructor(name) {
    this.prefix = `WTM [${name}]`;
    this.enable();
  }

  enable() {
    this.debug = console.debug.bind(console, this.prefix);
    this.log = console.log.bind(console, this.prefix);
    this.info = console.info.bind(console, this.prefix);
    this.warn = console.warn.bind(console, this.prefix);
    this.error = console.error.bind(console, this.prefix);
  }

  disable() {
    this.debug = noop;
    this.log = noop;
    this.info = noop;
    this.warn = noop;
    this.error = noop;
  }
}

export default Logger.get('reporting');
