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
import SelfCheck from './self-check';

export default class EventListenerQueue {
  constructor({
    connectTimeoutInMs = null,
    maxBufferLength = 1024,
    listeners,
  }) {
    if (!Array.isArray(listeners)) {
      throw new Error('Expect a description of listeners');
    }
    this.detectedErrors = false;

    if (connectTimeoutInMs && connectTimeoutInMs > 0) {
      this._shutdownTimer = setTimeout(() => {
        logger.warn(
          `broken pipe (timed out after ${connectTimeoutInMs} ms without connection)`,
        );
        this.detectedErrors = true;
        this.close();
      }, connectTimeoutInMs);
    }

    this._bufferedEvents = [];
    this._uninstallHandlers = [];
    listeners.forEach(({ method, api, type }) => {
      const event = globalThis.chrome?.[api]?.[type];
      if (event?.addListener && event?.removeListener) {
        const handler = (...args) => {
          this._bufferedEvents.push({ method, args });
          if (
            maxBufferLength &&
            this._bufferedEvents.length > maxBufferLength
          ) {
            this.detectedErrors = true;
            logger.warn('buffer overrun: dropping events to', method);
            this._bufferedEvents.shift();
          }
        };

        try {
          if (api === 'webRequest') {
            // webRequest API may refuse listeners without a filter.
            // (Note: keep this part in sync with the setup in pages.js)
            const filter = { urls: ['<all_urls>'] };
            try {
              event.addListener(handler, filter, ['responseHeaders']);
            } catch {
              event.addListener(handler, filter);
            }
          } else {
            event.addListener(handler);
          }
          this._uninstallHandlers.push(() => {
            event.removeListener(handler);
          });
        } catch (e) {
          this.detectedErrors = true;
          logger.warn('Cannot queue api', method, e);
        }
      } else {
        logger.debug(
          'Cannot queue api',
          method,
          '(not available on this platform)',
        );
      }
    });
  }

  replayEvents(target) {
    if (!this.detectedErrors) {
      logger.debug(
        `Successfully connected event listeners (buffer length: ${this._bufferedEvents.length})`,
      );
    }

    while (this._bufferedEvents.length > 0) {
      const { method, args } = this._bufferedEvents.shift();
      try {
        target[method](...args);
      } catch (e) {
        logger.error('Error while processing event:', method, args, e);
      }
    }
    this.close();
  }

  close() {
    if (this._shutdownTimer) {
      clearTimeout(this._shutdownTimer);
      this._shutdownTimer = null;
    }

    this._bufferedEvents = [];
    this._uninstallHandlers.forEach((cb) => cb());
    this._uninstallHandlers = [];
  }

  async selfChecks(check = new SelfCheck()) {
    const isConnected =
      this._uninstallHandlers.length === 0 &&
      this._bufferedEvents.length === 0 &&
      !this._shutdownTimer;

    if (isConnected) {
      if (this.detectedErrors) {
        check.warn('connected but events were lost during startup');
      } else {
        check.pass('connected');
      }
    } else {
      if (this.detectedErrors) {
        check.fail('dropping events while waiting for connection');
      } else {
        check.warn('waiting for connection (but no message loss yet)');
      }
    }

    return check;
  }
}
