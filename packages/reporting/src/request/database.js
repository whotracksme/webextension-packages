/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import * as IDB from 'idb';

class IDBWrapper {
  constructor(db, tableName, primaryKey) {
    this.db = db;
    this.tableName = tableName;
    this.primaryKey = primaryKey;
  }

  async put(value) {
    await this.db.put(this.tableName, value);
  }

  async clear() {
    await this.db.clear(this.tableName);
  }

  async uniqueKeys() {
    return this.db.getAllKeys(this.tableName);
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
    const store =
      primaryKey && primaryKey !== this.primaryKey
        ? tx.store.index(primaryKey)
        : tx.store;
    await Promise.all(keys.map((key) => store.delete(key)));
    await tx.done;
  }

  async where({ primaryKey, anyOf }) {
    let rows = [];
    if (primaryKey === this.primaryKey) {
      rows = await this.db.getAll(this.tableName);
    } else {
      rows = await this.db.getAllFromIndex(this.tableName, primaryKey);
    }
    if (anyOf) {
      return rows.filter((row) => anyOf.includes(row[primaryKey]));
    }
    return rows;
  }
}

export default class AttrackDatabase {
  constructor() {
    this.tableName = 'antitracking';
    this.db = null;
    this._ready = null;
  }

  async init() {
    let resolver;
    this._ready = new Promise((resolve) => {
      resolver = resolve;
    });
    this.db = await IDB.openDB(this.tableName, 21, {
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
        }

        if (oldVersion > 20) {
          db.createObjectStore('keyval');
          db.deleteObjectStore('requestKeyValue');
        }
      },
    });
    resolver();
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
    return new IDBWrapper(this.db, 'tokenDomain', 'token,fp');
  }

  get tokenBlocked() {
    return new IDBWrapper(this.db, 'tokenBlocked', 'token');
  }

  get tokens() {
    return new IDBWrapper(this.db, 'tokens', 'token');
  }

  get keys() {
    return new IDBWrapper(this.db, 'keys', 'hash');
  }

  async get(key) {
    await this._ready;
    return this.db.get('keyval', key);
  }

  async set(key, val) {
    await this._ready;
    return this.db.put('keyval', val, key);
  }
}
