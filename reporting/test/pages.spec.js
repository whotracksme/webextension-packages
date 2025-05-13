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

import Pages, { stripLazyVars, CANCEL_LAZY_VAR } from '../src/pages.js';
import UrlAnalyzer from '../src/url-analyzer.js';
import SessionStorageWrapper from '../src/session-storage.js';
import Patterns from '../src/patterns.js';

function waitForPendingMicrotasks() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

class ListenerMock {
  constructor() {
    this._listeners = new Set();
  }

  addListener(handler) {
    this._listeners.add(handler);
  }

  removeListener(handler) {
    this._listeners.delete(handler);
  }

  hasListener(handler) {
    return this._listeners.has(handler);
  }

  hasListeners() {
    return this._listeners.size > 0;
  }

  dispatch(...args) {
    this._listeners.forEach((handler) => handler(...args));
  }
}

function completeListenersApi() {
  return {
    tabs: [
      'onZoomChange',
      'onReplaced',
      'onRemoved',
      'onAttached',
      'onDetached',
      'onHighlighted',
      'onActivated',
      'onMoved',
      'onUpdated',
      'onCreated',
    ],
    webNavigation: [
      'onHistoryStateUpdated',
      'onTabReplaced',
      'onReferenceFragmentUpdated',
      'onCreatedNavigationTarget',
      'onErrorOccurred',
      'onCompleted',
      'onDOMContentLoaded',
      'onCommitted',
      'onBeforeNavigate',
    ],
    webRequest: [
      'onErrorOccurred',
      'onCompleted',
      'onBeforeRedirect',
      'onResponseStarted',
      'onAuthRequired',
      'onHeadersReceived',
      'onSendHeaders',
      'onBeforeSendHeaders',
      'onBeforeRequest',
    ],
    windows: ['onBoundsChanged', 'onCreated', 'onFocusChanged', 'onRemoved'],
  };
}

class ChromeApiMock {
  constructor({ listeners = completeListenersApi() } = {}) {
    this._listeners = listeners;
    for (const [api, events] of Object.entries(listeners)) {
      this[api] = this[api] || {};
      for (const event of events) {
        this[api][event] = new ListenerMock();
      }
    }

    const tabQueryStub = async () => [];
    this.tabs = this.tabs || {};
    this.tabs.query = this.tabs.query || tabQueryStub;
  }

  _ensureAllListenersRemoved() {
    for (const [api, events] of Object.entries(this._listeners)) {
      const listeners = events.filter((x) => this[api][x].hasListeners());
      if (listeners.length > 0) {
        throw new Error(
          `Forgot to clean up listener: chrome.${api} still has the following listeners: ${listeners}`,
        );
      }
    }
  }

  async replay(uut, initialState, recordedEvents) {
    if (initialState.openTabs) {
      uut.openTabs = new Map(initialState.openTabs);
    }

    // eslint-disable-next-line no-undef
    const verbose = __karma__.config.VERBOSE_REPLAY;
    // eslint-disable-next-line no-undef
    const runSelfChecks = __karma__.config.ENABLE_SELF_CHECKS;

    let step;
    let stopObserving = false;
    const emittedPageEvents = [];
    uut.addObserver((event) => {
      if (stopObserving) {
        console.warn(
          'page event seen after replay completed:',
          JSON.stringify(event),
        );
        return;
      }
      if (verbose) {
        console.log(
          `page event triggered (step=${step}):`,
          JSON.stringify(event),
        );
      }
      emittedPageEvents.push({ step, pageEvent: event });
    });

    try {
      const history = [];
      for (step = 0; step < recordedEvents.length; step += 1) {
        const { startedAt, api, event, args } = recordedEvents[step];

        // (optional) build a log of the intermediate states
        const stateBeforeAction = verbose
          ? uut.describe(startedAt)
          : '<unavailable: set VERBOSE_REPLAY to enable>';
        history.push({
          stateBeforeAction,
          step,
          ...recordedEvents[step],
        });
        if (history.length > 100) {
          history.shift();
        }
        if (verbose) {
          console.log(`--- Executing step: ${step} ---`);
          console.log(JSON.stringify(history.at(-1), null, 2));
        }

        // execute the next step (modifies the state)
        this[api][event].dispatch(...args);

        // (optional) run self-checks
        // Warning: this is async, so it may change the observation!
        if (runSelfChecks) {
          const check = await uut.selfChecks();
          const { status, overview, log } = check.report();

          if (status === 'FAILED') {
            const ppOverview = JSON.stringify(overview, null, 2);
            console.error(
              `*** self checks failed after step=${step}:\n`,
              ppOverview,
              '\n--- begin details ---:\n',
              JSON.stringify(log, null, 2),
              '\n--- end details ---',
            );
            throw new Error(
              `self checks failed after step=${step} (for details, see logs)`,
            );
          }
        }
      }
      await waitForPendingMicrotasks();
      return emittedPageEvents;
    } finally {
      stopObserving = true;
    }
  }
}

