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
import { requireString, requireParam } from './utils';
import random from './random';

const HOUR = 1000 * 60 * 60;

/**
 * Responsible for sending "alive" messages. Alive messages exist
 * to monitor whether the client side of WhoTracks.me reporting
 * is healthy.
 *
 * By separating alive messages from more sensitive messages (e.g.
 * one that may contain a URL), we can include additional information
 * (like the browser) without risking to introduce fingerprinting.
 * Given that there is a correlation between the number of sent
 * "alive" messages and the number of other messages that enables us
 * to detect scenerios like a message drop after a browser release.
 *
 * Note that putting information like the browser directly inside
 * all (non-alive) messages would solve the monitoring problem
 * but at the cost of potentially introducing fingerprinting.
 * Separating monitoring (alive) and other messages limits the
 * risk: even if you could link "alive" messages, they do not
 * contain sensitive information.
 */
export default class AliveCheck {
  constructor({
    communication,
    countryProvider,
    trustedClock,
    aliveMessageGenerator,
    storage,
    storageKey,
  }) {
    this.communication = requireParam(communication);
    this.countryProvider = requireParam(countryProvider);
    this.trustedClock = requireParam(trustedClock);
    this.aliveMessageGenerator = requireParam(aliveMessageGenerator);
    this.storage = requireParam(storage);
    this.storageKey = requireString(storageKey);
    this._skipChecksUntil = 0; // Unix timestamp
  }

  /**
   * Guaranteed to finish fast and never fail. Callers can safely execute it from
   * at any place. Since "alive" messages should correlate with activity, this
   * should be called from places like page visits (triggered by human interaction).
   *
   * What counts as "activity" is currently not specified. A vague definition is
   * that if a user keeps actively using the browser, it should trigger an "alive"
   * message eventually; but if there is no user interaction and the device is idle,
   * it should eventually stop sending signals.
   */
  ping(now = Date.now()) {
    this._check(now).catch((e) => {
      logger.warn('Error while processing alive checks', e);
    });
  }

  async _check(now = Date.now()) {
    if (this._pendingUpdate || now < this._skipChecksUntil) {
      return;
    }

    this._pendingUpdate = (async () => {
      try {
        logger.debug('Checking whether a hourly ping should be sent...');
        const lastSent = await this.storage.get(this.storageKey);

        const updateSentAt = () =>
          this.storage.set(this.storageKey, { sentAt: now });

        if (!lastSent) {
          logger.info(
            'Last alive check not found. This should only happen on the first time the extension is started.',
          );
          await updateSentAt();
          return;
        } else if (lastSent.sentAt > now) {
          const now_ = new Date(now);
          const sentAt_ = new Date(lastSent.sentAt);
          logger.warn(
            `Clock jump detected (now=${now_} but sentAt=${sentAt_} is in the future). Resetting counter.`,
          );
          await updateSentAt();
          return;
        } else if (lastSent.sentAt + HOUR > now) {
          logger.debug(
            'Checking whether a hourly ping should be sent... No reached yet.',
          );
          this._skipChecksUntil = lastSent.sentAt + HOUR;
          return;
        }

        logger.debug('Hourly ping reached. Sending...');
        await this._reportAlive();
        this._skipChecksUntil = now + HOUR;
        logger.debug('Hourly ping successfully sent. Saving state...');
        await updateSentAt();
        logger.debug('Hourly ping succeeded.');
      } finally {
        this._pendingUpdate = null;
      }
    })();
    await this._pendingUpdate;
  }

  async _reportAlive() {
    const ctry = this.countryProvider.getSafeCountryCode();
    const hour = this.trustedClock.getTimeAsYYYYMMDDHH();
    const payload = await this.aliveMessageGenerator.generateMessage(
      ctry,
      hour,
    );
    const message = {
      action: 'wtm.alive',
      payload,
      ver: 3, // Note: no need to keep this number in sync among messages
      'anti-duplicates': Math.floor(random() * 10000000),
    };

    // Note that it is intentional here to bypass the job scheduler.
    // Alive signals should serve as a health check; thus it is best to
    // send in "fire-and-forget" style (without delays or retries).
    logger.debug('Sending alive:', message);
    await this.communication.send(message);
  }
}
