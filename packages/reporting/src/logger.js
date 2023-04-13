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

const SUPPORTED_LOG_LEVELS = new Map([
  ['debug', 1],
  ['info', 2], // alias for 'log'
  ['log', 2],
  ['warn', 3], // alias for 'warning'
  ['warning', 3],
  ['error', 4],
  ['off', 5], // disable all logging
]);

const loggers = new Set();

const noop = () => {};

let DEFAULT_LOG_LEVEL = 'log';

export class Logger {
  static get(name) {
    return new Logger(name);
  }

  constructor(prefix) {
    this.prefix = `WTM [${prefix}]`;
    this.logLevel = DEFAULT_LOG_LEVEL;

    // Define loggers
    this._debug = console.debug || noop;
    this._log = console.log || noop;
    this._warning = console.warn || noop;
    this._error = console.error || noop;

    if (prefix) {
      this._debug = this._debug.bind(null, prefix);
      this._log = this._log.bind(null, prefix);
      this._warning = this._warning.bind(null, prefix);
      this._error = this._error.bind(null, prefix);
    }

    loggers.add(this);
  }

  withObserverFunc(consoleFunc, level) {
    return (...args) => {
      let callerLoc = new Error().stack.split('\n')[1];
      const i = callerLoc.lastIndexOf('/');
      if (i >= 0) {
        callerLoc = callerLoc.substring(i + 1, callerLoc.length - 1);
      }
      const augmentedArgs = [level, ...args, callerLoc];
      consoleFunc(...augmentedArgs);
    };
  }

  setLevel(level) {
    return this.setLevel(level);
  }

  isEnabledFor(level) {
    const intLevel = SUPPORTED_LOG_LEVELS.get(level) || -1;
    return intLevel >= SUPPORTED_LOG_LEVELS.get(this.logLevel);
  }

  get debug() {
    if (this.isEnabledFor('debug')) {
      return this.withObserverFunc(this._debug, 'debug');
    }
    return noop;
  }

  get info() {
    return this.log;
  }

  get log() {
    if (this.isEnabledFor('log')) {
      return this.withObserverFunc(this._log, 'log');
    }
    return noop;
  }

  get warn() {
    return this.warning;
  }

  get warning() {
    if (this.isEnabledFor('warn')) {
      return this.withObserverFunc(this._warning, 'warning');
    }
    return noop;
  }

  get error() {
    if (this.isEnabledFor('error')) {
      return this.withObserverFunc(this._error, 'error');
    }
    return noop;
  }
}

export default Logger.get('reporting');

export function setLogLevel(level) {
  if (!SUPPORTED_LOG_LEVELS.has(level)) {
    throw new Error(`Unknow log level '${level}'`);
  }

  DEFAULT_LOG_LEVEL = level;
  loggers.forEach((logger) => (logger.logLevel = level));
}
