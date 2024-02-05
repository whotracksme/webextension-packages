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

import PageQuorumCheckHandler from '../src/paged-quorum-check-handler.js';

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

  beforeEach(function () {
    jobScheduler = {
      registerHandler() {},
    };
    quorumChecker = {};
    countryProvider = {};
    uut = new PageQuorumCheckHandler({
      jobScheduler,
      quorumChecker,
      countryProvider,
    });
  });

  it('should be able to process a message', async function () {
    const page = someSafePage();
    const message = uut.runJob(page);
    expect(message).to.exist;
  });
});
