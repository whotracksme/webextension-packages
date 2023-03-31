/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* eslint no-param-reassign: 'off' */

import random from '../random';
import { getConfigTs } from './time';
import logger from '../logger';

function msgSanitize(msg, channel) {
  msg.channel = channel;

  try {
    msg.ts = getConfigTs();
  } catch (ee) {
    return undefined;
  }

  if (!msg.ts) {
    return undefined;
  }

  msg['anti-duplicates'] = Math.floor(random() * 10000000);
  return msg;
}

export default {
  telemetry(payl) {
    if (!this.provider) {
      logger.error('No provider provider loaded');
      return;
    }
    payl.platform = this.platform;
    payl.userAgent = this.userAgent;

    payl = msgSanitize(payl, this.channel);
    this.communication.send(payl);
  },

  communication: null,
  platform: '',
  userAgent: '',

  setCommunication({ communication, platform = '', userAgent = '' }) {
    this.communication = communication;
    this.platform = platform;
    this.userAgent = userAgent;
  },
};
