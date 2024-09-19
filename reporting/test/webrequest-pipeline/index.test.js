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

import chrome from 'sinon-chrome';
import { expect } from 'chai';

import WebRequestPipeline from '../../src/webrequest-pipeline/index.js';

describe('WebRequestPipeline', function () {
  before(function () {
    chrome.storage.session = chrome.storage.local;
    globalThis.chrome = chrome;
  });

  beforeEach(function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
  });

  context('PageStore', function () {
    it('starts empty', function () {
      const pipeline = new WebRequestPipeline();
      pipeline.init();
      expect(pipeline.pageStore.tabs.countNonExpiredKeys()).to.be.equal(0);
    });

    context('on webRequest.onBeforeRequest', function () {
      it('creates a page', function () {
        const pipeline = new WebRequestPipeline();
        pipeline.init();
        pipeline.addPipelineStep('onBeforeRequest', {
          name: 'test',
          spec: 'annotate',
          fn: () => {},
        });
        const details = {
          tabId: 1,
          url: 'https://example.com',
          type: 'main_frame',
        };
        chrome.webRequest.onBeforeRequest.dispatch(details);
        expect(pipeline.pageStore.tabs.has(details.tabId)).to.be.true;
        expect(pipeline.pageStore.tabs.get(details.tabId)).to.deep.include({
          url: details.url,
        });
      });
    });
  });
});
