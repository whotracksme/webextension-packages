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
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }
  debug(text) {
    console.debug(text);
  }
  log(text) {
    console.log(text);
  }
  info(text) {
    console.info(text);
  }
  warn(text) {
    console.warn(text);
  }
  error(text) {
    console.error(text);
  }
}

export default Logger.get('anonymous-communication', { level: 'debug' });
