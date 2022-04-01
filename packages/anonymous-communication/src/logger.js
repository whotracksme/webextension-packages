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

class Logger {
  static get(name) {
    return new Logger(name);
  }

  constructor(name) {
    name = `WTM [${name}]`;
    this.debug = console.debug.bind(console, name);
    this.log = console.log.bind(console, name);
    this.info = console.info.bind(console, name);
    this.warn = console.warn.bind(console, name);
    this.error = console.error.bind(console, name);
  }
}

export default Logger.get('anonymous-communication', { level: 'debug' });
