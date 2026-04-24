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

import logger from '../logger.js';
import ChromeStorageMap from './utils/chrome-storage-map.js';

const DOCUMENT_TTL = 1000 * 60 * 60; // 1 hour
const HOLD_MS = 15 * 1000;
const HELD_STORAGE_KEY = 'wtm-url-reporting:document-store:held';

function setActive(doc, active) {
  if (active && doc.activeFrom === 0) {
    doc.activeFrom = Date.now();
  } else if (!active && doc.activeFrom > 0) {
    doc.activeTime += Date.now() - doc.activeFrom;
    doc.activeFrom = 0;
  }
}

function createDocument({ documentId, tabId, url, isPrivate, active }) {
  return {
    id: tabId,
    url: url || '',
    isPrivate: !!isPrivate,
    isPrivateServer: false,
    created: Date.now(),
    destroyed: null,
    // documentIds[0] is the root main-frame doc; sub-frames append.
    // Bookkeeping only — lookups go through #docIndex.
    documentIds: [documentId],
    activeTime: 0,
    activeFrom: active ? Date.now() : 0,
    requestStats: {},
    counter: 0,
  };
}

/**
 * Stores per-document page-load records keyed by rootDocumentId.
 *
 * Every webRequest carries a `documentId` (Chrome >= 106). A flat
 * Map<docId, document> index resolves any frame's documentId — root
 * or sub-frame, current or recently-held — to its owning document in
 * O(1). Sub-frame documents inherit attribution from their parent.
 *
 * A document is created eagerly on the first main-frame webRequest
 * for a new documentId; `webNavigation.onCommitted` then just updates
 * its URL and marks it as the tab's currently-visible document. This
 * means every webRequest is attributed: there is no pre-commit window
 * in which requests fall on the floor.
 *
 * When a document leaves its tab (new main-frame document committed
 * or tab removal), it moves into a short-lived hold (HOLD_MS). During
 * the hold, late webRequests still resolve to it, and a bfcache-style
 * re-commit cancels the hold and restores it to its tab. When the
 * hold expires, the finalized document is delivered via
 * `onDocumentReleased`.
 *
 * This module performs no throttling, batching, or retry. The
 * callback delivers finalized, immutable state; the host wires it
 * into whatever scheduler it has for actual send timing.
 */
export default class DocumentStore {
  #documents;
  #docIndex;
  #held;
  // #tabToDocument and #tabContext bridge tab-lifecycle events to the
  // document timeline. Chrome fires tabs.onCreated / onActivated /
  // onUpdated / onRemoved independently of webRequest and
  // webNavigation, and some fire *before* any document exists for the
  // tab (e.g. tabs.onActivated on a brand-new tab before its
  // main-frame webRequest). The document record itself still owns
  // isPrivate / activeFrom / activeTime; these two maps are just the
  // buffer so those signals aren't lost in the gap between tab events
  // and document creation.
  //   #tabToDocument:  tabId -> rootDocumentId of the currently-visible
  //                    document. Used to route tab events onto the
  //                    right document and to detect the "previous"
  //                    document when a new one commits in the tab.
  //   #tabContext:     tabId -> { isPrivate, active, url } snapshot of
  //                    the latest tab-lifecycle state. Read by
  //                    #createForTab so new documents are born with
  //                    the correct initial flags.
  #tabToDocument;
  #tabContext;
  #onDocumentReleased;
  #holdMs;
  #sessionApi;
  #timer;
  #timerDueAt;
  // Older recorded fixtures (pre-Chrome-106) lack documentId on
  // webNavigation.onCommitted. Synthesize a stable id so attribution
  // and documentId-keyed dedupe still work during replay.
  #synthSeq;

