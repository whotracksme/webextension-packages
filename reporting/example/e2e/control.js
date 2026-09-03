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

const DEFAULT_HUB_URL = 'ws://127.0.0.1:7878/ws';
const MAX_BUFFERED_RECORDS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class E2EBridge {
  constructor({ hubUrl = DEFAULT_HUB_URL } = {}) {
    this.hubUrl = hubUrl;
    this.socket = null;
    this.buffer = [];
    this.reconnectDelay = 1000;
    this.commands = {};
    this.connected = false;
  }

  registerCommands(commands) {
    Object.assign(this.commands, commands);
  }

  connect() {
    if (this.socket) {
      return;
    }
    let socket;
    try {
      socket = new WebSocket(this.hubUrl);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this._raw({
        kind: 'hello',
        info: {
          extensionId: chrome.runtime.id,
          userAgent: navigator.userAgent,
          manifestVersion: chrome.runtime.getManifest().manifest_version,
          startedAt: Date.now(),
        },
      });
      const pending = this.buffer.splice(0, this.buffer.length);
      pending.forEach((record) => this._raw(record));
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.kind === 'command') {
        this._runCommand(msg);
      }
    });

    socket.addEventListener('close', () => {
      this.connected = false;
      this.socket = null;
      this._scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      try {
        socket.close();
      } catch {
        // the close handler takes care of reconnecting
      }
    });
  }

  _scheduleReconnect() {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  _raw(record) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(record));
      return true;
    }
    return false;
  }

  _send(record) {
    if (!this._raw(record)) {
      this.buffer.push(record);
      if (this.buffer.length > MAX_BUFFERED_RECORDS) {
        this.buffer.shift();
      }
    }
  }

  async _runCommand({ id, name, args }) {
    const handler = this.commands[name];
    if (!handler) {
      this._raw({
        kind: 'result',
        id,
        error: `unknown command: ${name}. Known: ${Object.keys(this.commands)
          .sort()
          .join(', ')}`,
      });
      return;
    }
    try {
      const result = await handler(args || {});
      this._raw({ kind: 'result', id, result: result ?? null });
    } catch (e) {
      this._raw({ kind: 'result', id, error: `${e?.stack || e}` });
    }
  }

  captureMessage(source, body, context) {
    this._send({ kind: 'message', source, body, context, sentAt: Date.now() });
  }

  captureEvent(event, details) {
    this._send({ kind: 'event', event, details, at: Date.now() });
  }

  captureConsole(level, text) {
    this._send({ kind: 'console', level, text });
  }
}

// No public queue snapshot exists on the scheduler.
function summarizeJobs(jobScheduler) {
  const description = jobScheduler._describeJobs();
  const byState = {};
  for (const [state, jobs] of Object.entries(description.queues.byState)) {
    byState[state] = jobs.length;
  }
  const byType = {};
  for (const [type, queue] of Object.entries(description.queues.byType)) {
    byType[type] = queue.all.length;
  }
  return {
    total: description.queues.all.length,
    byState,
    byType,
    stats: { ...jobScheduler.stats },
  };
}

async function waitForTabLoad(tabId, timeoutInMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      clearTimeout(timer);
      clearInterval(poller);
      resolve(reason);
    };

    function onCompleted(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        finish('onCompleted');
      }
    }

    chrome.webNavigation.onCompleted.addListener(onCompleted);
    const timer = setTimeout(() => finish('timeout'), timeoutInMs);

    // onCompleted can be missed, so the poll is the safety net.
    const poller = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete' && tab.url && tab.url !== 'about:blank') {
          finish('polled');
        }
      } catch {
        finish('tab-gone');
      }
    }, 250);
  });
}

