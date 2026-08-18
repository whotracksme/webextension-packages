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
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocketServer } from 'ws';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '7878' },
    'out-dir': { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = values['out-dir'] || path.join(e2eDir, 'out');
const port = Number(values.port);

// Only the loopback authority is a valid Host. A DNS-rebinding page reaches the
// hub under its own hostname (Host: evil.com), so this rejects it, while the CLI
// and extension (which target 127.0.0.1/localhost) pass.
const ALLOWED_HOSTS = new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  `[::1]:${port}`,
]);

fs.mkdirSync(outDir, { recursive: true });

const MESSAGES_LOG = path.join(outDir, 'messages.jsonl');
const EVENTS_LOG = path.join(outDir, 'events.jsonl');
const CONSOLE_LOG = path.join(outDir, 'console.log');

let seq = 0;
const messages = [];
const events = [];
const consoleLines = [];
const MAX_CONSOLE_LINES = 5000;

function hubLog(...args) {
  if (!values.quiet) {
    console.log(`[hub]`, ...args);
  }
}

function append(file, record) {
  fs.appendFile(file, `${JSON.stringify(record)}\n`, (err) => {
    if (err) {
      console.error('[hub] failed to append to', file, err.message);
    }
  });
}

function recordMessage(payload) {
  seq += 1;
  const record = { seq, receivedAt: Date.now(), ...payload };
  messages.push(record);
  append(MESSAGES_LOG, record);
  const action = record.body?.action || record.body?.type || 'unknown';
  hubLog(`message #${seq}`, action);
  return record;
}

function recordEvent(payload) {
  seq += 1;
  const record = { seq, receivedAt: Date.now(), ...payload };
  events.push(record);
  append(EVENTS_LOG, record);
  return record;
}

function recordConsole({ level, text }) {
  const line = `${new Date().toISOString()} [sw] [${level}] ${text}`;
  consoleLines.push(line);
  if (consoleLines.length > MAX_CONSOLE_LINES) {
    consoleLines.splice(0, consoleLines.length - MAX_CONSOLE_LINES);
  }
  fs.appendFile(CONSOLE_LOG, `${line}\n`, () => {});
}

let socket = null;
let extensionInfo = null;
let nextCommandId = 1;
let connectionGeneration = 0;
const pendingCommands = new Map();

// reset/reload reply and then the socket dies; callers need the worker back.
function waitForReconnect(generationBefore, timeoutInMs) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (connectionGeneration > generationBefore && socket?.readyState === 1) {
        resolve(true);
      } else if (Date.now() - startedAt > timeoutInMs) {
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

function sendToExtension(payload) {
  if (!socket || socket.readyState !== socket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function runCommand(name, args, timeoutInMs) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== socket.OPEN) {
      reject(new Error('extension is not connected to the hub'));
      return;
    }
    const id = nextCommandId;
    nextCommandId += 1;
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`command "${name}" timed out after ${timeoutInMs}ms`));
    }, timeoutInMs);
    pendingCommands.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    sendToExtension({ kind: 'command', id, name, args });
  });
}

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden host' }));
    return;
  }
  // A non-simple content type forces a CORS preflight, which fails here (no
  // CORS headers are served) — so webpages cannot trigger POST side effects.
  if (
    req.method === 'POST' &&
    !(req.headers['content-type'] || '').startsWith('application/json')
  ) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'expected application/json' }));
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const [status, reply, headers] = await handleRequest(req.method, url, body);
    if (Buffer.isBuffer(reply) || typeof reply === 'string') {
      res.writeHead(status, headers || { 'Content-Type': 'text/plain' });
      res.end(reply);
    } else {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply, null, 2));
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

const MAX_BODY_BYTES = 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve({ _parseError: 'body too large' });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ _parseError: raw });
      }
    });
  });
}

function since(list, url) {
  const from = Number(url.searchParams.get('since') || 0);
  return list.filter((x) => x.seq > from);
}

