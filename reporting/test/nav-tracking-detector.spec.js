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
import sinon from 'sinon';

import { createInMemoryPersistedHashes } from './helpers/in-memory-persisted-hashes.js';
import {
  createInMemoryJobScheduler,
  runClockUntilJobQueueIsEmpty,
} from './helpers/in-memory-job-scheduler.js';
import Sanitizer from '../src/sanitizer.js';

import NavTrackingDetector, {
  isAdUrlByCategory,
} from '../src/nav-tracking-detector.js';

// Each fixture has the following keys:
// - pageEvent
// - expectedMessage (either the message or "null" if not message is expected)
const FIXTURE = Object.freeze({
  'search-ad[category=go]': {
    pageEvent: {
      type: 'safe-search-landing',
      tabId: 1057538426,
      details: {
        from: {
          category: 'go',
          query: 'fußballschuhe',
        },
        to: {
          targetUrl:
            'https://www.11teamsports.com/de-de/p/adidas-mundial-team-tf-schwarz-weiss?variant=c999c38aff5443aaab04ab5db67ee4fb&gad_source=1&gclid=EAIaIQobChMIiNnU0uneiAMVCYlQBh1OeSBwEAQYASABEgJJBvD_BwE',
        },
        redirects: [
          {
            from: 'https://www.googleadservices.com/pagead/aclk?sa=L&ai=DChcSEwiI2dTS6d6IAxUJiVAGHU55IHAYABAXGgJkZw&co=1&ase=2&gclid=EAIaIQobChMIiNnU0uneiAMVCYlQBh1OeSBwEAQYASABEgJJBvD_BwE&ohost=www.google.com&cid=CAASJeRod3eTz1gnJZGUhe4KwEz1KcM_hBC91Y7-AI5sF08UDDsS240&sig=AOD64_0zo5L4DTe5LGxX19_3IcUvyyYtsg&ctype=5&q=&nis=7&ved=2ahUKEwiz-dDS6d6IAxVIQEEAHXFVD1UQ9aACKAB6BAgDEBk&adurl=',
            to: 'https://www.11teamsports.com/de-de/p/adidas-mundial-team-tf-schwarz-weiss?variant=c999c38aff5443aaab04ab5db67ee4fb&gad_source=1&gclid=EAIaIQobChMIiNnU0uneiAMVCYlQBh1OeSBwEAQYASABEgJJBvD_BwE',
            statusCode: 302,
          },
        ],
      },
    },
    expectedMessage: {
      action: 'wtm.nav-track-detect.search-ad',
      payload: {
        from: {
          search: {
            category: 'go',
            query: 'fußballschuhe',
          },
        },
        to: {
          hostname: 'www.11teamsports.com',
        },
        via: {
          redirects: ['www.googleadservices.com'],
        },
      },
    },
  },

  'no-search-ad[category=go]': {
    pageEvent: {
      type: 'safe-search-landing',
      tabId: 1057538425,
      details: {
        from: {
          category: 'go',
          query: 'wikipedia fußballschuhe',
        },
        to: {
          targetUrl: 'https://de.wikipedia.org/wiki/Fu%C3%9Fballschuh',
        },
        redirects: [],
      },
    },
    expectedMessage: null,
  },

  'search-ad[category=gh]': {
    pageEvent: {
      type: 'safe-search-landing',
      tabId: 874595766,
      details: {
        from: {
          category: 'gh',
          query: 'locher kaufen',
        },
        to: {
          targetUrl:
            'https://www.otto-office.com/de/Lochen/Locher/012301/s?ref=101248-3CeetGqmlMiX5M3u4kKPczLVUe1OiLReVcudQ7FuoddHEO&affmt=0&affmn=0&awc=14601_1731090236_bd3bd43b096ac2b995319e9ead7df1b5&utm_campaign=homepage&utm_content=textlink&utm_medium=affiliate&utm_source=101248&utm_term=0',
        },
        redirects: [
          {
            from: 'https://ghosterysearch.com/redirect?url=aHR0cHM6Ly90YXRyY2suY29tL2gvMEh1MzB2NHgwUENUP3VybD1odHRwcyUzQSUyRiUyRnd3dy5vdHRvLW9mZmljZS5jb20lMkZkZSUyRkxvY2hlbiUyRkxvY2hlciUyRjAxMjMwMSUyRnM=',
            to: 'https://tatrck.com/h/0Hu30v4x0PCT?url=https%3A%2F%2Fwww.otto-office.com%2Fde%2FLochen%2FLocher%2F012301%2Fs',
            statusCode: 302,
          },
          {
            from: 'https://tatrck.com/h/0Hu30v4x0PCT?url=https%3A%2F%2Fwww.otto-office.com%2Fde%2FLochen%2FLocher%2F012301%2Fs',
            to: 'https://www.awin1.com/cread.php?awinmid=14601&awinaffid=101248&clickref=3CeetGqmlMiX5M3u4kKPczLVUe1OiLReVcudQ7FuoddHEO&clickref3=mt132948_a103197_p233787_cDE&clickref2=https%3A%2F%2Fglowstery.com&p=https%3A%2F%2Fwww.otto-office.com%2Fde%2FLochen%2FLocher%2F012301%2Fs',
            statusCode: 301,
          },
          {
            from: 'https://www.awin1.com/cread.php?awinmid=14601&awinaffid=101248&clickref=3CeetGqmlMiX5M3u4kKPczLVUe1OiLReVcudQ7FuoddHEO&clickref3=mt132948_a103197_p233787_cDE&clickref2=https%3A%2F%2Fglowstery.com&p=https%3A%2F%2Fwww.otto-office.com%2Fde%2FLochen%2FLocher%2F012301%2Fs',
            to: 'https://www.otto-office.com/de/Lochen/Locher/012301/s?ref=101248-3CeetGqmlMiX5M3u4kKPczLVUe1OiLReVcudQ7FuoddHEO&affmt=0&affmn=0&awc=14601_1731090236_bd3bd43b096ac2b995319e9ead7df1b5&utm_campaign=homepage&utm_content=textlink&utm_medium=affiliate&utm_source=101248&utm_term=0',
            statusCode: 302,
          },
        ],
      },
    },
    expectedMessage: {
      action: 'wtm.nav-track-detect.search-ad',
      payload: {
        from: {
          search: {
            category: 'gh',
            query: 'locher kaufen',
          },
        },
        to: {
          hostname: 'www.otto-office.com',
        },
        via: {
          redirects: ['tatrck.com'],
        },
      },
    },
  },

  'no-search-ad[category=gh]': {
    pageEvent: {
      type: 'safe-search-landing',
      tabId: 1057538425,
      details: {
        from: {
          category: 'go',
          query: 'wikipedia fußballschuhe',
        },
        to: {
          targetUrl: 'https://de.wikipedia.org/wiki/Fu%C3%9Fballschuh',
        },
        redirects: [],
      },
    },
    expectedMessage: null,
  },
});

