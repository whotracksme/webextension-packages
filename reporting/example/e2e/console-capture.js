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

// Must be imported before src/: Logger binds console.* in its constructor.
const MAX_BUFFERED_LINES = 1000;

const buffer = [];
let sink = null;
let insideForward = false;

function stringify(arg) {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function emit(level, args) {
  if (insideForward) {
    return;
  }
  insideForward = true;
  try {
    const text = args.map(stringify).join(' ');
    if (sink) {
      sink(level, text);
    } else {
      buffer.push([level, text]);
      if (buffer.length > MAX_BUFFERED_LINES) {
        buffer.shift();
      }
    }
  } finally {
    insideForward = false;
  }
}

for (const level of ['debug', 'log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    emit(level, args);
  };
}

export function attachConsoleSink(fn) {
  sink = fn;
  const pending = buffer.splice(0, buffer.length);
  for (const [level, text] of pending) {
    fn(level, text);
  }
}
