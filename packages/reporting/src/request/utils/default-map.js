/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Equivalent to Python's default dict, but in Javascript with a Map!
 * It behaves exactly like a map, but allows you to specify a callback to be
 * used when a `key` does not exist in the Map yet.
 *
 * >>> const myMap = new DefaultMap(() => [])
 * >>> myMap.get('foo')
 * []
 * >> myMap.update('bar', v => v.push(42))
 * >> myMap
 * DefaultMap { 'foo' => [], 'bar' => [ 42 ] }
 */

export default class DefaultMap {
  constructor(valueCtr, ...args) {
    this.map = new Map(...args);
    this.valueCtr = valueCtr;
  }

  toMap() {
    return this.map;
  }

  toObj() {
    const obj = Object.create(null);
    this.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }

  get size() {
    return this.map.size;
  }

  clear() {
    return this.map.clear();
  }

  delete(key) {
    return this.map.delete(key);
  }

  entries() {
    return this.map.entries();
  }

  forEach(cb, thisArg) {
    return this.map.forEach(cb, thisArg);
  }

  get(key) {
    let value = this.map.get(key);

    if (value === undefined) {
      value = this.valueCtr();
      this.set(key, value);
    }

    return value;
  }

  has(key) {
    return this.map.has(key);
  }

  keys() {
    return this.map.keys();
  }

  set(key, value) {
    this.map.set(key, value);
    return this;
  }

  values() {
    return this.map.values();
  }

  // Extra API

  update(key, updateFn) {
    const value = this.get(key);
    const result = updateFn(value);
    this.set(key, result === undefined ? value : result);
  }
}
