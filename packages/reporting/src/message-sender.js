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
 * Responsible for sending WTM reports to the servers.
 * To improve anonymity, data is sent through a 3rd party
 * to hide the sender's IP address.
 *
 * Note: There is no fundamental reason why hpnv2 could not be used
 * on Mobile as well, but it is a project on its own to port it.
 */
export default class MessageSender {
  constructor({ duplicateDetector, communication, jobScheduler }) {
    this.duplicateDetector = duplicateDetector;
    this.communication = communication;

    jobScheduler.registerHandler('send-message', async (job) => {
      await this.send(job.args);
    });
  }

  async send(message) {
    logger.debug('Preparing to send message:', message);
    const { ok, rollback, rejectReason } = await this.duplicateDetector.trySend(
      message,
    );
    if (!ok) {
      logger.info('Rejected by duplicate detector:', rejectReason, message);
      return;
    }
    try {
      // Note: assume fire-and-forget message here
      await this.communication.send(message.body);
      logger.info('Successfully sent message:', message.body);
    } catch (e) {
      // rollback to allow future resending attempts
      await rollback();
      throw e;
    }
  }
}
