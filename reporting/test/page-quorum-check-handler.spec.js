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

import PageQuorumCheckHandler from '../src/page-quorum-check-handler.js';

function someSafePage({
  url = 'https://example.test/foo',
  canonicalUrl = null,
  ref = null,
  title = 'Some test page',
} = {}) {
  return {
    aggregator: {
      firstSeenAt: 1704910231248,
      lastSeenAt: 1704910231249,
      lastWrittenAt: 1704910231348,
      activity: 0,
    },
    url,
    status: 'complete',
    pageLoadMethod: 'full-page-load',
    title,
    ref,
    preDoublefetch: {
      content: {
        hasCsrfToken: false,
        numHiddenInputs: 1,
        numInputs: 7,
        numLinks: 384,
        numNodes: 1178,
        numPasswordFields: 0,
      },
      meta: {
        // always nulled out, as it is obsolete after the creation of
        // the top-level 'canonicalUrl' field
        canonicalUrl: null,
        contentType: 'text/html',
        language: 'de',
      },
      noindex: false,
      requestedIndex: true,
      title,
      url,
      lastUpdatedAt: 1704910231247,
    },
    lastUpdatedAt: 1704910231248,
    lang: 'de',
    canonicalUrl,
  };
}

describe('#PageQuorumCheckHandler', function () {
  let uut;
  let jobScheduler;
  let quorumChecker;
  let countryProvider;
  let votes;
  let urlsWithQuorum;

  beforeEach(function () {
    jobScheduler = {
      registerHandler() {},
    };
    votes = [];
    urlsWithQuorum = new Set();
    quorumChecker = {
      async sendQuorumIncrement({ text }) {
        votes.push(text);
      },
      async checkQuorumConsent({ text }) {
        return urlsWithQuorum.has(text);
      },
    };
    countryProvider = {
      getSafeCountryCode: () => '--',
    };
    uut = new PageQuorumCheckHandler({
      jobScheduler,
      quorumChecker,
      countryProvider,
    });
  });

  it('should be able to process a message', async function () {
    const page = someSafePage();
    urlsWithQuorum.add(page.url);

    const message = await uut.runJob(page);
    expect(message.body.payload.url).to.eql(page.url);
    expect(votes).to.eql([page.url]);
  });

  it('should drop a page that did not reach quorum', async function () {
    const page = someSafePage();

    const message = await uut.runJob(page);
    expect(message).to.be.null;
    expect(votes).to.eql([page.url]);
  });

  describe('with redirects', function () {
    it('should accept a redirect with a null URL (dropped by the sanitizer)', async function () {
      const page = someSafePage();
      urlsWithQuorum.add(page.url);
      page.redirects = [{ from: null, to: page.url, statusCode: 302 }];

      const message = await uut.runJob(page);
      expect(message.body.payload.redirects).to.eql(page.redirects);
      expect(votes).to.eql([page.url]);
    });

    it('should accept a redirect chain with a null URL in the middle (dropped by the sanitizer)', async function () {
      const page = someSafePage();
      const from = 'https://example.test/start';
      urlsWithQuorum.add(page.url);
      urlsWithQuorum.add(from);
      // The hop in the middle shows up twice: as "to" and as the next "from".
      page.redirects = [
        { from, to: null, statusCode: 302 },
        { from: null, to: page.url, statusCode: 302 },
      ];

      const message = await uut.runJob(page);
      expect(message.body.payload.redirects).to.eql(page.redirects);
      expect(votes).to.have.members([page.url, from]);
    });

    it('should accept the marker for a redirect chain that was cut', async function () {
      const page = someSafePage();
      const from = 'https://example.test/redirect-loop';
      urlsWithQuorum.add(page.url);
      urlsWithQuorum.add(from);
      page.redirects = [{ from, to: '...', statusCode: 302 }];

      const message = await uut.runJob(page);
      expect(message.body.payload.redirects).to.eql(page.redirects);
      expect(votes).to.have.members([page.url, from]);
    });

    it('should protect a URL that did not reach quorum', async function () {
      const page = someSafePage();
      urlsWithQuorum.add(page.url);
      page.redirects = [
        { from: 'https://example.test/secret', to: page.url, statusCode: 302 },
      ];

      const message = await uut.runJob(page);
      expect(message.body.payload.redirects).to.eql([
        {
          from: 'https://example.test/ (PROTECTED)',
          to: page.url,
          statusCode: 302,
        },
      ]);
    });
  });
});
