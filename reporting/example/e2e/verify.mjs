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

const REQUIRED_FIELDS = {
  'wtm.page': ['url', 't', 'ref', 'redirects', 'lang', 'ctry', 'activity'],
  'wtm.attrack.tp_events': null,
  'wtm.attrack.tokensv2': null,
  'wtm.attrack.keysv2': null,
};

// Actions come from the patterns file, not this repo, so they cannot be listed.
const SEARCH_CONTEXT_FIELDS = ['q', 'qurl', 'ctry'];

function looksLikeSearchMessage(message) {
  return typeof message.body?.payload?.qurl === 'string';
}

function collectStrings(value, found = []) {
  if (typeof value === 'string') {
    found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, found));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      found.push(key);
      collectStrings(item, found);
    });
  }
  return found;
}

function actionOf(message) {
  return message.body?.action || message.body?.type || '<unknown>';
}

function requiredFieldsFor(message) {
  const action = actionOf(message);
  if (action in REQUIRED_FIELDS) {
    return REQUIRED_FIELDS[action];
  }
  return looksLikeSearchMessage(message) ? SEARCH_CONTEXT_FIELDS : null;
}

export function checkShapes(messages) {
  const failures = [];
  for (const message of messages) {
    const action = actionOf(message);
    const required = requiredFieldsFor(message);
    if (!required) {
      continue;
    }
    const payload = message.body?.payload || {};
    const missing = required.filter((field) => !(field in payload));
    if (missing.length > 0) {
      failures.push({
        kind: 'shape',
        seq: message.seq,
        action,
        detail: `payload is missing: ${missing.join(', ')}`,
      });
    }
  }
  return failures;
}

// Scans every string and every object key: a leak hiding in a key is still a leak.
export function checkNoLeaks(messages, mustNotAppear = []) {
  const failures = [];
  if (mustNotAppear.length === 0) {
    return failures;
  }
  for (const message of messages) {
    const haystack = collectStrings(message.body).join('\0').toLowerCase();
    for (const needle of mustNotAppear) {
      if (haystack.includes(needle.toLowerCase())) {
        failures.push({
          kind: 'leak',
          seq: message.seq,
          action: actionOf(message),
          detail: `forbidden string "${needle}" appears in an outgoing message`,
          message: message.body,
        });
      }
    }
  }
  return failures;
}

function matches(message, expectation) {
  const payload = message.body?.payload || {};
  return Object.entries(expectation).every(([pathExpr, expected]) => {
    const actual = pathExpr
      .split('.')
      .reduce((acc, key) => (acc == null ? acc : acc[key]), payload);
    if (expected instanceof RegExp) {
      return typeof actual === 'string' && expected.test(actual);
    }
    if (typeof expected === 'string' && expected.startsWith('~')) {
      return typeof actual === 'string' && actual.includes(expected.slice(1));
    }
    return actual === expected;
  });
}

export function checkExpected(messages, expected = {}) {
  const failures = [];
  for (const [key, expectations] of Object.entries(expected)) {
    const exact = key.startsWith('=');
    const action = exact ? key.slice(1) : key;
    const candidates = messages.filter((m) =>
      exact ? actionOf(m) === action : actionOf(m).startsWith(action),
    );
    for (const expectation of expectations) {
      const hit = candidates.find((message) => matches(message, expectation));
      if (!hit) {
        failures.push({
          kind: 'missing',
          action,
          detail: `no ${action} message matched ${JSON.stringify(expectation)}`,
          sawInstead: candidates.map((m) => m.body?.payload?.url ?? m.body),
        });
      }
    }
  }
  return failures;
}

export function checkForbiddenActions(messages, forbiddenActions = []) {
  return messages
    .filter((message) =>
      forbiddenActions.some((action) => actionOf(message).startsWith(action)),
    )
    .map((message) => ({
      kind: 'forbidden-action',
      seq: message.seq,
      action: actionOf(message),
      detail: `message action "${actionOf(
        message,
      )}" must not be sent in this scenario`,
    }));
}

export function verify(messages, expect = {}) {
  const failures = [
    ...checkShapes(messages),
    ...checkNoLeaks(messages, expect.mustNotAppear || []),
    ...checkForbiddenActions(messages, expect.forbiddenActions || []),
    ...checkExpected(messages, expect.messages || {}),
  ];
  return { ok: failures.length === 0, failures };
}
