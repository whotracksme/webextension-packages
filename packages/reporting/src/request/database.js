/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import * as IDB from 'idb';

class IDBWrapper {
  constructor(db, tableName) {
    this.db = db;
    this.tableName = tableName;
  }

  async put(value) {
    await this.db.put(this.tableName, value);
  }

  async clear() {
    await this.db.clear(this.tableName);
  }

  async uniqueKeys() {
    return this.db.keys(this.tableName);
  }

  async count() {
    return this.db.count(this.tableName);
  }

  async bulkPut(rows) {
    const tx = this.db.transaction(this.tableName, 'readwrite');
    await Promise.all(rows.map((row) => tx.store.add(row)));
    await tx.done;
  }

  async bulkDelete(keys, { primaryKey = null } = {}) {
    const tx = this.db.transaction(this.tableName, 'readwrite');
    const store = primaryKey ? tx.store.index(primaryKey) : tx.store;
    await Promise.all(keys.map((key) => store.delete(key)));
    await tx.done;
  }

  async where({ primaryKey, anyOf }) {
    const rows = await this.db.getAllFromIndex(this.tableName, primaryKey);
    return rows.filter((row) => anyOf.includes(row[primaryKey]));
  }
}

class PersistentState {
  constructor(db, tableName, keyName) {
    this.db = db;
    this.tableName = tableName;
    this.keyName = keyName;
    this.value = {};
    this.dirty = false;
  }

  async load() {
    const value = await this.db.get(this.tableName, this.keyName);
    try {
      this.value = JSON.parse(value || '{}');
    } catch (e) {
      this.value = {};
      this.dirty = true;
    }
    return this.value;
  }

  async save() {
    if (this.dirty) {
      await this.db.put(
        this.tableName,
        JSON.stringify(this.value),
        this.keyName,
      );
      this.dirty = false;
    }
  }

  async setValue(v) {
    this.value = v;
    this.dirty = true;
    await this.save();
  }

  async getValue() {
    await this.load();
    return this.value;
  }

  setDirty() {
    this.dirty = true;
  }

  async clear() {
    this.value = {};
    this.dirty = true;
    await this.save();
  }
}

export default class AttrackDatabase {
  constructor() {
    this.db = null;
    this._ready = null;
  }

  async init() {
    let resolver;
    this._ready = new Promise((resolve) => {
      resolver = resolve;
    });
    // TODO @chrmod: consider moving outside of the webextesnion-packages
    // same as other reporting database
    this.db = await IDB.openDB('antitracking', 21, {
      async upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const tokenDomainStore = db.createObjectStore('tokenDomain', {
            keyPath: ['token', 'fp'],
          });
          tokenDomainStore.createIndex('token', 'token');
          tokenDomainStore.createIndex('mtime', 'mtime');

          const tokenBlockedStore = db.createObjectStore('tokenBlocked', {
            keyPath: 'token',
          });
          tokenBlockedStore.createIndex('token', 'token');
          tokenBlockedStore.createIndex('expires', 'expires');

          const tokensStore = db.createObjectStore('tokens', {
            keyPath: 'token',
          });
          tokensStore.createIndex('lastSent', 'lastSent');
          tokensStore.createIndex('created', 'created');

          const keysStore = db.createObjectStore('keys', { keyPath: 'hash' });
          keysStore.createIndex('lastSent', 'lastSent');
          keysStore.createIndex('created', 'created');

          db.createObjectStore('state');
        }

        if (oldVersion > 20) {
          db.deleteObjectStore('requestKeyValue');
        }
      },
    });
    resolver();
    // const tables = {
    //   tokenDomain: '[token+fp], token, mtime',
    //   tokenBlocked: 'token, expires',
    //   tokens: 'token, lastSent, created',
    //   keys: 'hash, lastSent, created',
    // };
  }

  unload() {
    if (this.db !== null) {
      this.db.close();
      this.db = null;
    }
  }

  get ready() {
    if (this._ready === null) {
      return Promise.reject(new Error('init not called'));
    }
    return this._ready;
  }

  get tokenDomain() {
    return new IDBWrapper(this.db, 'tokenDomain');
  }

  get tokenBlocked() {
    return new IDBWrapper(this.db, 'tokenBlocked');
  }

  get tokens() {
    return new IDBWrapper(this.db, 'tokens');
  }

  get keys() {
    return new IDBWrapper(this.db, 'keys');
  }

  get blocked() {
    return new PersistentState(this.db, 'state', 'blocked');
  }

  get localBlocked() {
    return new PersistentState(this.db, 'state', 'localBlocked');
  }

  get hourChangedlastRun() {
    return new PersistentState(this.db, 'state', 'hourChangedlastRun');
  }

  get config() {
    return new PersistentState(this.db, 'state', 'config');
  }
}
