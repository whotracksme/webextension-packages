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

import {
  VALID_RESPONSE_PROPERTIES,
  default as WebRequestListenersManager,
} from './utils/webrequest.js';

import Pipeline from './pipeline.js';
import WebRequestContext from './webrequest-context.js';
import PageStore from './page-store.js';
import logger from './logger.js';
import CnameUncloaker, { isCnameUncloakSupported } from './cname-uncloak.js';

function modifyHeaderByType(headers, name, value) {
  const lowerCaseName = name.toLowerCase();
  const filteredHeaders = headers.filter(
    (h) => h.name.toLowerCase() !== lowerCaseName,
  );
  if (value) {
    filteredHeaders.push({ name, value });
  }
  return filteredHeaders;
}

/**
 * Small abstraction on top of blocking responses expected by WebRequest API. It
 * provides a few helpers to block, redirect or modify headers. It is also able
 * to create a valid blocking response taking into account platform-specific
 * allowed capabilities.
 */
class BlockingResponse {
  constructor(details) {
    this.details = details;

    // Blocking response
    this.redirectUrl = undefined;
    this.cancel = undefined;
    this.responseHeaders = undefined;
    this.requestHeaders = undefined;
    this.shouldIncrementCounter = undefined;
  }

  redirectTo(url) {
    this.redirectUrl = url;
  }

  block() {
    this.cancel = true;
  }

  modifyHeader(name, value) {
    this.requestHeaders = modifyHeaderByType(
      this.requestHeaders || this.details.requestHeaders || [],
      name,
      value,
    );
  }

  modifyResponseHeader(name, value) {
    this.responseHeaders = modifyHeaderByType(
      this.responseHeaders || this.details.responseHeaders || [],
      name,
      value,
    );
  }

  toWebRequestResponse(event) {
    const allowedProperties = VALID_RESPONSE_PROPERTIES[event];
    const response = {};

    for (let i = 0; i < allowedProperties.length; i += 1) {
      const prop = allowedProperties[i];
      const value = this[prop];
      if (value !== undefined) {
        response[prop] = value;
      }
    }

    return response;
  }
}

export default class WebRequestPipeline {
  constructor() {
    this.initialized = false;
    this.onPageStagedListeners = new Set();
    this.listenerManager = new WebRequestListenersManager();
  }

  enabled() {
    return true;
  }

  init(_settings, browser) {
    // Optionally enable CNAME-uncloaking.
    this.cnameUncloaker = isCnameUncloakSupported(browser)
      ? new CnameUncloaker(browser.dns.resolve)
      : null;

    if (this.initialized) {
      return;
    }

    this.pipelines = new Map();
    this.pageStore = new PageStore({
      notifyPageStageListeners: this.notifyPageStageListeners.bind(this),
    });
    this.pageStore.init();

    this.initialized = true;
  }

  unload() {
    if (!this.initialized) {
      return;
    }

    this.onPageStagedListeners.clear();

    if (this.cnameUncloaker !== null) {
      this.cnameUncloaker.unload();
      this.cnameUncloaker = null;
    }

    // Remove webrequest listeners
    this.pipelines.forEach((pipeline, event) => {
      this.unloadPipeline(event);
    });

    this.pageStore.unload();
    this.initialized = false;
  }

  addOnPageStageListener(listener) {
    this.onPageStagedListeners.add(listener);
  }

  notifyPageStageListeners(page) {
    this.onPageStagedListeners.forEach((listener) => {
      try {
        listener(page);
      } catch (e) {
        logger.error('Page stage listener failed', e);
      }
    });
  }

  unloadPipeline(event) {
    if (this.pipelines.has(event)) {
      const pipeline = this.pipelines.get(event);
      this[event] = undefined;
      this.listenerManager.removeListener(event, pipeline.listener);
      pipeline.pipeline.unload();
      this.pipelines.delete(event);
    }
  }

  getPipeline(event) {
    if (this.pipelines.has(event)) {
      return this.pipelines.get(event).pipeline;
    }
    // Create pipeline step
    const pipeline = new Pipeline(`webRequestPipeline.${event}`, [], false);

    // Register listener for this event
    const listener = (details) => {
      const webRequestContext = WebRequestContext.fromDetails(
        details,
        this.pageStore,
        event,
      );

      // Request is not supported, so do not alter
      if (webRequestContext === null) {
        logger.debug('Ignore unsupported request', details);
        return {};
      }

      const response = new BlockingResponse(details);

      // Optionally uncloack first-party CNAME to uncover 1st-party tracking.
      // This feature can only be enabled in the following cases:
      //
      // 1. `browser.dns` API is available (feature-detection)
      // 2. webRequest supports async response (Firefox)
      if (
        // Will be set if uncloaking is supported on this platform (check
        // background `init(...)` for more details).
        this.cnameUncloaker !== null &&
        // We ignore 'main_frame' to make sure we do not introduce any latency
        // on the main request (because of DNS resolve) and also because we do
        // not expect any privacy leak from this first request.
        webRequestContext.type !== 'main_frame' &&
        // Check that request is 1st-party
        webRequestContext.urlParts !== null &&
        webRequestContext.tabUrlParts !== null &&
        webRequestContext.tabUrlParts.generalDomain ===
          webRequestContext.urlParts.generalDomain &&
        // Check that hostname is not the same as general domain (we need a subdomain)
        webRequestContext.urlParts.hostname !==
          webRequestContext.urlParts.generalDomain
      ) {
        const cnameResult = this.cnameUncloaker.resolveCNAME(
          webRequestContext.urlParts.hostname,
        );

        // Synchronous response means that the CNAME was cached.
        if (typeof cnameResult === 'string') {
          if (cnameResult !== '') {
            webRequestContext.setCNAME(cnameResult);
          }
          pipeline.safeExecute(webRequestContext, response, true);
          return response.toWebRequestResponse(event);
        }

        // Otherwise it's a promise and we wait for CNAME before processing.
        return cnameResult.then((cname) => {
          if (cnameResult !== '') {
            webRequestContext.setCNAME(cname);
          }
          pipeline.safeExecute(webRequestContext, response, true);
          return response.toWebRequestResponse(event);
        });
      }

      pipeline.safeExecute(webRequestContext, response, true);
      return response.toWebRequestResponse(event);
    };

    this.pipelines.set(event, {
      pipeline,
      listener,
    });

    // Register the event listener as an attribute of background so that we
    // can call it: `webRequestPipeline.background.onBeforeRequest(details)`.
    this[event] = listener;

    this.listenerManager.addListener(event, listener);

    return pipeline;
  }

  addPipelineStep(stage, opts) {
    if (this.initialized) {
      const pipeline = this.getPipeline(stage);
      if (pipeline === null) {
        logger.error('WebRequest pipeline (add) does not have stage', stage);
      } else {
        pipeline.addPipelineStep(opts);
      }
    }
  }

  removePipelineStep(stage, name) {
    if (this.initialized) {
      const pipeline = this.getPipeline(stage);

      if (pipeline === null) {
        logger.error('WebRequest pipeline (remove) does not have stage', stage);
      } else {
        pipeline.removePipelineStep(name);
        if (pipeline.length === 0) {
          this.unloadPipeline(stage);
        }
      }
    }
  }

  getPageStore() {
    return this.pageStore;
  }

  getPageForTab(tabId) {
    return this.pageStore.tabs.get(tabId);
  }
}