describe('#NavTrackingDetector', function () {
  let uut;
  let sanitizer;
  let persistedHashes;
  let quorumChecker;
  let jobScheduler;
  let clock;

  async function waitForSentMessages(event, { ignoreErrors = false } = {}) {
    const sentMessages = [];
    jobScheduler.addObserver(
      'jobRegistered',
      (job) => {
        if (job.type === 'send-message') {
          sentMessages.push(job.args);
        }
      },
      { ignoreAfterInitWarning: true },
    );

    // propagate error (TODO: maybe this should move into "runClockUntilJobQueueIsEmpty")
    let error = null;
    ['jobFailed', 'jobRejected', 'jobExpired'].forEach((unexpectedEvent) => {
      jobScheduler.addObserver(
        unexpectedEvent,
        (jobEntry, err) => {
          error ||= err;
          if (!error) {
            try {
              const jobEntry_ = JSON.stringify(jobEntry, null, 2);
              throw new Error(
                `Unexpected event: ${unexpectedEvent} when processing jobEntry: ${jobEntry_})`,
              );
            } catch (e) {
              error = e;
            }
          }
        },
        { ignoreAfterInitWarning: true },
      );
    });

    uut.onPageEvent(event);
    await runClockUntilJobQueueIsEmpty(jobScheduler, clock);
    if (error && !ignoreErrors) {
      throw error;
    }
    return [...sentMessages];
  }

  async function expectNoMessageFor(event) {
    expect(await waitForSentMessages(event)).eql([]);
  }

  async function expectedMessageSentFor(event, expectedMessage) {
    const newJobs = await waitForSentMessages(event);
    if (newJobs.length !== 1) {
      expect.fail(
        `Expected exactly one message sent, but got ${newJobs.length}}`,
      );
    }
    const { action, payload } = newJobs[0].body;
    expect(action).to.eql(expectedMessage.action);
    expect(payload).to.eql(expectedMessage.payload);
  }

  beforeEach(async function () {
    clock?.restore();
    clock = sinon.useFakeTimers(new Date('2020-01-17'));
    sanitizer = new Sanitizer({
      getSafeCountryCode() {
        return '--';
      },
    });
    persistedHashes = createInMemoryPersistedHashes();
    quorumChecker = {
      _stubbedResult: () => true, // always pass
      _incrementCalls: 0,
      _checkCalls: 0,

      _assumeQuorumNotReached() {
        this._stubbedResult = () => false;
      },

      async sendQuorumIncrement({ text, now = Date.now() }) {
        this._incrementCalls += 1;
        expect(text).to.be.a('string');
        expect(now).to.be.a('number');
      },
      async checkQuorumConsent({ text }) {
        this._checkCalls += 1;
        expect(text).to.be.a('string');
        return this._stubbedResult();
      },
    };
    jobScheduler = createInMemoryJobScheduler();

    uut = new NavTrackingDetector({
      sanitizer,
      persistedHashes,
      quorumChecker,
      jobScheduler,
    });
    await jobScheduler.init();
    await uut.init();
  });

  afterEach(function () {
    try {
      uut?.unload();
      jobScheduler?.unload();
    } finally {
      uut = null;
      jobScheduler = null;
      clock?.restore();
      clock = null;
    }
  });

  describe('should pass fixtures', function () {
    for (const [fixtureName, { pageEvent, expectedMessage }] of Object.entries(
      FIXTURE,
    )) {
      if (expectedMessage !== null) {
        it(`- '${fixtureName}' should trigger '${expectedMessage.action}'`, async function () {
          await expectedMessageSentFor(pageEvent, expectedMessage);
        });
      } else {
        it(`- '${fixtureName}' should not send a message`, async function () {
          await expectNoMessageFor(pageEvent);
        });
      }
    }
  });

  describe('[quorum checks]', function () {
    it('should send requests to the quorum server', async function () {
      expect(quorumChecker._checkCalls).to.eql(0);
      expect(quorumChecker._incrementCalls).to.eql(0);

      const { pageEvent, expectedMessage } = FIXTURE['search-ad[category=go]'];
      expect(expectedMessage).to.not.eql(null);
      await expectedMessageSentFor(pageEvent, expectedMessage);

      expect(quorumChecker._checkCalls).to.eql(1);
      expect(quorumChecker._incrementCalls).to.eql(1);
    });

    it('should not send a messages if quorum check does not reach quorum', async function () {
      quorumChecker._assumeQuorumNotReached();

      expect(quorumChecker._checkCalls).to.eql(0);
      expect(quorumChecker._incrementCalls).to.eql(0);

      const { pageEvent, expectedMessage } = FIXTURE['search-ad[category=go]'];
      expect(expectedMessage).to.not.eql(null); // would have been expected if quorum would succeed
      await expectNoMessageFor(pageEvent);

      expect(quorumChecker._checkCalls).to.eql(1);
      expect(quorumChecker._incrementCalls).to.eql(1);
    });
  });
});