async function handleRequest(method, url, body) {
  const p = url.pathname;

  if (method === 'GET' && (p === '/health' || p === '/')) {
    return [
      200,
      {
        ok: true,
        extensionConnected: !!socket && socket.readyState === socket.OPEN,
        extension: extensionInfo,
        seq,
        counts: { messages: messages.length, events: events.length },
        outDir,
      },
    ];
  }

  if (method === 'POST' && p === '/cmd') {
    if (!body.name) {
      return [400, { error: 'missing "name"' }];
    }
    const before = seq;
    const timeout = Number(body.timeout) || 120000;
    try {
      const generationBefore = connectionGeneration;
      const result = await runCommand(body.name, body.args || {}, timeout);
      if (result?.restarting) {
        const reconnected = await waitForReconnect(generationBefore, 30000);
        return [
          200,
          { ok: true, since: before, result: { ...result, reconnected } },
        ];
      }
      return [200, { ok: true, since: before, result }];
    } catch (err) {
      return [502, { ok: false, since: before, error: err.message }];
    }
  }

  if (method === 'GET' && p === '/messages') {
    let result = since(messages, url);
    const action = url.searchParams.get('action');
    if (action) {
      result = result.filter((x) => (x.body?.action || '').startsWith(action));
    }
    return [200, { seq, count: result.length, messages: result }];
  }

  if (method === 'POST' && p === '/messages/clear') {
    messages.length = 0;
    events.length = 0;
    fs.writeFileSync(MESSAGES_LOG, '');
    fs.writeFileSync(EVENTS_LOG, '');
    return [200, { ok: true, seq }];
  }

  if (method === 'GET' && p === '/events') {
    return [200, { seq, events: since(events, url) }];
  }

  if (method === 'GET' && p === '/logs') {
    const tail = Number(url.searchParams.get('tail') || 100);
    return [200, { lines: consoleLines.slice(-tail) }];
  }

  // Droppable by sanitizeUrl on two grounds: private host and uncommon port.
  if (method === 'GET' && p.startsWith('/pages/')) {
    return servePage(p.slice('/pages/'.length));
  }

  if (method === 'POST' && p === '/shutdown') {
    setTimeout(() => process.exit(0), 10);
    return [200, { ok: true }];
  }

  return [404, { error: `unknown route: ${method} ${p}` }];
}

function servePage(name) {
  const pagesDir = path.join(e2eDir, 'pages');
  const safe = path.normalize(name).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(pagesDir, safe);
  if (!file.startsWith(pagesDir + path.sep) || !fs.existsSync(file)) {
    return [404, { error: `no page: ${safe}` }];
  }
  return [200, fs.readFileSync(file), { 'Content-Type': 'text/html' }];
}

// Browsers always send Origin on a WS handshake; allow only the extension's
// chrome-extension:// origin. The Node mock client sends none (allowed); a
// website sends its http(s) origin (rejected), so it cannot hijack the channel.
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1024 * 1024,
  verifyClient: ({ origin }) =>
    !origin || origin.startsWith('chrome-extension://'),
});

wss.on('connection', (ws) => {
  if (socket && socket.readyState === socket.OPEN) {
    hubLog('replacing an existing extension connection');
    socket.close();
  }
  socket = ws;
  connectionGeneration += 1;
  hubLog(`extension connected (generation ${connectionGeneration})`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      hubLog('ignoring malformed frame');
      return;
    }
    if (msg.kind === 'hello') {
      extensionInfo = { ...msg.info, connectedAt: Date.now() };
      hubLog('hello from', msg.info?.extensionId, msg.info?.userAgent);
    } else if (msg.kind === 'result') {
      const pending = pendingCommands.get(msg.id);
      if (pending) {
        pendingCommands.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg.kind === 'message') {
      recordMessage({
        source: msg.source,
        body: msg.body,
        context: msg.context,
        sentAt: msg.sentAt,
      });
    } else if (msg.kind === 'event') {
      recordEvent({ event: msg.event, details: msg.details, at: msg.at });
    } else if (msg.kind === 'console') {
      recordConsole(msg);
    }
  });

  ws.on('close', () => {
    if (socket === ws) {
      socket = null;
      extensionInfo = null;
    }
    hubLog('extension disconnected');
  });

  ws.on('error', (err) => hubLog('socket error:', err.message));
});

// WebSocket traffic resets the MV3 idle timer, keeping the worker alive.
setInterval(() => {
  sendToExtension({ kind: 'ping', at: Date.now() });
}, 20000).unref();

server.listen(port, '127.0.0.1', () => {
  hubLog(`listening on http://127.0.0.1:${port}`);
  hubLog(`extension endpoint: ws://127.0.0.1:${port}/ws`);
  hubLog(`captures: ${outDir}`);
});
