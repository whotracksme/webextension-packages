/**
 * WhoTracks.Me
 * https://ghostery.com/whotracksme
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import 'fake-indexeddb/auto';
import * as chai from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import chrome from 'sinon-chrome';

chai.use(chaiAsPromised);
chai.use(sinonChai);

// Node's own navigator.userAgent would fail the documentId support check.
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  },
  configurable: true,
});

// Fill in missing APIs if sinon-chrome did not provide them
chrome.webRequest.OnBeforeRequestOptions ||= {
  blocking: 'blocking',
  requestBody: 'requestBody',
};
chrome.webRequest.OnBeforeSendHeadersOptions ||= {
  blocking: 'blocking',
  requestHeaders: 'requestHeaders',
};
chrome.webRequest.OnHeadersReceivedOptions ||= {
  blocking: 'blocking',
  responseHeaders: 'responseHeaders',
  extraHeaders: 'extraHeaders',
};