describe('#isSearchAdRedirect', function () {
  describe('should detect search link tracking', function () {
    for (const [category, { yes = [], no = [] }] of Object.entries({
      go: {
        yes: [
          'https://www.google.com/aclk?sa=l&ai=DChcSEwj2m738wsOJAxW0lFAGHYKCH8IYABAkGgJkZw&co=1&ase=2&gclid=EAIaIQobChMI9pu9_MLDiQMVtJRQBh2Cgh_CEAQYASACEgJkmvD_BwE&sig=AOD64_21AcL94TIS1Jgl-CZf267zMbDR4g&nis=4&ved=2ahUKEwiR0rj8wsOJAxX3UEEAHULLDE4QhrUFegQIBRAT&adurl=',
          'https://www.google.com/aclk?sa=l&ai=DChcSEwj2m738wsOJAxW0lFAGHYKCH8IYABBDGgJkZw&co=1&ase=2&gclid=EAIaIQobChMI9pu9_MLDiQMVtJRQBh2Cgh_CEAQYAiACEgKSPPD_BwE&sig=AOD64_3KrEvIbAeoFGLWRFeQ2QP337MDUg&nis=4&ved=2ahUKEwiR0rj8wsOJAxX3UEEAHULLDE4QhrUFegQIBRAX&adurl=',
          'https://www.googleadservices.com/pagead/aclk?sa=L&ai=DChcSEwj2m738wsOJAxW0lFAGHYKCH8IYABBVGgJkZw&co=1&ase=2&gclid=EAIaIQobChMI9pu9_MLDiQMVtJRQBh2Cgh_CEAAYAyAAEgIchPD_BwE&ohost=www.google.com&cid=CAASJORoZY0ay_7C6H0SgKIAOURY4CZRE84sTMibiePvUV7Gac-nDg&sig=AOD64_3bsT263Vf_CbmNCqexUQ6KgmFvJA&q&nis=4&adurl&ved=2ahUKEwiR0rj8wsOJAxX3UEEAHULLDE4Q0Qx6BAgPEAE',
          'https://www.googleadservices.com/pagead/aclk?sa=L&ai=DChcSEwiS-8qsw8OJAxXSklAGHaLEACoYABACGgJkZw&co=1&ase=2&gclid=EAIaIQobChMIkvvKrMPDiQMV0pJQBh2ixAAqEAAYASAAEgI9YvD_BwE&ohost=www.google.com&cid=CAASJORo1vorI9ebjH5Z1uZt74ZAher6Ha6iKMYa_Z44OISa9c85dw&sig=AOD64_3nxtwp1lkGRI5SZ59Kg-2nHrizdA&q&nis=4&adurl&ved=2ahUKEwi9u8asw8OJAxViVkEAHU0xA84Q0Qx6BAgLEAM',
          'https://www.googleadservices.com/pagead/aclk?sa=L&ai=DChcSEwiS-8qsw8OJAxXSklAGHaLEACoYABAAGgJkZw&co=1&ase=2&gclid=EAIaIQobChMIkvvKrMPDiQMV0pJQBh2ixAAqEAAYAiAAEgIk_PD_BwE&ohost=www.google.com&cid=CAASJORo1vorI9ebjH5Z1uZt74ZAher6Ha6iKMYa_Z44OISa9c85dw&sig=AOD64_0J-z2g1SJPJXm-_NdX2q6Yx4CB_A&q&nis=4&adurl&ved=2ahUKEwi9u8asw8OJAxViVkEAHU0xA84Q0Qx6BAgJEAE',
          'https://www.googleadservices.com/pagead/aclk?sa=L&ai=DChcSEwiS-8qsw8OJAxXSklAGHaLEACoYABADGgJkZw&co=1&ase=2&gclid=EAIaIQobChMIkvvKrMPDiQMV0pJQBh2ixAAqEAMYASAAEgJ4RPD_BwE&ohost=www.google.com&cid=CAASJORo1vorI9ebjH5Z1uZt74ZAher6Ha6iKMYa_Z44OISa9c85dw&sig=AOD64_1lcUpQUKNIeao5tNiufzmBDGnfzg&q&nis=4&adurl&ved=2ahUKEwi9u8asw8OJAxViVkEAHU0xA84Q0Qx6BAg2EAE',
        ],
        no: [
          'https://www.booking.com/city/de/berlin.de.html',
          'https://www.google.com/search?sca_esv=94226fca456b230b&q=Berlin+Hotel+Alexanderplatz&sa=X&ved=2ahUKEwiR0rj8wsOJAxX3UEEAHULLDE4Q1QJ6BAhHEAE',
          'https://www.testit.de/product/W0S2jmFKXC4XA0itMCaf.html',
        ],
      },
      bi: {
        yes: [
          'https://www.bing.com/aclk?ld=e8OY84xZpD6kOSvg7eLFdhATVUCUztOqpy9dIgFdfuMnV7k4iDEskxtI-tPpkdfqWCM58EtOXs-p6SpTsNLdB1uRdiN8wKDQHkFC1l98EMw8tTTD4oPxPMGaIEAh_t1N3Vk5bKjUInvE3SlcX53n5Y05QwyMMHJhdBBIJ4YGYKuwUSVOQNeH5f1-RUOGu1xoCw70wJxw&u=aHR0cHMlM2ElMmYlMmZoYW5keXZlcnRyYWcuY2hlY2syNC5kZSUyZnBsYWRzJTJmaXBob25lLTE2LW1pdC12ZXJ0cmFnJTNmaHdwcm9wX2NvbG9yX2dyb3VwJTNkcm9zZSUyNmh3cHJvcF9tZW1vcnlzaXplJTNkMTI4Z2IlMjZ3aXRoX2hpZ2hfYWNjZXB0YW5jZV9yYXRlJTNkYWxsJTI2d3BzZXQlM2RiaW5nX21mX2J1X3BsYSUyNm1zY2xraWQlM2RjYjM2NTMyYjg3ZTUxYzI0NWQ5ZDM0MDJhYjY5NzMwNyUyNnV0bV9zb3VyY2UlM2RiaW5nJTI2dXRtX21lZGl1bSUzZGNwYyUyNnV0bV9jYW1wYWlnbiUzZENIRUNLMjQlMjUyMC0lMjUyME1GJTI1MjAtJTI1MjBCdW5kbGUlMjUyMC0lMjUyMEhhbmR5JTI1MjBvaG5lJTI1MjBWZXJ0cmFnJTI1MjAtJTI1MjBQTEElMjUyMC0lMjUyMENTUyUyNnV0bV90ZXJtJTNkNDU3NjcxNzE4MDQ2NzEwMSUyNnV0bV9jb250ZW50JTNkTUYlMjUyMC0lMjUyMEJ1bmRsZSUyNTIwLSUyNTIwSGFuZHklMjUyMC0lMjUyMGlQaG9uZSUyNTIwMTYlMjUyMG9obmUlMjUyMFZlcnRyYWclMjUyMC0lMjUyMFBMQSUyNTIwLSUyNTIwQ1NT&rlid=cb36532b87e51c245d9d3402ab697307',
          'https://www.bing.com/aclk?ld=e8n-i7-q0hzuJG1Ohj8g-ksTVUCUxQ7CAjYrrtKyUojObGlmZIlB1Hkb5-ULH-Zbmy9NNSwqhkdl5iGrqN3SqB2qe152BfCG3NgVgKJJ7gWX_gFH6P30Cx87GYWG4V45T04ezfqIV8a7HgJOq4aGzm0YS9WWyYDVmNWRxBoj7WLMHW3vn_EC6yPZiMSbB6v3FE9tRf5A&u=aHR0cHMlM2ElMmYlMmZoYW5keXZlcnRyYWcuY2hlY2syNC5kZSUyZnBsYWRzJTJmaXBob25lLTE1LW1pdC12ZXJ0cmFnJTNmaHdwcm9wX2NvbG9yX2dyb3VwJTNkYmxhY2slMjZod3Byb3BfbWVtb3J5c2l6ZSUzZDEyOGdiJTI2d2l0aF9oaWdoX2FjY2VwdGFuY2VfcmF0ZSUzZGFsbCUyNndwc2V0JTNkYmluZ19tZl9idV9wbGElMjZtc2Nsa2lkJTNkNWY4YTYxY2QzZWZiMTc3MWM1YTcwNmU0MTI3NzhlZjElMjZ1dG1fc291cmNlJTNkYmluZyUyNnV0bV9tZWRpdW0lM2RjcGMlMjZ1dG1fY2FtcGFpZ24lM2RDSEVDSzI0JTI1MjAtJTI1MjBNRiUyNTIwLSUyNTIwQnVuZGxlJTI1MjAtJTI1MjBIYW5keSUyNTIwb2huZSUyNTIwVmVydHJhZyUyNTIwLSUyNTIwUExBJTI1MjAtJTI1MjBDU1MlMjZ1dG1fdGVybSUzZDQ1NzU5NjEyNjIxMTMwMTMlMjZ1dG1fY29udGVudCUzZE1GJTI1MjAtJTI1MjBCdW5kbGUlMjUyMC0lMjUyMEhhbmR5JTI1MjAtJTI1MjBpUGhvbmUlMjUyMDE1JTI1MjBvaG5lJTI1MjBWZXJ0cmFnJTI1MjAtJTI1MjBQTEElMjUyMC0lMjUyMENTUw&rlid=5f8a61cd3efb1771c5a706e412778ef1',
          'https://www.bing.com/aclk?ld=e8GFwHtHBInOB8Kzbgmx1h4jVUCUwsjtcxo8GEWsevKfQpyXvGu74z4QcbMx9KiGy2peog1bcsUW4VX5ONkVMSFXksJVz-G7JHNSMjEI4la_ZYkHuHB7V75shZEdghjbENfa8QFT_5DcJ0fsz1ktT-74izbN0Sz7PsM_AFNgGBEIO7h2rOnf7QhtxIBrzKBG99HO7_cw&u=aHR0cHMlM2ElMmYlMmZ3d3cuYXBwbGUuY29tJTJmZGUlMmZzaG9wJTJmZ28lMmZpcGhvbmUlMmYlM2YlMjZtdGlkJTNkMjA5MjVxYnkzOTk1MiUyNmFvc2lkJTNkcDIzOCUyNm1uaWQlM2Rza244M3ZBdkEtZGNfbXRpZF8yMDkyNXFieTM5OTUyX3BjcmlkXzc2ODk3Mjk0ODM1MDQ5X3BncmlkXzEyMzAzNTQ1ODMxNTk2MjFfcGV4aWRfX3B0aWRfa3dkLTc2ODk3NTAyNjkyMjMwJTNhbG9jLTcyXyUyNmNpZCUzZHd3YS1kZS1rd2JpLWlwaG9uZS1zbGlkLS1pcHVybC1wcm9kdWN0aWQtLS1Db3JlUGhyYXNlLS0&rlid=828a387ad72e177b3c3f5f53fba26cf0',
          'https://www.bing.com/aclk?ld=e8CkZNOCdYX7ao_OnhfT5E0zVUCUzh9wnw_R6GfVu4y5aIcCtHIoWMrZeKDY83VXagT_fmPewg--1lZfvdaG11htSCz4-vHZHYlVXKv2Q44bcMG-h8IeptqoDLkeAHhYg9hINA4a_fo93gbPuzP9_zBNKJF6OBVhNxxqkYFGa97cEuCdNssMZFEnzFdPI3JQP93J9wig&u=aHR0cHMlM2ElMmYlMmZjbGlja3NlcnZlLmRhcnRzZWFyY2gubmV0JTJmbGluayUyZmNsaWNrJTNmbGlkJTNkNDM3MDAwNjM2MzE4NzMwNTElMjZkc19zX2t3Z2lkJTNkNTg3MDAwMDcwMTg0NDM5NzQlMjZkc19hX2NpZCUzZDIxMTE2MTUzNSUyNmRzX2FfY2FpZCUzZDU3ODQwMjg4NSUyNmRzX2FfYWdpZCUzZDExNDIzOTM1NjQyOTg0NjklMjZkc19hX2ZpaWQlM2QlMjZkc19hX2xpZCUzZGt3ZC03MTQwMDI4NTkyMzIzMSUzYWxvYy0xNDA1JTI2ZHNfYV9leHRpZCUzZCU3YmV4dGVuc2lvbmlkJTdkJTI2JTI2ZHNfZV9hZGlkJTNkJTI2ZHNfZV9tYXRjaHR5cGUlM2RzZWFyY2glMjZkc19lX2RldmljZSUzZGMlMjZkc19lX25ldHdvcmslM2RvJTI2JTI2ZHNfdXJsX3YlM2QyJTI2ZHNfZGVzdF91cmwlM2RodHRwcyUzYSUyZiUyZnd3dy5yZWZ1cmJlZC5kZSUyZmMlMmZpcGhvbmVzJTJmJTNmY28lM2RkZSUyNnV0bV9jbHVzdGVyJTNkcHJvZHVrdCUyNnV0bV9ncm91cCUzZGlwaG9uZSUyNmNxX3BsYWMlM2QlMjZjcV9uZXQlM2RvJTI2Y3FfcG9zJTNkJTI2Y3FfbWVkJTNkJTI2Y3FfcGx0JTNkZ3AlMjZtc2Nsa2lkJTNkY2YxZWQwMzA0MmRjMWUwMTY2MDZiNzE5NmU1MDhlYzIlMjZ1dG1fc291cmNlJTNkYmluZyUyNnV0bV9tZWRpdW0lM2RjcGMlMjZ1dG1fY2FtcGFpZ24lM2RERSUyNTIwLSUyNTIwU2VhcmNoJTI1MjAtJTI1MjBTbWFydHBob25lcyUyNTIwLSUyNTIwaVBob25lJTI1MjAtJTI1MjBHZW5lcmljJTI1MjAlMjU3QyUyNTIwMDFzJTI1MjAtJTI1MjBBcHBsZSUyNnV0bV90ZXJtJTNkaXBob25lJTI1MjBzJTI2dXRtX2NvbnRlbnQlM2RpUGhvbmUlMjUyMEFsbGdlbWVpbg&rlid=cf1ed03042dc1e016606b7196e508ec2',
          'https://www.bing.com/aclk?ld=e87D5_2HaYWZDinY23fttutjVUCUw2m_ixBtbYu-dDzbXUeOiTb1_j-5xTU2ONulA4Tct_ffn1-fH4GSbbG73wTVdM-Q3rhpY5ddmEEp0DwG2RP1BefoJX4kYY-fuKVQ6XjynLXHnIlbS6i5S-0FhB-wfNkzGnGYHG0ctMKhoZWGQ3NMt7n2-fKm7Pl-I4-Z4wcDNh5A&u=aHR0cHMlM2ElMmYlMmZ3d3cubWVkaWFtYXJrdC5kZSUyZmRlJTJmcHJvZHVjdCUyZl9hcHBsZS1pcGhvbmUtMTMtMTI4LWdiLW1pdHRlcm5hY2h0LWR1YWwtc2ltLTI3NjQ0ODEuaHRtbCUzZmdjbGlkJTNkNmIzYjdhYWNjNDVlMTA2NGVhODcxZDg1ZThkMjU1NDglMjZnY2xzcmMlM2QzcC5kcyUyNm1zY2xraWQlM2Q2YjNiN2FhY2M0NWUxMDY0ZWE4NzFkODVlOGQyNTU0OCUyNnV0bV9zb3VyY2UlM2RiaW5nJTI2dXRtX21lZGl1bSUzZGNwYyUyNnV0bV9jYW1wYWlnbiUzZFJUX3Nob3BwaW5nX25hX25zcF9uYV9QTEElMjUyMC0lMjUyME1BZHMlMjUyMC0lMjUyMDMlMjZ1dG1fdGVybSUzZDQ1NzU4MjM4MDg5NTgxNDclMjZ1dG1fY29udGVudCUzZFBMQSUyNTIwLSUyNTIwTUFkYXMlMjUyMC0lMjUyMDM&rlid=6b3b7aacc45e1064ea871d85e8d25548',
          'https://www.bing.com/aclk?ld=e878OuzAQIpibusPWFLA7iWjVUCUw6S8gIodPScyDYc8gWV5sTn6QQmkek33CEzn15RcJM3o-AO9tXyFLTL5tcXSh-CUpTPMTlox8PO9MisX9vdzU4gNXQBK-Ymudx9SHgD4GSW1u1W5E_iiLykexTSf5ACz71Vdh7T8NnyUfiSaZSxE2K9f4_w7jGjuZemFLSe92foQ&u=aHR0cHMlM2ElMmYlMmZ3d3cuYmFja21hcmtldC5kZSUyZmRlLWRlJTJmbCUyZmlwaG9uZS0xMy1wcm8lMmY3NjRhNmRlNC1hMmE4LTQ0NzEtOWIwNS04ZjgyODU0N2MwYmMlM2ZnY2xpZCUzZCUyNm1zY2xraWQlM2QwNDIyMmNmOWY5ZTUxOWEzOWI4MzRiZDBkNTY5MTVkYSUyNnV0bV9zb3VyY2UlM2RiaW5nJTI2dXRtX21lZGl1bSUzZGNwYyUyNnV0bV9jYW1wYWlnbiUzZERFX1NBX1NFQVJDSF9NX0dFTl9pUGhvbmVfaVBob25lJTI1MjAxMyUyNTIwUHJvXyUyNTdCQXJjYW5lJTI1N0QlMjZ1dG1fdGVybSUzZGlwaG9uZSUyNTIwa2F1ZmVuJTI2dXRtX2NvbnRlbnQlM2RTYWxlcw&rlid=04222cf9f9e519a39b834bd0d56915da',
          'https://www.bing.com/aclk?ld=e8hsaezE_R5KumjW_5ZhxUQDVUCUzuzcMkSJjTYg_Jr1x1sF0aHNbrPg2GGZmNFgoFZqEIRklbfZ7Gr21LMH8wYDw_YEm0Fh-XsZE5om-L6RxHFfG7Rpbnb4AoGUGA1GKvd1eGzmAIqrsoLmmqo7yikvpx5WSo3fPJmbIxLbM180Dzn6rZQVLR9hK7b3up1oaHY73v9w&u=aHR0cCUzYSUyZiUyZnd3dy5ib29raW5nLmNvbSUyZmNpdHklMmZkZSUyZmJlcmxpbi5kZS5odG1sJTNmYWlkJTNkMzQ5MDE0JTI2cGFnZW5hbWUlM2RiZXJsaW4lMjZsYWJlbCUzZG1zbi0yZjRkZkU2Y1NTWWl4QzZibXZodTVRLTgwNzQ1NTY5MjEzOTM3JTNhdGlrd2QtODA3NDU3MDA3MDc0NDUlM2Fsb2MtNzIlM2FuZW8lM2FtdGUlM2FscDEyNzY4MiUzYWRlYyUzYXFzYmVybGluJTI1MjBob3RlbCUyNnV0bV9jYW1wYWlnbiUzZEdlcm1hbnklMjZ1dG1fbWVkaXVtJTNkY3BjJTI2dXRtX3NvdXJjZSUzZGJpbmclMjZ1dG1fdGVybSUzZDJmNGRmRTZjU1NZaXhDNmJtdmh1NVElMjZtc2Nsa2lkJTNkN2ZiMTk0YzJlNjgzMTg2ZWZkY2RmM2ViYzg3YzY4Y2UlMjZ1dG1fY29udGVudCUzZEJlcmxpbiUyNTIwLSUyNTIwVUZJJTI1M0EtMTc0NjQ0Mw&rlid=7fb194c2e683186efdcdf3ebc87c68ce',
        ],
        no: [
          'https://www.apple.com/de/iphone/',
          'https://www.bing.com/shop?q=buy%20iphone&FORM=MOPT01&cvid=36AD3BAC8B164BABB927DB4799689F2C&originIGUID=CE6BDACAF30D40B09533211E1DF417A0',
        ],
      },
      dd: {
        yes: [
          'https://www.bing.com/aclick?ld=e8cxznk7xzH4nq_PHSE33VbTVUCUwa1llKS85TH6ypcC5fqFBOa9TTQUSxJQZArhvLHlI4mxDm7MMWISP5BpEXaIDTpt1DTQ7Ifor02_cJCgci8PhVa8OTugOBd1iiniQp26ZeCiqCt4nJLVEbQMXWxTVg7b_3U1VatGqp-0L7OFpsjVuTyN-YI0iZ3OPOlMcVESy7nA&u=aHR0cHMlM2ElMmYlMmZ3d3cuYXBwbGUuY29tJTJmZGUlMmZzaG9wJTJmZ28lMmZpcGhvbmUlMmYlM2YlMjZtdGlkJTNkMjA5MjVxYnkzOTk1MiUyNmFvc2lkJTNkcDIzOCUyNm1uaWQlM2Rza244M3ZBdkEtZGNfbXRpZF8yMDkyNXFieTM5OTUyX3BjcmlkXzc2ODk3Mjk0ODM1MDQ5X3BncmlkXzEyMzAzNTQ1ODMxNTk2MjFfcGV4aWRfX3B0aWRfa3dkLTc2ODk3NTAyNjkyMjMwJTNhbG9jLTcyXyUyNmNpZCUzZHd3YS1kZS1rd2JpLWlwaG9uZS1zbGlkLS1pcHVybC1wcm9kdWN0aWQtLS1Db3JlUGhyYXNlLS0&rlid=7a68ed672ebb1159dab98a4e357228fe',
          'https://duckduckgo.com/y.js?ad_domain=check24.de&ad_provider=bingv7aa&ad_type=txad&click_metadata=w9rmfkFqngsgicZcEg2VdaGptUjhZCwPDOrk2e%2DaQ4ljiqbEcWXhekLrlsgEQ6CtyKkqHGoxekOmwAtk9_f887HPqMLkHt%2D9GyV6bNJE7nj47Qo3GSHLJgArmYP1q5KC.jCCNIbCxckL_f%2DV3qw4X1A&eddgt=Ld5Zg2f8H7KM2YLQyytHwQ%3D%3D&rut=1171226946b1b3015a5be3b8ad1860db453cf6fb1b007353c1cdecdaf09d2ad4&u3=https%3A%2F%2Fwww.bing.com%2Faclick%3Fld%3De8%2DYy1lQpa2lB2UWhdL%2DB9iTVUCUw8nW_E7by2mtrQRY4vhg6DERPbcBlG5mUgPIrt5z_zzPYU9bMWVSfbhxUoQKSTSyQG_aWPl8YjJ%2DmAEpjkgn2by_FnBXxDSCD%2DMnLhmaHE40LK3fER2adm5O1ygEWV5VsenzmzKxD_yuoXqu_yGW8i8uFuSkEqnjbfSEwbA1s1jQ%26u%3DaHR0cHMlM2ElMmYlMmZob3RlbC5jaGVjazI0LmRlJTJmdWwlMmZscCUyZkJlcmxpbiUyZjQwNzg0JTNmaGQlM2RIb3RlbCUyNTIwQmVybGluJTI2d3BzZXQlM2RiaW5nX2hvdGVsX2NpdHklMjZ0aWQlM2RERSUyNnV0bV9zb3VyY2UlM2RiaW5nJTI2dXRtX21lZGl1bSUzZGNwYyUyNnV0bV90ZXJtJTNkSG90ZWwlMjUyMEJlcmxpbiUyNnV0bV9jYW1wYWlnbiUzZENIMjQtRGV1dHNjaGxhbmQtQmVybGluLUNpdGllcy1TRSUyNm1zY2FtaWQlM2Q0NDYyODU5NzIlMjZrd20lM2RlJTI2bXNjbGtpZCUzZDdhOWU0YjRkNTY0ZTE3ZDBmOWZkMmM2NDY2Nzk3YzUz%26rlid%3D7a9e4b4d564e17d0f9fd2c6466797c53&vqd=4-282749728420918683889133549781490211136&iurl=%7B1%7DIG%3D9C05E48C3820488F80D19C71C5DAB2AF%26CID%3D0EF82E8CC0AB638A2A5E3BA1C1A362A4%26ID%3DDevEx%2C5051.1',
          'https://www.bing.com/aclick?ld=e8-Yy1lQpa2lB2UWhdL-B9iTVUCUw8nW_E7by2mtrQRY4vhg6DERPbcBlG5mUgPIrt5z_zzPYU9bMWVSfbhxUoQKSTSyQG_aWPl8YjJ-mAEpjkgn2by_FnBXxDSCD-MnLhmaHE40LK3fER2adm5O1ygEWV5VsenzmzKxD_yuoXqu_yGW8i8uFuSkEqnjbfSEwbA1s1jQ&u=aHR0cHMlM2ElMmYlMmZob3RlbC5jaGVjazI0LmRlJTJmdWwlMmZscCUyZkJlcmxpbiUyZjQwNzg0JTNmaGQlM2RIb3RlbCUyNTIwQmVybGluJTI2d3BzZXQlM2RiaW5nX2hvdGVsX2NpdHklMjZ0aWQlM2RERSUyNnV0bV9zb3VyY2UlM2RiaW5nJTI2dXRtX21lZGl1bSUzZGNwYyUyNnV0bV90ZXJtJTNkSG90ZWwlMjUyMEJlcmxpbiUyNnV0bV9jYW1wYWlnbiUzZENIMjQtRGV1dHNjaGxhbmQtQmVybGluLUNpdGllcy1TRSUyNm1zY2FtaWQlM2Q0NDYyODU5NzIlMjZrd20lM2RlJTI2bXNjbGtpZCUzZDdhOWU0YjRkNTY0ZTE3ZDBmOWZkMmM2NDY2Nzk3YzUz&rlid=7a9e4b4d564e17d0f9fd2c6466797c53',
          'https://duckduckgo.com/y.js?ad_domain=telekom.de&ad_provider=bingv7aa&ad_type=txad&click_metadata=%2DTlIWUhkkz02IEvXLx5JUTzrEpbzT84uP5%2Da0Q%2DQ5l57lgIhaOtOvAwXWS79Q0UVZD9JJiO%2D4rfQ5ca7%2DxiIXwdYvaN3gd48M7Wqa6w7oGKOTxVtrFbwkfKFyJZemd1T.AFd3AdAhwGeBqBhDAcAlzA&eddgt=dnFnzFR5zFmTItv_EuBIHg%3D%3D&rut=aac65dbcc2e7c898caea7912b3dca0ec680e8029dcb932bd35082562734c59ea&u3=https%3A%2F%2Fwww.bing.com%2Faclick%3Fld%3De8UM0mKoV4Hxv63ynwn6GRmTVUCUzuAnoDjWQD85Ofbf4S5QE8k7UwmkfyAWq%2DpbvNqMkxHG943Ud4tuyDPgtIouHGyyurIp5ybPIv5ZO3BpvBWQezaDsvVIPVMqnUWajfn_FAWxt6Z5FfV2zR5YUXrfjowhzcdM6E2O_u3Y8wm6KybFIWNuPo6a2kDz8Hx3eGb%2D1Fjw%26u%3DaHR0cHMlM2ElMmYlMmZhZC5kb3VibGVjbGljay5uZXQlMmZzZWFyY2hhZHMlMmZsaW5rJTJmY2xpY2slM2ZsaWQlM2Q0MzcwMDA4MDQ2MzY3NTAyOCUyNmRzX3Nfa3dnaWQlM2Q1ODcwMDAwODc0NDg2NDcxNyUyNmRzX2FfY2lkJTNkMTIyNDU4MTcyMSUyNmRzX2FfY2FpZCUzZDIxNDYxMjMwMDMzJTI2ZHNfYV9hZ2lkJTNkMTU5NzA0MzE2MzcwJTI2ZHNfYV9saWQlM2Rrd2QtMzA2MjU0MzUwNSUyNiUyNmRzX2VfYWRpZCUzZDcyNDk5NTA5NjEzNjYzJTI2ZHNfZV90YXJnZXRfaWQlM2Rrd2QtNzI0OTk4ODk5ODUxNjclM2Fsb2MtNzIlMjYlMjZkc19lX25ldHdvcmslM2RvJTI2ZHNfdXJsX3YlM2QyJTI2ZHNfZGVzdF91cmwlM2RodHRwcyUzYSUyZiUyZnd3dy50ZWxla29tLmRlJTJmc2hvcCUyZmdlcmFldGUlMmZzbWFydHBob25lcyUzZnZvJTNkWTAxMDklMjZ3dF9tYyUzZHNrX21mbW1wb2VrXzRfbWYtaHdfNDQ2NTgyMjcyXzExNTk5ODY2NTUwMTcwOTNfXyUyNnd0X2NjNyUzZGVfc21hcnRwaG9uZSUyNTIwa2F1ZmVuJTI2Z2NsaWQlM2Q5MGVjNzM1YjA2YmQxMTRiMWQ5NjE0NzIzNjNhYTcyNiUyNmdjbHNyYyUzZDNwLmRzJTI2JTI2bXNjbGtpZCUzZDkwZWM3MzViMDZiZDExNGIxZDk2MTQ3MjM2M2FhNzI2%26rlid%3D90ec735b06bd114b1d961472363aa726&vqd=4-152734660217840725103173065042354220136&iurl=%7B1%7DIG%3DEF19CA42852A4304B0F3635181EB3E05%26CID%3D126E2F2562B96FF53B693A08631A6E9F%26ID%3DDevEx%2C5053.1',
          'https://www.bing.com/aclick?ld=e8UM0mKoV4Hxv63ynwn6GRmTVUCUzuAnoDjWQD85Ofbf4S5QE8k7UwmkfyAWq-pbvNqMkxHG943Ud4tuyDPgtIouHGyyurIp5ybPIv5ZO3BpvBWQezaDsvVIPVMqnUWajfn_FAWxt6Z5FfV2zR5YUXrfjowhzcdM6E2O_u3Y8wm6KybFIWNuPo6a2kDz8Hx3eGb-1Fjw&u=aHR0cHMlM2ElMmYlMmZhZC5kb3VibGVjbGljay5uZXQlMmZzZWFyY2hhZHMlMmZsaW5rJTJmY2xpY2slM2ZsaWQlM2Q0MzcwMDA4MDQ2MzY3NTAyOCUyNmRzX3Nfa3dnaWQlM2Q1ODcwMDAwODc0NDg2NDcxNyUyNmRzX2FfY2lkJTNkMTIyNDU4MTcyMSUyNmRzX2FfY2FpZCUzZDIxNDYxMjMwMDMzJTI2ZHNfYV9hZ2lkJTNkMTU5NzA0MzE2MzcwJTI2ZHNfYV9saWQlM2Rrd2QtMzA2MjU0MzUwNSUyNiUyNmRzX2VfYWRpZCUzZDcyNDk5NTA5NjEzNjYzJTI2ZHNfZV90YXJnZXRfaWQlM2Rrd2QtNzI0OTk4ODk5ODUxNjclM2Fsb2MtNzIlMjYlMjZkc19lX25ldHdvcmslM2RvJTI2ZHNfdXJsX3YlM2QyJTI2ZHNfZGVzdF91cmwlM2RodHRwcyUzYSUyZiUyZnd3dy50ZWxla29tLmRlJTJmc2hvcCUyZmdlcmFldGUlMmZzbWFydHBob25lcyUzZnZvJTNkWTAxMDklMjZ3dF9tYyUzZHNrX21mbW1wb2VrXzRfbWYtaHdfNDQ2NTgyMjcyXzExNTk5ODY2NTUwMTcwOTNfXyUyNnd0X2NjNyUzZGVfc21hcnRwaG9uZSUyNTIwa2F1ZmVuJTI2Z2NsaWQlM2Q5MGVjNzM1YjA2YmQxMTRiMWQ5NjE0NzIzNjNhYTcyNiUyNmdjbHNyYyUzZDNwLmRzJTI2JTI2bXNjbGtpZCUzZDkwZWM3MzViMDZiZDExNGIxZDk2MTQ3MjM2M2FhNzI2&rlid=90ec735b06bd114b1d961472363aa726',
        ],
        no: ['https://www.apple.com/iphone/'],
      },
      gh: {
        yes: [
          'https://tatrck.com/h/0Hu30v4x15uh?url=https%3A%2F%2Fwww.apple.com%2Fshop%2Fbuy-iphone',
          'https://tatrck.com/h/0Hu30v4x0XGM?url=https%3A%2F%2Fwww.t-mobile.com%2Fcell-phones%2Fbrand%2Fapple',
          'https://tatrck.com/h/0Hu30v4x0XN-?url=https%3A%2F%2Fwww.walmart.com%2Fbrowse%2Fcell-phones%2Fapple-iphone%2F1105910_7551331_1127173',
          'https://tatrck.com/h/0Hu30v4x0PcM?url=https%3A%2F%2Fwww.jeans-direct.de%2F',
        ],
        no: ['https://www.verizon.com/smartphones/apple/'],
      },
      br: {
        yes: [
          'https://search.brave.com/a/redirect?click_url=https%3A%2F%2Fmed.etoro.com%2FB12087_A123286_TClick.aspx&placement_id=2ccc92c1-8754-4c13-b12b-848609f6fd82&creative_instance_id=be901fd9-1fd5-48c2-836c-31c6131dfb06&timestamp=1730753751&nonce=19e3d50406272bd2437dbc46bf75fcf7&sig=17ce37368704faf13a895d418904d77a8ab6ee1e1b8f3efbff82df09a24fc0ff',
          'https://search.brave.com/a/redirect?click_url=https%3A%2F%2Fmed.etoro.com%2FB12087_A123286_TClick.aspx&placement_id=117ccd1d-1c9b-4022-947c-0e8f6c9dc750&creative_instance_id=31ecbb6f-f5ef-4496-863f-fc5e5c1a2fc5&timestamp=1730753915&nonce=ee6347a8bdd79704f162a3983afa89ce&sig=6a2e5412030f006447926d5e02c6c8eb634ab37744553bef418fd31b7bf6f636',
        ],
        no: ['https://bitcoin.org/en/buy', 'https://www.moonpay.com/'],
      },
      ec: {
        yes: [
          'https://syndicatedsearch.goog/aclk?sa=L&ai=DChcSEwjzgOHdxMOJAxXaTkECHXolGLUYABAAGgJ3cw&co=1&ase=2&gclid=EAIaIQobChMI84Dh3cTDiQMV2k5BAh16JRi1EAAYASAAEgIEo_D_BwE&sig=AOD64_1GAEeCOtMgw_F3LetLdogU2CxNxA&adurl=https://www.backmarket.de/de-de/l/iphone/aabc736a-cb66-4ac0-a3b7-0f449781ed39%3Futm_source%3Dgoogle%26utm_medium%3Dcpc%26utm_campaign%3DDE_SA_SHOP_G_GEN_iPhone_PMAX_3P_CSS_TOP_PERFORMERS%26gclid%3D%7Bgclid%7D%26gad_source%3D5&q=&nb=0&rurl=https%3A%2F%2Fwww.ecosia.org%2F%3Fc%3Dde%26&nm=62&is=660x440&nx=85&ny=5',
          'https://syndicatedsearch.goog/aclk?sa=L&ai=DChcSEwjzgOHdxMOJAxXaTkECHXolGLUYABACGgJ3cw&co=1&ase=2&gclid=EAIaIQobChMI84Dh3cTDiQMV2k5BAh16JRi1EAAYAiAAEgI0E_D_BwE&sig=AOD64_1nrmFrlH7AY0Tjcha4ZZxp_QhyMA&adurl=https://ad.doubleclick.net/searchads/link/click%3Flid%3D43700080795867497%26ds_s_kwgid%3D58700008770086173%26ds_a_cid%3D6631551089%26ds_a_caid%3D21704456329%26ds_a_agid%3D173071121008%26ds_a_fiid%3D%26ds_a_lid%3Dkwd-8318307100%26ds_a_extid%3D%26%26ds_e_adid%3D714181358794%26ds_e_matchtype%3Dsearch%26ds_e_device%3Dc%26ds_e_network%3Ds%26%26ds_url_v%3D2%26ds_dest_url%3Dhttps://www.conrad.de/de/f/apple-iphones-2777554.html%253Fgclsrc%253Daw.ds%2526%2526utm_source%253Dgoogle%2526gad_source%253D5%26utm_medium%3Dcpc%26utm_campaign%3DDE%2520-%2520Search%2520-%2520Non%2520Brand%2520-%2520Multimedia%2520-%2520Makes%26utm_id%3D21704456329&q=&nb=0&rurl=https%3A%2F%2Fwww.ecosia.org%2F%3Fc%3Dde%26&nm=89&nx=97&ny=13&is=660x440',
          'https://syndicatedsearch.goog/aclk?sa=L&ai=DChcSEwjzgOHdxMOJAxXaTkECHXolGLUYABABGgJ3cw&co=1&ase=2&gclid=EAIaIQobChMI84Dh3cTDiQMV2k5BAh16JRi1EAEYASAAEgIjwfD_BwE&num=3&sig=AOD64_0SMOfqYGY8Fk7uQr6bvqqVmxJP2Q&adurl=https://ad.doubleclick.net/searchads/link/click%3Flid%3D43700068081822169%26ds_s_kwgid%3D58700007557265153%26ds_a_cid%3D96020808%26ds_a_caid%3D15568948498%26ds_a_agid%3D130555814865%26ds_a_fiid%3D%26ds_a_lid%3Dkwd-252579546%26ds_a_extid%3D%26%26ds_e_adid%3D693616450944%26ds_e_matchtype%3Dsearch%26ds_e_device%3Dc%26ds_e_network%3Ds%26%26ds_url_v%3D2%26ds_dest_url%3Dhttps://www.vodafone.de/privat/handys/neue-iphones.html%3Fb_id%3D681%26c_id%3Dsea_cic_307:cre_key_gen__per_apl_dive_%26extProvId%3D5%26extPu%3Dvf-googleads%26extCr%3D130555814865-693616450944%26extSi%3D%26extTg%3D%26extLi%3D15568948498%26keyword%3Diphone%26extAP%3D%26extMT%3Dp%26gclsrc%3Daw.ds%26ds_rl%3D1235953%26gad_source%3D5&q=&nb=0&rurl=https%3A%2F%2Fwww.ecosia.org%2F%3Fc%3Dde%26&nm=13&nx=122&ny=15&is=660x223',
          'https://ad.doubleclick.net/searchads/link/click?lid=43700068081822169&ds_s_kwgid=58700007557265153&ds_a_cid=96020808&ds_a_caid=15568948498&ds_a_agid=130555814865&ds_a_fiid=&ds_a_lid=kwd-252579546&ds_a_extid=&&ds_e_adid=693616450944&ds_e_matchtype=search&ds_e_device=c&ds_e_network=s&&ds_url_v=2&acs_info=CjdodHRwczovL3d3dy52b2RhZm9uZS5kZS9wcml2YXQvaGFuZHlzL25ldWUtaXBob25lcy5odG1sOgTIyLEC&ds_dest_url=https://www.vodafone.de/privat/handys/neue-iphones.html?b_id=681&c_id=sea_cic_307:cre_key_gen__per_apl_dive_&extProvId=5&extPu=vf-googleads&extCr=130555814865-693616450944&extSi=&extTg=&extLi=15568948498&keyword=iphone&extAP=&extMT=p&gclsrc=aw.ds&ds_rl=1235953&gad_source=5&gclid=EAIaIQobChMI84Dh3cTDiQMV2k5BAh16JRi1EAEYASAAEgIjwfD_BwE',
        ],
        no: ['https://www.mediamarkt.de/de/brand/apple/iphone'],
      },
    })) {
      describe(`for category=${category}`, function () {
        describe('should mark as tracking', function () {
          for (const url of yes) {
            it(`- ${url}`, function () {
              expect(isAdUrlByCategory(url, category)).to.eql(true);
            });
          }
        });
        describe('should NOT mark as tracking', function () {
          for (const url of no) {
            it(`- ${url}`, function () {
              expect(isAdUrlByCategory(url, category)).to.eql(false);
            });
          }
        });
      });
    }
  });
});
