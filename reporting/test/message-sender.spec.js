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

import { expect } from 'chai';

import MessageSender from '../src/message-sender.js';
import DuplicateDetector from '../src/duplicate-detector.js';
import { createInMemoryPersistedHashes } from './helpers/in-memory-persisted-hashes.js';

describe('#MessageSender', function () {
  const YESTERDAY = '20251231';
  const TODAY = '20260101';
  const TOMORROW = '20260102';

  let uut;
  let currentDay;
  let sentMessages;
  let communication;

  function somePageMessage(url = 'https://example.test/foo') {
    return {
      body: {
        action: 'wtm.page',
        payload: { url, t: 'Some title' },
        ver: 4,
        'anti-duplicates': Math.floor(Math.random() * 2 ** 32),
      },
      deduplicateBy: 'url',
    };
  }

  beforeEach(async function () {
    currentDay = TODAY;
    sentMessages = [];
    communication = {
      trustedClock: {
        getTimeAsYYYYMMDD: () => currentDay,
      },
      async send(body) {
        sentMessages.push(body);
      },
    };

    const duplicateDetector = new DuplicateDetector(
      createInMemoryPersistedHashes(),
    );
    await duplicateDetector.init();
    uut = new MessageSender({
      duplicateDetector,
      communication,
      jobScheduler: { registerHandler() {} },
    });
  });

  it('should send a message', async function () {
    const message = somePageMessage();
    await uut.send(message);

    expect(sentMessages).to.have.lengthOf(1);
    expect(sentMessages[0]).to.deep.include(message.body);
  });

  it('should send the same page only once per day', async function () {
    await uut.send(somePageMessage());
    await uut.send(somePageMessage());

    expect(sentMessages).to.have.lengthOf(1);
  });

  it('should send the same page again on the next day', async function () {
    await uut.send(somePageMessage());
    currentDay = TOMORROW;
    await uut.send(somePageMessage());

    expect(sentMessages.map((x) => x.ts)).to.eql([TODAY, TOMORROW]);
  });

  it('should send different pages on the same day', async function () {
    await uut.send(somePageMessage('https://example.test/foo'));
    await uut.send(somePageMessage('https://example.test/bar'));

    expect(sentMessages).to.have.lengthOf(2);
  });

  it('should keep the timestamp of a message that has one', async function () {
    const message = somePageMessage();
    message.body.ts = YESTERDAY;
    await uut.send(message);

    expect(sentMessages).to.eql([message.body]);
  });

  it('should be able to send a message again if the first attempt failed', async function () {
    const message = somePageMessage();
    const originalSend = communication.send;
    communication.send = async () => {
      throw new Error('network is down');
    };
    try {
      await uut.send(message);
      expect.fail('should have failed');
    } catch (e) {
      expect(e.message).to.eql('network is down');
    }

    communication.send = originalSend;
    await uut.send(message);
    expect(sentMessages).to.have.lengthOf(1);
  });
});