// Never inject synthetic input events: isTrusted=false is a bot signal.
export function createCommands({
  urlReporter,
  requestReporter,
  quorumControl,
  bridge,
}) {
  const { jobScheduler, pageAggregator, patterns } = urlReporter;

  async function resolveTabId({ tabId, newTab }) {
    if (tabId) {
      return tabId;
    }
    if (newTab) {
      const created = await chrome.tabs.create({
        url: 'about:blank',
        active: true,
      });
      return created.id;
    }
    const [active] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (active?.url && /^https?:/.test(active.url)) {
      return active.id;
    }
    const created = await chrome.tabs.create({
      url: 'about:blank',
      active: true,
    });
    return created.id;
  }

  async function navigate({
    url,
    tabId,
    newTab = false,
    waitForLoad = true,
    timeoutInMs = 45000,
    settleInMs = 1500,
  }) {
    if (!url) {
      throw new Error('navigate requires a "url"');
    }
    if (!/^https?:\/\//.test(url)) {
      throw new Error('navigate only accepts http(s) URLs');
    }
    const targetTabId = await resolveTabId({ tabId, newTab });
    await chrome.tabs.update(targetTabId, { url, active: true });
    let reason = 'not-awaited';
    if (waitForLoad) {
      reason = await waitForTabLoad(targetTabId, timeoutInMs);
    }
    if (settleInMs > 0) {
      await sleep(settleInMs);
    }
    const tab = await chrome.tabs.get(targetTabId).catch(() => null);
    return {
      tabId: targetTabId,
      requestedUrl: url,
      url: tab?.url,
      title: tab?.title,
      status: tab?.status,
      loadedBecause: reason,
    };
  }

  async function pendingJobsSettled({ settleInMs }) {
    await sleep(settleInMs);
    return summarizeJobs(jobScheduler);
  }

  async function flush({
    maxRounds = 12,
    settleInMs = 3500,
    forceExpiration = true,
  } = {}) {
    const rounds = [];
    for (let round = 1; round <= maxRounds; round += 1) {
      pageAggregator.fullSync();
      if (forceExpiration) {
        await pageAggregator.checkExpiredPages({
          forceExpiration: true,
          maxEntriesToCheck: 1000,
        });
      }
      await urlReporter.processPendingJobs();
      const pending = summarizeJobs(jobScheduler);
      rounds.push({ round, pending: pending.total, byState: pending.byState });
      if (pending.total === 0) {
        return { drained: true, rounds };
      }
      await pendingJobsSettled({ settleInMs });
    }
    return { drained: false, rounds, pending: summarizeJobs(jobScheduler) };
  }

  return {
    async ping() {
      return { pong: true, now: Date.now() };
    },

    async state() {
      const tabs = await chrome.tabs.query({});
      return {
        extensionId: chrome.runtime.id,
        isActive: urlReporter.isActive,
        requestReporterReady: requestReporter?.ready ?? null,
        patternCategories: Object.keys(patterns.getRulesSnapshot() || {}),
        countryCode: urlReporter.countryProvider.getSafeCountryCode(),
        jobs: summarizeJobs(jobScheduler),
        quorum: quorumControl.describe(),
        tabs: tabs.map(({ id, url, title, status, active }) => ({
          id,
          url,
          title,
          status,
          active,
        })),
      };
    },

    navigate,

    async closeTabs({ urlContains } = {}) {
      const tabs = await chrome.tabs.query({});
      const victims = tabs.filter(
        (tab) =>
          tab.url &&
          /^https?:/.test(tab.url) &&
          (!urlContains || tab.url.includes(urlContains)),
      );
      if (victims.length > 0) {
        await chrome.tabs.remove(victims.map((tab) => tab.id));
      }
      return { closed: victims.map((tab) => tab.url) };
    },

    flush,

    async processPendingJobs() {
      await urlReporter.processPendingJobs();
      return summarizeJobs(jobScheduler);
    },

    async expirePages({ forceExpiration = true, maxEntriesToCheck = 1000 }) {
      pageAggregator.fullSync();
      const result = await pageAggregator.checkExpiredPages({
        forceExpiration,
        maxEntriesToCheck,
      });
      return { ...result, jobs: summarizeJobs(jobScheduler) };
    },

    async dumpJobs({ includeArgs = false } = {}) {
      const description = jobScheduler._describeJobs();
      const describe = (jobEntry) => ({
        type: jobEntry.job?.type,
        readyAt: jobEntry._meta?.readyAt,
        expireAt: jobEntry._meta?.expireAt,
        createdAt: jobEntry._meta?.createdAt,
        args: includeArgs ? jobEntry.job?.args : undefined,
      });
      return {
        summary: summarizeJobs(jobScheduler),
        byState: Object.fromEntries(
          Object.entries(description.queues.byState).map(([state, jobs]) => [
            state,
            jobs.map(describe),
          ]),
        ),
      };
    },

    async selfChecks() {
      const check = await urlReporter.selfChecks();
      return check.report();
    },

    async setQuorum({ mode }) {
      quorumControl.setMode(mode);
      return quorumControl.describe();
    },

    // Replaces the served patterns for this session. They are persisted and
    // the next poll is pushed out by a full interval, so neither a worker
    // restart nor the updater brings the served ones back meanwhile. Applied
    // only once the reporter is active: init() awaits the startup fetch of
    // the served patterns, which would otherwise land on top of these.
    async setPatterns({ rules, timeoutInMs = 30000 }) {
      if (!rules || typeof rules !== 'object') {
        throw new Error('setPatterns requires "rules" (an object)');
      }
      const startedAt = Date.now();
      while (!urlReporter.isActive) {
        if (Date.now() - startedAt > timeoutInMs) {
          throw new Error('reporter did not become active');
        }
        await sleep(100);
      }
      patterns.updatePatterns(rules);
      const { patternsUpdater } = urlReporter;
      patternsUpdater._persistedState.patterns = JSON.stringify(rules);
      patternsUpdater._persistedState.failedAttemptsInARow = 0;
      patternsUpdater._persistedState.skipAttemptsUntil =
        Date.now() + patternsUpdater.defaultUpdateInterval.max;
      await patternsUpdater._savePersistedState();
      return { categories: Object.keys(patterns.getRulesSnapshot() || {}) };
    },

    // Restarts rather than unload()+init(): Pages#init is one-shot.
    async reset() {
      await chrome.storage.local.clear();
      bridge.captureEvent('reset', { strategy: 'worker-restart' });
      setTimeout(() => chrome.runtime.reload(), 50);
      return { ok: true, restarting: true };
    },

    async reload() {
      bridge.captureEvent('reload', {});
      setTimeout(() => chrome.runtime.reload(), 50);
      return { ok: true, restarting: true };
    },
  };
}

export function pipeJobEventsToHub(jobScheduler, bridge) {
  const events = [
    'jobRegistered',
    'jobStarted',
    'jobSucceeded',
    'jobFailed',
    'jobExpired',
    'jobRejected',
  ];
  for (const event of events) {
    jobScheduler.addObserver(
      event,
      (jobEntry) => {
        bridge.captureEvent(event, {
          type: jobEntry?.job?.type,
          args: jobEntry?.job?.args,
          meta: jobEntry?._meta,
        });
      },
      { ignoreAfterInitWarning: true },
    );
  }
}
