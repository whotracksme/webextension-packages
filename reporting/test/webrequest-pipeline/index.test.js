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

import { playScenario } from '../helpers/scenarios.js';

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
      expect(pipeline.pageStore.checkIfEmpty()).to.be.true;
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
          frameId: 0,
          url: 'https://example.com',
          type: 'main_frame',
        };
        chrome.webRequest.onBeforeRequest.dispatch(details);
        const tab = pipeline.pageStore.getPage(details.tabId);
        expect(tab).to.deep.include({
          url: details.url,
        });
      });
    });

    context('with pre-recorded events', function () {
      let pipeline;

      beforeEach(function () {
        pipeline = new WebRequestPipeline();
        pipeline.init();
        [
          'onBeforeRequest',
          'onBeforeSendHeaders',
          'onHeadersReceived',
          'onAuthRequired',
          'onBeforeRedirect',
          'onCompleted',
          'onErrorOccurred',
        ].forEach((step) => {
          pipeline.addPipelineStep(step, {
            name: 'test',
            spec: 'annotate',
            fn: () => {},
          });
        });
      });

      afterEach(function () {
        pipeline.unload();
        pipeline = undefined;
      });

      context('0001-quick-close', function () {
        it('runs without a crash', async function () {
          const { seenTabIds } = await playScenario(chrome, {
            scenarioName: '0001-quick-close',
            scenarioRelease: '2024-09-27',
          });
          expect(pipeline.pageStore.checkIfEmpty()).to.be.false;
          expect(seenTabIds).to.have.property('size', 1);
          const tabId = seenTabIds.values().next().value;
          const tab = pipeline.pageStore.getPage(tabId);
          expect(tab).to.deep.include({
            url: 'https://ghosterysearch.com/',
          });
          expect(tab.previous).to.deep.include({
            url: 'about:blank',
          });
        });
      });

      context('0002-quick-navigation', function () {
        it('runs without a crash', async function () {
          const { seenTabIds } = await playScenario(chrome, {
            scenarioName: '0002-quick-navigation',
            scenarioRelease: '2024-09-27',
          });
          expect(pipeline.pageStore.checkIfEmpty()).to.be.false;
          expect(seenTabIds).to.have.property('size', 1);
          const tabId = seenTabIds.values().next().value;
          const tab = pipeline.pageStore.getPage(tabId);
          expect(tab).to.deep.include({
            url: 'https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2F',
          });
          expect(tab.previous).to.deep.include({
            url: 'https://ghosterysearch.com/',
          });
        });
      });

      context('0003-prefetch', function () {
        it('runs without a crash', async function () {
          const { seenTabIds } = await playScenario(chrome, {
            scenarioName: '0003-prefetch',
            scenarioRelease: '2024-09-27',
          });
          expect(pipeline.pageStore.checkIfEmpty()).to.be.false;
          expect(seenTabIds).to.have.property('size', 1);
          const tabId = seenTabIds.values().next().value;
          const tab = pipeline.pageStore.getPage(tabId);
          expect(tab).to.deep.include({
            url: 'http://localhost:8080/',
          });
          expect(tab.previous).to.deep.include({
            url: 'about:blank',
          });
        });
      });
    });
  });
});
