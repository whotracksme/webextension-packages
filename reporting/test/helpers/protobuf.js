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

// Hand encoder for tiny protobuf fixtures. Messages are binary strings
// (one character per byte), the value model of the "base64" transform.

function varint(n) {
  let out = '';
  let value = n;
  while (value >= 0x80) {
    out += String.fromCharCode(value % 0x80 | 0x80);
    value = Math.floor(value / 0x80);
  }
  return out + String.fromCharCode(value);
}

function tag(field, wireType) {
  return varint(field * 8 + wireType);
}

export function toBinary(bytes) {
  return String.fromCharCode(...bytes);
}

export function toBase64Url(binary) {
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function pbVarint(field, n) {
  return tag(field, 0) + varint(n);
}

export function pbFixed64(field, bytes = '\x00'.repeat(8)) {
  return tag(field, 1) + bytes;
}

export function pbBytes(field, binary) {
  return tag(field, 2) + varint(binary.length) + binary;
}

export function pbString(field, text) {
  return pbBytes(field, toBinary(new TextEncoder().encode(text)));
}

export function pbMessage(field, ...parts) {
  return pbBytes(field, parts.join(''));
}

export function pbFixed32(field, bytes = '\x00'.repeat(4)) {
  return tag(field, 5) + bytes;
}
