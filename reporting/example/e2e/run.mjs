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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verify } from './verify.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hub: { type: 'string', default: 'http://127.0.0.1:7878' },
    json: { type: 'boolean', default: false },
    'keep-messages': { type: 'boolean', default: false },
  },
});

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

function resolveScenario(nameOrPath) {
  const candidates = [
    nameOrPath,
    path.join(e2eDir, 'scenarios', nameOrPath),
    path.join(e2eDir, 'scenarios', `${nameOrPath}.json`),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    const available = fs
      .readdirSync(path.join(e2eDir, 'scenarios'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    console.error(
      `unknown scenario "${nameOrPath}". Available: ${available.join(', ')}`,
    );
    process.exit(2);
  }
  return found;
}

async function hub(method, route, body) {
  const response = await fetch(`${values.hub}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function command(name, args = {}, timeout) {
  const { status, body } = await hub('POST', '/cmd', { name, args, timeout });
  if (status !== 200) {
    throw new Error(`${name} failed: ${body.error || status}`);
  }
  return body.result;
}

const health = await hub('GET', '/health').catch(() => null);
if (!health || health.status !== 200) {
  console.error(
    `hub is not reachable at ${values.hub} — start it with:\n  npm --workspace=reporting run e2e.hub`,
  );
  process.exit(2);
}
if (!health.body.extensionConnected) {
  console.error(
    'hub is up but the extension has not connected.\n' +
      'Check that the example extension is loaded and enabled, then reload it.',
  );
  process.exit(2);
}

const scenarioFile = resolveScenario(positionals[0] || 'smoke');
const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));

console.error(`scenario: ${scenario.name} (${path.basename(scenarioFile)})`);

if (!values['keep-messages']) {
  await hub('POST', '/messages/clear');
}
const startSeq = (await hub('GET', '/health')).body.seq;

const STEP_OPTIONS = ['timeout', 'continueOnError'];

const trace = [];
for (const [index, step] of (scenario.steps || []).entries()) {
  const entry = Object.entries(step).find(
    ([key]) => !STEP_OPTIONS.includes(key),
  );
  if (!entry) {
    console.error(`\nstep ${index + 1} has no command key`);
    process.exitCode = 1;
    break;
  }
  const [name, args] = entry;
  const label = `${index + 1}/${scenario.steps.length} ${name}`;
  process.stderr.write(`  ${label} ... `);
  const startedAt = Date.now();
  try {
    const result = await command(name, args ?? {}, step.timeout);
    const took = Date.now() - startedAt;
    process.stderr.write(`ok (${took}ms)\n`);
    trace.push({ step: name, args, result, tookInMs: took });
  } catch (e) {
    process.stderr.write(`FAILED\n`);
    console.error(`\n  ${e.message}\n`);
    trace.push({ step: name, args, error: e.message });
    if (step.continueOnError !== true) {
      process.exitCode = 1;
      break;
    }
  }
}

const captured = (await hub('GET', `/messages?since=${startSeq}`)).body
  .messages;
const events = (await hub('GET', `/events?since=${startSeq}`)).body.events;
const result = verify(captured, scenario.expect || {});

if (values.json) {
  console.log(
    JSON.stringify(
      { scenario: scenario.name, result, captured, trace },
      null,
      2,
    ),
  );
} else {
  console.log(`\ncaptured ${captured.length} message(s):`);
  const byAction = {};
  for (const message of captured) {
    const action = message.body?.action || message.body?.type || '<unknown>';
    byAction[action] = (byAction[action] || 0) + 1;
  }
  for (const [action, count] of Object.entries(byAction)) {
    console.log(`  ${count}x ${action}`);
  }

  if (result.ok) {
    console.log('\nPASSED');
  } else {
    console.log(`\nFAILED — ${result.failures.length} problem(s):`);
    for (const failure of result.failures) {
      console.log(`  [${failure.kind}] ${failure.detail}`);
      if (failure.sawInstead?.length) {
        console.log(
          `      saw instead: ${JSON.stringify(failure.sawInstead).slice(
            0,
            300,
          )}`,
        );
      }
    }
    const interesting = events.filter((e) =>
      ['jobRejected', 'jobFailed', 'jobExpired'].includes(e.event),
    );
    if (interesting.length > 0) {
      console.log('\n  job events worth a look:');
      for (const event of interesting.slice(0, 20)) {
        console.log(
          `    ${event.event} ${event.details?.type} ${JSON.stringify(
            event.details?.args || {},
          ).slice(0, 160)}`,
        );
      }
    }
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
