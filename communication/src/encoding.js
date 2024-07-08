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

function _fromString(data) {
  const res = new Uint8Array(data.length);
  const len = data.length;
  for (let i = 0; i < len; i += 1) {
    res[i] = data.charCodeAt(i);
  }
  return res;
}

function _toString(data) {
  const CHUNK_SIZE = 16383; // 32767 is too much for MS Edge in 2 Gb virtual machine
  const c = [];
  const len = data.length;
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    c.push(String.fromCharCode.apply(null, data.subarray(i, i + CHUNK_SIZE)));
  }
  return c.join('');
}

function toByteArray(data) {
  if (data.buffer) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

export function fromBase64(data) {
  return _fromString(atob(data));
}

const decoder = new TextDecoder();
export function fromUTF8(bytes) {
  return decoder.decode(toByteArray(bytes));
}

const encoder = new TextEncoder();
export function toUTF8(str) {
  return encoder.encode(str);
}

export function toBase64(data) {
  return btoa(_toString(toByteArray(data)));
}