  constructor({
    onDocumentReleased = () => {},
    holdMs = HOLD_MS,
    sessionApi = typeof chrome !== 'undefined' && chrome?.storage?.session,
  } = {}) {
    this.#documents = new ChromeStorageMap({
      storageKey: 'wtm-url-reporting:document-store:documents',
      ttlInMs: DOCUMENT_TTL,
    });
    this.#docIndex = new Map();
    this.#held = new Map();
    this.#tabToDocument = new Map();
    this.#tabContext = new Map();
    this.#onDocumentReleased = onDocumentReleased;
    this.#holdMs = holdMs;
    this.#sessionApi = sessionApi;
    this.#timer = null;
    this.#timerDueAt = Infinity;
    this.#synthSeq = 0;
  }

  async init() {
    await this.#documents.isReady;
    this.#docIndex.clear();
    this.#tabToDocument.clear();
    for (const doc of this.#documents.values()) {
      for (const docId of doc.documentIds) {
        this.#docIndex.set(docId, doc);
      }
      if (doc.id != null) {
        this.#tabToDocument.set(doc.id, doc.documentIds[0]);
      }
    }
    await this.#rehydrateHeld();

    chrome.tabs.onCreated.addListener(this.#onTabCreated);
    chrome.tabs.onUpdated.addListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.addListener(this.#onTabRemoved);
    chrome.tabs.onActivated.addListener(this.#onTabActivated);
    chrome.webNavigation.onCommitted.addListener(this.#onNavigationCommitted);

    this.#drainAndRearm();
  }

  unload() {
    for (const doc of Array.from(this.#documents.values())) {
      this.#holdDocument(doc);
    }
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#timerDueAt = Infinity;
    }
    this.#documents.clear();
    this.#docIndex.clear();
    this.#tabToDocument.clear();
    this.#tabContext.clear();

    chrome.tabs.onCreated.removeListener(this.#onTabCreated);
    chrome.tabs.onUpdated.removeListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.removeListener(this.#onTabRemoved);
    chrome.tabs.onActivated.removeListener(this.#onTabActivated);
    chrome.webNavigation.onCommitted.removeListener(
      this.#onNavigationCommitted,
    );
  }

  checkIfEmpty() {
    return this.#documents.countNonExpiredKeys() === 0;
  }

  // Release all held documents whose hold window has elapsed. The
  // internal timer handles this automatically; exposed for tests.
  drainHeld(now = Date.now()) {
    this.#drainAndRearm(now);
  }

  getDocumentForRequest({ tabId, type, documentId, documentLifecycle, url }) {
    // Prerendered / bfcached documents the user has not activated: drop.
    if (documentLifecycle && documentLifecycle !== 'active') {
      return null;
    }
    if (documentId) {
      const doc = this.#docIndex.get(documentId);
      if (doc) {
        return doc;
      }
      // Main-frame webRequest for a new document: create it eagerly so
      // the pipeline has a context and subsequent sub-resources of the
      // same page attribute here. onCommitted will just reaffirm.
      if (type === 'main_frame') {
        return this.#createForTab({ tabId, documentId, url });
      }
      // Unknown sub-resource documentId: refuse to attribute rather
      // than guess.
      return null;
    }
    // Legacy-fixture path (no documentId on webRequest). Fall back to
    // the tab's currently-visible document. If none exists yet,
    // lazy-create one: main_frame requests carry the page URL
    // directly; for sub-resources fall back to the URL captured at
    // tabs.onCreated time, which is how older fixtures shape tabs.
    const rootDocId = this.#tabToDocument.get(tabId);
    if (rootDocId) {
      return this.#documents.get(rootDocId) || null;
    }
    const ctx = this.#tabContext.get(tabId);
    const fallbackUrl = type === 'main_frame' ? url : ctx?.url;
    if (!fallbackUrl) {
      return null;
    }
    const synthId = `synth:${tabId}:${(this.#synthSeq += 1)}`;
    return this.#createForTab({ tabId, documentId: synthId, url: fallbackUrl });
  }

  #createForTab({ tabId, documentId, url }) {
    // If the tab already has a visible document, hold it — we're
    // navigating to a new one (or the previous nav aborted).
    const prevDocId = this.#tabToDocument.get(tabId);
    if (prevDocId && prevDocId !== documentId) {
      const prev = this.#documents.get(prevDocId);
      if (prev) this.#holdDocument(prev);
    }
    const ctx = this.#tabContext.get(tabId) || {};
    const doc = createDocument({
      documentId,
      tabId,
      url,
      isPrivate: ctx.isPrivate,
      active: ctx.active,
    });
    this.#documents.set(documentId, doc);
    this.#tabToDocument.set(tabId, documentId);
    this.#docIndex.set(documentId, doc);
    return doc;
  }

  #holdDocument(doc) {
    if (!doc) return;
    const rootDocumentId = doc.documentIds[0];
    setActive(doc, false);
    doc.destroyed = Date.now();
    const snapshot = {
      ...doc,
      documentIds: [...doc.documentIds],
    };
    this.#held.set(rootDocumentId, {
      heldSince: Date.now(),
      document: snapshot,
    });
    // Re-point index entries at the held snapshot so late requests
    // hit the frozen copy with the final stats.
    for (const docId of snapshot.documentIds) {
      this.#docIndex.set(docId, snapshot);
    }
    this.#documents.delete(rootDocumentId);
    this.#persistHeld();
    this.#drainAndRearm();
  }

  #releaseHeld(rootDocumentId) {
    const entry = this.#held.get(rootDocumentId);
    if (!entry) return null;
    this.#held.delete(rootDocumentId);
    for (const docId of entry.document.documentIds) {
      if (this.#docIndex.get(docId) === entry.document) {
        this.#docIndex.delete(docId);
      }
    }
    this.#persistHeld();
    return entry.document;
  }

  #drainAndRearm(now = Date.now()) {
    let nextDueAt = Infinity;
    const due = [];
    for (const [rootDocId, entry] of this.#held) {
      const dueAt = entry.heldSince + this.#holdMs;
      if (dueAt <= now) {
        due.push(rootDocId);
      } else if (dueAt < nextDueAt) {
        nextDueAt = dueAt;
      }
    }
    for (const rootDocId of due) {
      const doc = this.#releaseHeld(rootDocId);
      if (!doc) continue;
      try {
        this.#onDocumentReleased(doc);
      } catch (e) {
        logger.warn('DocumentStore: onDocumentReleased callback failed', e);
      }
    }
    this.#rearm(nextDueAt);
  }

  #rearm(nextDueAt) {
    if (nextDueAt === this.#timerDueAt) return;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#timerDueAt = Infinity;
    }
    if (nextDueAt === Infinity) return;
    const delay = Math.max(nextDueAt - Date.now(), 0);
    this.#timerDueAt = nextDueAt;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#timerDueAt = Infinity;
      this.#drainAndRearm();
    }, delay);
  }

  #persistHeld() {
    if (!this.#sessionApi?.set) return;
    try {
      this.#sessionApi.set({
        [HELD_STORAGE_KEY]: Object.fromEntries(this.#held),
      });
    } catch (e) {
      logger.debug('DocumentStore: persistHeld failed', e);
    }
  }

  #rehydrateHeld() {
    return new Promise((resolve) => {
      if (!this.#sessionApi?.get) {
        resolve();
        return;
      }
      this.#sessionApi.get([HELD_STORAGE_KEY], (result) => {
        const raw = (result && result[HELD_STORAGE_KEY]) || {};
        for (const [rootDocId, entry] of Object.entries(raw)) {
          if (!entry?.document?.documentIds?.length) continue;
          this.#held.set(rootDocId, entry);
          for (const docId of entry.document.documentIds) {
            this.#docIndex.set(docId, entry.document);
          }
        }
        resolve();
      });
    });
  }

  #applyTabActive(tabId, active) {
    const prev = this.#tabContext.get(tabId) || {};
    this.#tabContext.set(tabId, { ...prev, active });
    const rootDocId = this.#tabToDocument.get(tabId);
    if (!rootDocId) return;
    const doc = this.#documents.get(rootDocId);
    if (!doc) return;
    setActive(doc, active);
    this.#documents.set(rootDocId, doc);
  }

  #onTabCreated = (tab) => {
    this.#tabContext.set(tab.id, {
      isPrivate: !!tab.incognito,
      active: !!tab.active,
      url: tab.url || '',
    });
  };

  // tab.onUpdated is the authoritative source for isPrivate/active at
  // the tab level; it does NOT set the document URL (that comes from
  // webNavigation.onCommitted, which is precisely ordered).
  #onTabUpdated = (tabId, _info, tab) => {
    this.#tabContext.set(tabId, {
      isPrivate: !!tab.incognito,
      active: !!tab.active,
    });
    const rootDocId = this.#tabToDocument.get(tabId);
    if (!rootDocId) return;
    const doc = this.#documents.get(rootDocId);
    if (!doc) return;
    doc.isPrivate = !!tab.incognito;
    setActive(doc, !!tab.active);
    this.#documents.set(rootDocId, doc);
  };

  #onTabRemoved = (tabId) => {
    const rootDocId = this.#tabToDocument.get(tabId);
    if (rootDocId) {
      const doc = this.#documents.get(rootDocId);
      if (doc) this.#holdDocument(doc);
    }
    this.#tabToDocument.delete(tabId);
    this.#tabContext.delete(tabId);
  };

  #onTabActivated = ({ previousTabId, tabId }) => {
    if (previousTabId) {
      this.#applyTabActive(previousTabId, false);
    } else {
      // Chrome doesn't provide previousTabId — mark all others inactive.
      for (const otherTabId of this.#tabContext.keys()) {
        if (otherTabId !== tabId) this.#applyTabActive(otherTabId, false);
      }
    }
    this.#applyTabActive(tabId, true);
  };

  #onNavigationCommitted = (details) => {
    const { frameId, tabId, documentId, parentDocumentId, url } = details;

    if (frameId !== 0) {
      // Sub-frame commit: attach documentId to the parent's document.
      if (!documentId || this.#docIndex.has(documentId)) return;
      const owner = parentDocumentId
        ? this.#docIndex.get(parentDocumentId)
        : null;
      if (!owner) return;
      owner.documentIds.push(documentId);
      this.#docIndex.set(documentId, owner);
      const ownerRoot = owner.documentIds[0];
      if (this.#documents.has(ownerRoot)) {
        this.#documents.set(ownerRoot, owner);
      }
      return;
    }

    // Chrome 106+ always provides documentId; synthesize for older
    // fixtures so attribution and dedupe have a key.
    const effectiveDocId =
      documentId || `synth:${tabId}:${(this.#synthSeq += 1)}`;

    // bfcache restore: committed docId matches a held document. Cancel
    // its hold and restore it to the tab.
    if (this.#held.has(effectiveDocId)) {
      const currentOnTab = this.#tabToDocument.get(tabId);
      if (currentOnTab && currentOnTab !== effectiveDocId) {
        const leaving = this.#documents.get(currentOnTab);
        if (leaving) this.#holdDocument(leaving);
      }
      const entry = this.#held.get(effectiveDocId);
      this.#held.delete(effectiveDocId);
      const restored = entry.document;
      restored.destroyed = null;
      setActive(restored, !!this.#tabContext.get(tabId)?.active);
      for (const docId of restored.documentIds) {
        this.#docIndex.set(docId, restored);
      }
      this.#documents.set(effectiveDocId, restored);
      this.#tabToDocument.set(tabId, effectiveDocId);
      this.#persistHeld();
      this.#drainAndRearm();
      return;
    }

    // Common path: main_frame webRequest already created the document.
    // Reaffirm the tab→doc link and update url in case it changed via
    // redirects between the request and the commit.
    if (this.#documents.has(effectiveDocId)) {
      const doc = this.#documents.get(effectiveDocId);
      if (url && doc.url !== url) {
        doc.url = url;
        this.#documents.set(effectiveDocId, doc);
      }
      this.#tabToDocument.set(tabId, effectiveDocId);
      return;
    }

    // Legacy fixture path (no documentId on webRequest): create here.
    this.#createForTab({ tabId, documentId: effectiveDocId, url });
  };
}

export { HOLD_MS };
