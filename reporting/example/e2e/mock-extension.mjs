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
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    hub: { type: 'string', default: 'ws://127.0.0.1:7878/ws' },
    leak: { type: 'boolean', default: false },
  },
});

const socket = new WebSocket(values.hub);
const send = (record) => socket.send(JSON.stringify(record));

let quorumMode = 'always';

function emitPage(url, title) {
  if (quorumMode === 'never') {
    return;
  }
  send({
    kind: 'message',
    source: 'url-reporter',
    sentAt: Date.now(),
    body: {
      action: 'wtm.page',
      ver: 4,
      'anti-duplicates': 1234,
      payload: {
        url,
        t: title,
        ref: null,
        redirects: null,
        lang: { html: 'en', detect: 'en' },
        ctry: 'de',
        activity: 0.5,
      },
    },
  });
}

const commands = {
  ping: () => ({ pong: true, now: Date.now() }),
  state: () => ({ mock: true, quorum: { mode: quorumMode } }),
  reset: () => {
    quorumMode = 'always';
    return { ok: true };
  },
  closeTabs: () => ({ closed: [] }),
  setQuorum: ({ mode }) => {
    quorumMode = mode;
    return { mode };
  },
  navigate: ({ url }) => {
    if (url.includes('127.0.0.1') && values.leak) {
      emitPage(url, 'wtm-e2e-private-marker');
    } else if (!url.includes('127.0.0.1')) {
      emitPage(url, 'Mock page');
    }
    return { url, title: 'Mock page', loadedBecause: 'mock' };
  },
  flush: () => ({ drained: true, rounds: [{ round: 1, pending: 0 }] }),
  processPendingJobs: () => ({ total: 0 }),
  expirePages: () => ({ numJobsCreated: 0 }),
  dumpJobs: () => ({ summary: { total: 0 } }),
  dumpPageDb: () => ({ aggregatedPages: [], expiration: [] }),
  selfChecks: () => ({ status: 'PASSED', overview: {} }),
};

socket.addEventListener('open', () => {
  send({
    kind: 'hello',
    info: { extensionId: 'mock-extension', userAgent: 'mock/1.0' },
  });
  console.log(`mock extension connected to ${values.hub}`);
});

socket.addEventListener('message', async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.kind !== 'command') {
    return;
  }
  const handler = commands[msg.name];
  if (!handler) {
    send({ kind: 'result', id: msg.id, error: `unknown command: ${msg.name}` });
    return;
  }
  try {
    send({ kind: 'result', id: msg.id, result: await handler(msg.args || {}) });
  } catch (e) {
    send({ kind: 'result', id: msg.id, error: `${e}` });
  }
});

socket.addEventListener('close', () => {
  console.log('mock extension disconnected');
  process.exit(0);
});