function newUrlAnalyzer() {
  return new UrlAnalyzer(new Patterns());
}

function stubNewPageApprover() {
  return {
    async markAsPrivate() {},
  };
}

function newInMemorySessionStore() {
  // forces an in-memory fallback session storage
  return new SessionStorageWrapper({ sessionApi: null });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to reach endpoint: ${url}: ${response.statusText}`);
  }
  return response.json();
}

async function loadTestFixtures(url) {
  const { links } = await fetchJson(url);
  expect(links).to.be.an('object');
  const expectedOrigin = new URL(url).origin;
  for (const fixtureUrl of Object.values(links)) {
    expect(new URL(fixtureUrl).origin).to.eql(expectedOrigin);
  }
  return Object.entries(links).map(([name, link]) => ({
    name,
    scenarioLink: link,
  }));
}

describe('#Pages', function () {
  describe('without providing a full implementation of the chrome API', function () {
    it('should load and unload', async function () {
      const pages = new Pages({
        config: {},
        urlAnalyzer: newUrlAnalyzer(),
        newPageApprover: stubNewPageApprover(),
        pageSessionStore: newInMemorySessionStore(),
      });
      await pages.init();
      pages.unload();
    });
  });

  describe('with a complete chrome API stub', function () {
    let uut;
    let chromeApiMock;
    let urlAnalyzer;

    async function runScenario(name, { notes, expectations, events }) {
      const { initialState, recorded } = events || {};
      try {
        expect(notes, '<notes>').to.be.a('string');
        expect(expectations, '<expectations>').to.be.an('object');
        expect(initialState, '<events.initialState>').to.be.an('object');
        expect(recorded, '<events.recorded>').to.be.an('array');
      } catch (e) {
        e.message = `Broken scenario '${name}' detected (${e.message})`;
        throw e;
      }

      const allEmittedPageEvents = await chromeApiMock.replay(
        uut,
        initialState,
        recorded,
      );
      const state = uut.describe();
      try {
        const { expectedTabs, activeTab, pageEvents, ...unexpectedFields } =
          expectations;
        expect(unexpectedFields).to.eql({});

        const pp = (x) => JSON.stringify(x, null, 2);

        // Compares open tabs at the end of the scenario.
        //
        // Notes:
        // * The given mapping from tabId to description is complete in that
        //   sense that all keys (tabIds) must match.
        // * However, it is a partial match, since you can leave out keys
        //   in the page description. It will only enforce that all given
        //   fields exist and match exactly; but it will ignore extra keys.
        //
        // Example 1: two open tabs (with tab 2 and 3)
        //
        // "expectedTabs": {
        //   "2": {
        //     "status": "complete",
        //     "title": "Test page",
        //     "url": "https://www.example.test/",
        //     "windowId": 1,
        //     "isActive": false,
        //     "pageLoadMethod": "history-navigation",
        //     "search": {
        //       "category": "gh",
        //       "query": "testing",
        //       "depth": 0
        //     }
        //   },
        //   "3": {
        //     "status": "complete",
        //   }
        // }
        if (expectedTabs) {
          const expectedTabIds = Object.keys(expectedTabs);
          if (expectedTabIds.length !== 0) {
            expect(state.openTabs).to.have.all.keys(expectedTabIds);
            for (const [tabId, data] of Object.entries(expectedTabs)) {
              expect(state.openTabs[tabId]).to.deep.include(data);
            }
          } else {
            expect(Object.keys(state.openTabs)).to.eql([]);
          }
        }

        // Compares the active tabs at the end of the scenario.
        //
        // Example 1: tabId=3 is active
        //
        // "activeTab": {
        //   "tabId": 3
        // }
        //
        // Example 2: No active tab
        //
        // "active": "none"
        //
        if (activeTab === 'none') {
          if (state.activeTab !== undefined) {
            expect.fail(
              `Expected no active tab, but got:\n${pp(state.activeTab)}`,
            );
          }
        } else if (activeTab) {
          if (state.activeTab === undefined) {
            expect.fail(
              `No open tab, but expected the to be open: ${pp(activeTab)}`,
            );
          }
          for (const [key, value] of Object.entries(activeTab)) {
            expect(state.activeTab[key]).to.eql(
              value,
              'Active tabs do not match:\nExpected the following values...\n' +
                pp(activeTab) +
                '\n\n... to be present in\n' +
                pp(state.activeTab),
            );
          }
        }

        // Emitted page events:
        //
        // Notes:
        // * If the ordering of "mustContain" is relevant, use "mustContainSequence"
        //   It is like "mustContain", but does not rewind after finding a match.
        // * To remove noise in the output:
        //   "ignoredTypes": ["lazy-init", "page-updated", "activity-updated"]
        // * Or focus on specific types with "focusType"
        //
        // "pageEvents": {
        //   // filters:
        //   "ignoredTypes": ["some-noisy-type"], // optional
        //   "focusType": ["important-type", "another-important-one"], // optional
        //
        //   // expectations:
        //   "mustContain": [
        //     { // match exactly this message (needs to have exactly these tree fields)
        //       "type": "A",
        //       "x": "foo",
        //       "y": "bar"
        //     },
        //     { // match exactly this message, but it can be before "A"
        //       "type": "B",
        //       "...": "ignore", // if there are more fields, it will still match
        //     }
        //   ],
        //   "mustContainSequence": [
        //     // these must be all present and in the following order
        //     { "type": "first" },
        //     { "type": "second" },
        //     { "type": "third" }
        //   ]
        //   "mustNotContain": [
        //     {
        //       "type": "unexpected.signal",
        //       "...": "ignore"
        //     },
        //     {
        //       "x": "bad-value"
        //       "...": "ignore"
        //     }
        //   ],
        //   "counts": {
        //     "first": 1, // there was exactly one message of type "first"
        //     "second": 1,
        //     "third": 1,
        //   }
        // }
        if (pageEvents) {
          const matches = (expectedPageEvent) => {
            let shrink;
            if (expectedPageEvent['...'] === 'ignore') {
              expectedPageEvent = { ...expectedPageEvent };
              delete expectedPageEvent['...'];
              const focusedKeys = Object.keys(expectedPageEvent);

              shrink = (fullPageEvent) => {
                const obj = {};
                focusedKeys.forEach((key) => (obj[key] = fullPageEvent[key]));
                return obj;
              };
            } else {
              shrink = (fullPageEvent) => fullPageEvent;
            }

            return ({ pageEvent }) => {
              const actual = shrink(pageEvent);
              try {
                expect(actual).to.eql(expectedPageEvent);
                return true;
              } catch (e) {
                return false;
              }
            };
          };

          const {
            // Optional filters. To filter events before, or simplify to remove
            // noise and make error messages for failed tests more readable.
            focusedTypes = [],
            ignoredTypes = [],

            // checks:
            mustContain,
            mustContainSequence,
            mustNotContain,
            counts,
          } = pageEvents;
          let emittedPageEvents = [...allEmittedPageEvents];
          if (focusedTypes.length > 0) {
            const isFocused = ({ pageEvent }) =>
              focusedTypes.includes(pageEvent.type);
            emittedPageEvents = emittedPageEvents.filter(isFocused);
          } else if (ignoredTypes.length > 0) {
            const isIgnored = ({ pageEvent }) =>
              ignoredTypes.includes(pageEvent.type);
            emittedPageEvents = emittedPageEvents.filter((x) => !isIgnored(x));
          }
          if (mustContain) {
            expect(mustContain, '<expectations.mustContain>').to.be.an('array');
            for (const check of mustContain) {
              if (!emittedPageEvents.some(matches(check))) {
                expect.fail(
                  `Failed to find matching page event.\n\n` +
                    `List of all events:\n${pp(allEmittedPageEvents)}\n\n` +
                    `----------------------------------------------------------------------\n\n` +
                    `List of events after filter/focus:\n${pp(
                      emittedPageEvents,
                    )}\n\n` +
                    `Expected to find a signal that satisfies: ${pp(check)}\n` +
                    `Hint: if you want to ignore missing fields, use { "...": "ignore" }`,
                );
              }
            }
          }
          if (mustContainSequence) {
            expect(
              mustContainSequence,
              '<expectations.mustContainSequence>',
            ).to.be.an('array');
            let remainingEvents = [...emittedPageEvents];
            for (const check of mustContainSequence) {
              const isMatch = matches(check);
              for (;;) {
                const event = remainingEvents.shift();
                if (!event) {
                  expect.fail(
                    `Failed to find matching sequence.\n\n` +
                      `List of events after filter/focus:\n` +
                      `${pp(emittedPageEvents)}\n\n` +
                      `Expected to find a signal that satisfies: ${pp(
                        check,
                      )}\n` +
                      `Hint: if you want to ignore missing fields, use { "...": "ignore" }`,
                  );
                }
                if (isMatch(event)) {
                  break;
                }
              }
            }
          }
          if (mustNotContain) {
            expect(mustNotContain, '<expectations.mustNotContain>').to.be.an(
              'array',
            );
            for (const check of mustNotContain) {
              const unexpectedEvent = emittedPageEvents.find(matches(check));
              if (unexpectedEvent) {
                const event = pp(unexpectedEvent);
                expect.fail(
                  `Found unexpected page event:${event}\n\nIt matches: ${pp(
                    check,
                  )}`,
                );
              }
            }
          }
          if (counts) {
            expect(counts, '<expectations.counts>').to.be.an('object');
            for (const [eventType, expectedCount] of Object.entries(counts)) {
              const events = allEmittedPageEvents.filter(
                (x) => x.pageEvent.type === eventType,
              );
              if (events.length !== expectedCount) {
                expect.fail(
                  `List of all matching page events that have been found:\n` +
                    JSON.stringify(events, null, 2) +
                    `\n\nExpected ${expectedCount} of type ${eventType}, but found ${events.length}.`,
                );
              }
            }
          }
        }
      } catch (e) {
        e.results = state;
        throw e;
      }
    }

    function initMocks() {
      tryDestroyOldMocks();

      chromeApiMock = new ChromeApiMock();
      const config = {
        pages: {
          chrome: chromeApiMock,
        },
      };
      urlAnalyzer = newUrlAnalyzer();
      uut = new Pages({
        config,
        urlAnalyzer,
        newPageApprover: stubNewPageApprover(),
        pageSessionStore: newInMemorySessionStore(),
      });
    }

    function destroyMocks() {
      try {
        uut.unload();
        chromeApiMock._ensureAllListenersRemoved();
      } finally {
        uut = null;
        chromeApiMock = null;
        urlAnalyzer = null;
      }
    }

    function tryDestroyOldMocks() {
      if (uut) {
        try {
          destroyMocks();
        } catch (e) {
          console.warn('Ignore error while cleaning up old mocks', e);
        }
      }
    }

    beforeEach(initMocks);
    afterEach(destroyMocks);

    describe('should load and unload', function () {
      it('without waiting for fully initialization', async function () {
        await uut.init();
        uut.unload();
        chromeApiMock._ensureAllListenersRemoved();
      });

      it('when waiting for fully initialization', async function () {
        await uut.init();
        await uut._ready;
        uut.unload();
        chromeApiMock._ensureAllListenersRemoved();
      });
    });

    describe('when fully initialized', function () {
      beforeEach(async () => {
        await uut.init();
        await uut._ready;
      });

      it('should detect an opened page: new tab, followed by a page visit', async function () {
        chromeApiMock.tabs.onCreated.dispatch({
          active: true,
          audible: false,
          autoDiscardable: true,
          discarded: false,
          groupId: -1,
          height: 1069,
          highlighted: true,
          id: 1182717827,
          incognito: false,
          index: 1,
          mutedInfo: {
            muted: false,
          },
          openerTabId: 1182717595,
          pendingUrl: 'chrome://newtab/',
          pinned: false,
          selected: true,
          status: 'loading',
          title: 'New Tab',
          url: '',
          width: 729,
          windowId: 1182717594,
        });
        chromeApiMock.tabs.onActivated.dispatch({
          tabId: 1182717827,
          windowId: 1182717594,
        });
        chromeApiMock.tabs.onUpdated.dispatch(
          1182717827,
          {
            status: 'loading',
            url: 'chrome://newtab/',
          },
          {
            active: true,
            audible: false,
            autoDiscardable: true,
            discarded: false,
            groupId: -1,
            height: 1069,
            highlighted: true,
            id: 1182717827,
            incognito: false,
            index: 1,
            mutedInfo: {
              muted: false,
            },
            openerTabId: 1182717595,
            pinned: false,
            selected: true,
            status: 'loading',
            title: 'New Tab',
            url: 'chrome://newtab/',
            width: 729,
            windowId: 1182717594,
          },
        );
        chromeApiMock.tabs.onUpdated.dispatch(
          1182717827,
          {
            status: 'complete',
          },
          {
            active: true,
            audible: false,
            autoDiscardable: true,
            discarded: false,
            favIconUrl: '',
            groupId: -1,
            height: 1069,
            highlighted: true,
            id: 1182717827,
            incognito: false,
            index: 1,
            mutedInfo: {
              muted: false,
            },
            openerTabId: 1182717595,
            pinned: false,
            selected: true,
            status: 'complete',
            title: 'New Tab',
            url: 'chrome://newtab/',
            width: 729,
            windowId: 1182717594,
          },
        );

        // verify: the new tab should be open now
        expect(uut.activeTab.tabId).to.eql(1182717827);
        expect(uut.openTabs._map).to.have.keys(1182717827);
        expect(uut.openTabs.get(1182717827)).to.include({
          status: 'complete',
          title: 'New Tab',
          url: 'chrome://newtab/',
        });

        chromeApiMock.tabs.onUpdated.dispatch(
          1182717827,
          {
            status: 'loading',
            url: 'http://example.test/',
          },
          {
            active: true,
            audible: false,
            autoDiscardable: true,
            discarded: false,
            groupId: -1,
            height: 1069,
            highlighted: true,
            id: 1182717827,
            incognito: false,
            index: 1,
            mutedInfo: {
              muted: false,
            },
            openerTabId: 1182717595,
            pinned: false,
            selected: true,
            status: 'loading',
            title: 'example.test',
            url: 'http://example.test/',
            width: 729,
            windowId: 1182717594,
          },
        );
        chromeApiMock.tabs.onUpdated.dispatch(
          1182717827,
          {
            status: 'complete',
          },
          {
            active: true,
            audible: false,
            autoDiscardable: true,
            discarded: false,
            groupId: -1,
            height: 1069,
            highlighted: true,
            id: 1182717827,
            incognito: false,
            index: 1,
            mutedInfo: {
              muted: false,
            },
            openerTabId: 1182717595,
            pinned: false,
            selected: true,
            status: 'complete',
            title: 'example.test',
            url: 'http://example.test/',
            width: 729,
            windowId: 1182717594,
          },
        );

        // verify: the new page should be detected now
        expect(uut.activeTab.tabId).to.eql(1182717827);
        expect(uut.openTabs._map).to.have.keys(1182717827);
        expect(uut.openTabs.get(1182717827)).to.include({
          status: 'complete',
          title: 'example.test',
          url: 'http://example.test/',
        });
      });

      // This are optional tests that can be enabled if the REPLAY_FIXTURES_URL
      // environment variable is defined. Karma lacks access to the filesystem,
      // but we can fetch fixtures over the network.
      //
      // eslint-disable-next-line no-undef
      const testFixturesUrl = __karma__.config.REPLAY_FIXTURES_URL;
      if (testFixturesUrl) {
        it('passes remote tests', async function () {
          this.timeout(10000000);
          const maxRequests = 3;
          const fixtures = await loadTestFixtures(testFixturesUrl);
          const fixtures2 = [...fixtures];
          const prefetchScenario = () => {
            const next = fixtures2.shift();
            if (next) {
              next.pendingFixture = fetchJson(next.scenarioLink);
            }
          };
          for (let i = 0; i < maxRequests - 1; i += 1) {
            prefetchScenario();
          }
          let testsPassed = [];
          let testsFailed = [];
          try {
            console.log(
              `Running test fixtures: ${fixtures.length} tests found`,
            );
            while (fixtures.length > 0) {
              prefetchScenario();
              initMocks();
              await uut.init();
              await uut.blockUntilFullInit();

              const { name, pendingFixture } = fixtures.shift();
              const fixture = await pendingFixture;
              try {
                if (!fixture?.scenario) {
                  throw new Error(
                    'Broken test setup: expected a "scenario" field',
                  );
                }
                await runScenario(name, fixture.scenario);
                testsPassed.push(name);
                console.log(`test ${name}: PASSED`);
              } catch (e) {
                testsFailed.push({ name, error: e });
                e.message = `Test fixture <${name}> failed: ${e}\n\nTest fixture <${name}>`;
                console.error(e);
                if (e.results) {
                  console.log(`This was the scenario (${name}):\n
---------------------- begin scenario notes --------------------------
${fixture.scenario?.notes || '<missing>'}
----------------------- end scenario notes  --------------------------

-------------------- begin scenario expectations ---------------------
${JSON.stringify(fixture.scenario?.expectations || '<missing>', null, 2)}
--------------------- end scenario expectations ----------------------

But this was the actual state:\n
--------------------- begin actual state -----------------------------
${JSON.stringify(e.results, null, 2)}
---------------------- end actual state ------------------------------
`);
                }
              }
            }
            if (testsFailed.length > 0) {
              throw testsFailed[0].error;
            }
          } finally {
            const passed = testsPassed.length;
            const failed = testsFailed.length;
            const total = testsPassed.length + testsFailed.length;
            if (total > 0) {
              const ratio = ((100 * passed) / total).toFixed(2);
              console.log(
                `
****************** remote test results *************
${total} tests run: ${passed} passed, ${failed} failed (${ratio}% passed)
****************************************************
`,
              );
              if (failed > 0) {
                console.warn(
                  `The following tests failed:\n${testsFailed
                    .map((x) => `* ${x.error}`)
                    .join('\n')}\n\n`,
                );
              }
            }
          }
        });
      }
    });
  });
});

describe('#stripLazyVars', function () {
  describe('should not modify object without lazy vars', async function () {
    for (const [pos, value] of Object.entries([
      null,
      undefined,
      0,
      1,
      1.23,
      NaN,
      Infinity,
      'foo',
      [],
      [1, 2, 3],
      [[]],
      new Date(0),
      { foo: 1 },
      { foo: 1, bar: { baz: 2 } },
      { foo: NaN },
      { foo: null },
      [null],
      [NaN],
      [undefined],
    ])) {
      it(`- example ${pos}: ${JSON.stringify(value)}`, async function () {
        expect(stripLazyVars(value)).to.eql(value);
      });
    }
  });

  describe('should omit keys that map to "undefined"', async function () {
    for (const [pos, { before, after }] of Object.entries([
      {
        before: {
          foo: undefined,
        },
        after: {},
      },
      {
        before: {
          foo: {
            bar: undefined,
          },
        },
        after: {
          foo: {},
        },
      },
      {
        before: {
          foo: 42,
          bar: undefined,
        },
        after: {
          foo: 42,
        },
      },
    ])) {
      it(`- example ${pos}: ${JSON.stringify(before)}`, async function () {
        expect(stripLazyVars(before)).to.eql(after);
      });
    }
  });

  describe('should should remove pending lazy vars', async function () {
    for (const [pos, { before, after }] of Object.entries([
      {
        before: {
          pendingLazyVar: {
            _pending: {},
          },
        },
        after: {},
      },
      {
        before: {
          pendingLazyVar: {
            _pending: {},
          },
        },
        after: {},
      },
    ])) {
      it(`- example ${pos}: ${JSON.stringify(before)}`, async function () {
        expect(stripLazyVars(before)).to.eql(after);
      });
    }
  });

  describe('should should remove cancelled lazy vars', async function () {
    for (const [pos, { before, after }] of Object.entries([
      {
        before: {
          cancelledLazyVar: {
            _pending: {
              result: CANCEL_LAZY_VAR,
            },
          },
        },
        after: {},
      },
      {
        before: {
          foo: {
            cancelledLazyVar: {
              _pending: {
                result: CANCEL_LAZY_VAR,
              },
            },
          },
        },
        after: {
          foo: {},
        },
      },
      {
        before: {
          pageStructure: CANCEL_LAZY_VAR,
        },
        after: {},
      },
      {
        before: {
          status: 'complete',
          title:
            'A comparison of the Gauss–Newton and quasi-Newton methods in resistivity imaging inversion - ScienceDirect',
          url: 'https://www.sciencedirect.com/science/article/abs/pii/S0926985101001069',
          windowId: 1500,
          lastUpdatedAt: 1724851933284,
          pageId: 1354398384,
          visibility: 'unknown',
          pageStructure: CANCEL_LAZY_VAR,
          language: 'en',
        },
        after: {
          status: 'complete',
          title:
            'A comparison of the Gauss–Newton and quasi-Newton methods in resistivity imaging inversion - ScienceDirect',
          url: 'https://www.sciencedirect.com/science/article/abs/pii/S0926985101001069',
          windowId: 1500,
          lastUpdatedAt: 1724851933284,
          pageId: 1354398384,
          visibility: 'unknown',
          language: 'en',
        },
      },
      {
        before: {
          foo: {
            pageStructure: CANCEL_LAZY_VAR,
          },
        },
        after: {
          foo: {},
        },
      },
    ])) {
      it(`- example ${pos}: ${JSON.stringify(before)}`, async function () {
        expect(stripLazyVars(before)).to.eql(after);
      });
    }
  });

  describe('should should inline resolved lazy vars', async function () {
    for (const [pos, { before, after }] of Object.entries([
      {
        before: {
          resolvedLazyVar: {
            _pending: {},
            result: 'foo',
          },
        },
        after: {
          resolvedLazyVar: 'foo',
        },
      },
      {
        before: {
          foo: {
            bar: {
              _pending: {},
              result: {
                baz: 42,
              },
            },
          },
        },
        after: {
          foo: {
            bar: {
              baz: 42,
            },
          },
        },
      },
      {
        before: {
          resolvedLazyVar: {
            _pending: {},
            result: {
              nestedLazyVar: {
                _pending: {},
                result: 'foo',
              },
            },
          },
        },
        after: {
          resolvedLazyVar: {
            nestedLazyVar: 'foo',
          },
        },
      },
    ])) {
      it(`- example ${pos}: ${JSON.stringify(before)}`, async function () {
        expect(stripLazyVars(before)).to.eql(after);
      });
    }
  });
});
