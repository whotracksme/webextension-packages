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

import { expect } from 'chai';
import fc from 'fast-check';

import { lookupBuiltinTransform } from '../src/patterns.js';

describe('Test builtin primitives', function () {
  describe('#queryParam', function () {
    let queryParam;

    beforeEach(function () {
      queryParam = lookupBuiltinTransform('queryParam');
    });

    describe('core functionality', function () {
      it('["https://example.test/path?foo=bar+baz", "foo"] -> "bar baz"', function () {
        expect(
          queryParam('https://example.test/path?foo=bar+baz', 'foo'),
        ).to.eql('bar baz');
      });

      it('["/example.test/path?foo=bar+baz", "foo"] -> "bar baz"', function () {
        expect(queryParam('/example.test/path?foo=bar+baz', 'foo')).to.eql(
          'bar baz',
        );
      });

      it('["/example.test/path", "foo"] -> null', function () {
        expect(queryParam('/example.test/path', 'foo')).to.be.null;
      });

      it('["This is a string but not an URL", "foo"] -> null', function () {
        expect(queryParam('This is a string but not an URL', 'foo')).to.be.null;
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string, string] (more parameters are ignored)', function () {
        expect(() => queryParam()).to.throw();
        expect(() => queryParam('too few args')).to.throw();
        expect(() => queryParam({ wrong: 'types' }, 42)).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            // should not throw
            queryParam(untrustedText, 'someTrustedParam');
          }),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), (untrustedUrl) => {
            // should not throw
            queryParam(untrustedUrl, 'someTrustedParam');
          }),
        );
      });
    });
  });

  describe('#maskU', function () {
    let maskU;

    beforeEach(function () {
      maskU = lookupBuiltinTransform('maskU');
    });

    // most of the tests are in the sanitizer, so there is no need to repeat everything here
    describe('core functionality', function () {
      it('["https://example.test/"] -> "https://example.test/"', function () {
        expect(maskU('https://example.test/')).to.eql('https://example.test/');
      });

      it('should return null on non URLs', function () {
        expect(maskU('some text')).to.be.null;
        expect(maskU('/some/text')).to.be.null;
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string] (more parameters are ignored)', function () {
        expect(() => maskU()).to.throw();
        expect(() => maskU({ wrong: 'types' }, 42)).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            // should not throw
            maskU(untrustedText);
          }),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), (untrustedUrl) => {
            // should not throw
            maskU(untrustedUrl);
          }),
        );
      });
    });
  });

  describe('#split', function () {
    let split;

    beforeEach(function () {
      split = lookupBuiltinTransform('split');
    });

    describe('core functionality', function () {
      it('["abc_def_ghi", "_", 0] -> "abc"', function () {
        expect(split('abc_def_ghi', '_', 0)).to.eql('abc');
      });

      it('["abc_def_ghi", "_", 1] -> "def"', function () {
        expect(split('abc_def_ghi', '_', 1)).to.eql('def');
      });

      it('should return null if there is no match', function () {
        expect(split('some text', '<foo>', 0)).to.be.null;
        expect(split('some text', '<foo>', 1)).to.be.null;
        expect(split('some text', '<foo>', 2)).to.be.null;
      });

      it('should return null if there is a match but the index is out of bounds', function () {
        expect(split('abc_def_ghi', '_', 100)).to.be.null;
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string, string, integer] (more parameters are ignored)', function () {
        expect(() => split()).to.throw();
        expect(() => split('too few arguments')).to.throw();
        expect(() => split({ wrong: 'types' }, 42)).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(
            fc.fullUnicodeString(),
            fc.string(),
            (untrustedText, splitOn) => {
              fc.pre(splitOn.length > 0);

              // should not throw
              split(untrustedText, splitOn, 0);
              split(untrustedText, splitOn, 1);
              split(untrustedText, splitOn, 2);
            },
          ),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), fc.string(), (untrustedUrl, splitOn) => {
            fc.pre(splitOn.length > 0);

            // should not throw
            split(untrustedUrl, splitOn, 0);
            split(untrustedUrl, splitOn, 1);
            split(untrustedUrl, splitOn, 2);
          }),
        );
      });
    });
  });

  describe('#trySplit', function () {
    let trySplit;

    beforeEach(function () {
      trySplit = lookupBuiltinTransform('trySplit');
    });

    describe('core functionality', function () {
      it('["abc_def_ghi", "_", 0] -> "abc"', function () {
        expect(trySplit('abc_def_ghi', '_', 0)).to.eql('abc');
      });

      it('["abc_def_ghi", "_", 1] -> "def"', function () {
        expect(trySplit('abc_def_ghi', '_', 1)).to.eql('def');
      });

      it('should return the original text if there is no match', function () {
        expect(trySplit('some text', '<foo>', 0)).to.eql('some text');
        expect(trySplit('some text', '<foo>', 1)).to.eql('some text');
      });

      it('should return the original text if there is a match but the index is out of bounds', function () {
        expect(trySplit('abc_def_ghi', '_', 100)).to.eql('abc_def_ghi');
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string, string, integer] (more parameters are ignored)', function () {
        expect(() => trySplit()).to.throw();
        expect(() => trySplit('too few arguments')).to.throw();
        expect(() => trySplit({ wrong: 'types' }, [], 42)).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(
            fc.fullUnicodeString(),
            fc.string(),
            (untrustedText, trySplitOn) => {
              fc.pre(trySplitOn.length > 0);

              // should not throw
              trySplit(untrustedText, trySplitOn, 0);
              trySplit(untrustedText, trySplitOn, 1);
              trySplit(untrustedText, trySplitOn, 2);
            },
          ),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), fc.string(), (untrustedUrl, trySplitOn) => {
            fc.pre(trySplitOn.length > 0);

            // should not throw
            trySplit(untrustedUrl, trySplitOn, 0);
            trySplit(untrustedUrl, trySplitOn, 1);
            trySplit(untrustedUrl, trySplitOn, 2);
          }),
        );
      });
    });
  });

  describe('#decodeURIComponent', function () {
    let uut;

    beforeEach(function () {
      uut = lookupBuiltinTransform('decodeURIComponent');
    });

    describe('core functionality', function () {
      it('should behave like decodeURIComponent for valid URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), (url) => {
            const input = encodeURIComponent(url);
            expect(uut(input)).to.eql(url);
          }),
        );
      });

      it('should behave like decodeURIComponent for any properly encodeded string', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (text) => {
            const input = encodeURIComponent(text);
            expect(uut(input)).to.eql(text);
          }),
        );
      });

      describe('should return null for invalid URIs', function () {
        ['%', '%%', '-%-'].forEach((invalidURI) => {
          it(`invalid URI: ${invalidURI}`, function () {
            expect(uut(invalidURI)).to.be.null;
          });
        });
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string] (more parameters are ignored)', function () {
        expect(() => uut()).to.throw();
        expect(() => uut({ wrong: 'types' })).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            const result = uut(untrustedText);
            if (result !== null) {
              expect(result).to.be.a('string');
            }
          }),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), (untrustedUrl) => {
            const result = uut(untrustedUrl);
            if (result !== null) {
              expect(result).to.be.a('string');
            }
          }),
        );
      });
    });
  });

  describe('#tryDecodeURIComponent', function () {
    let uut;

    beforeEach(function () {
      uut = lookupBuiltinTransform('tryDecodeURIComponent');
    });

    describe('core functionality', function () {
      it('should behave like decodeURIComponent for valid URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), (url) => {
            const input = encodeURIComponent(url);
            expect(uut(input)).to.eql(url);
          }),
        );
      });

      it('should behave like decodeURIComponent for any properly encodeded string', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (text) => {
            const input = encodeURIComponent(text);
            expect(uut(input)).to.eql(text);
          }),
        );
      });

      describe('should return the original text for invalid URIs', function () {
        ['%', '%%', '-%-'].forEach((invalidURI) => {
          it(`invalid URI: ${invalidURI}`, function () {
            expect(uut(invalidURI)).to.eql(invalidURI);
          });
        });
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string] (more parameters are ignored)', function () {
        expect(() => uut()).to.throw();
        expect(() => uut({ wrong: 'types' })).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            expect(uut(untrustedText)).to.be.a('string');
          }),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(fc.webUrl(), (untrustedUrl) => {
            expect(uut(untrustedUrl)).to.be.a('string');
          }),
        );
      });
    });
  });

  describe('#json', function () {
    let uut;

    beforeEach(function () {
      uut = lookupBuiltinTransform('json');
    });

    describe('core functionality', function () {
      it('should extract fields from JSON', function () {
        expect(uut('{"a":1}', 'a')).to.equal('1');
        expect(uut('{"a":1, "b":"2"}', 'b')).to.equal('2');
      });

      it('should extract nested fields from JSON', function () {
        expect(uut('{ "a": { "nested": true } }', 'a.nested')).to.equal('true');
        expect(uut('{ "a": { "b": { "c": "3" } } }', 'a.b.c')).to.equal('3');
      });

      it('should reject unexpected normal text', function () {
        expect(uut('Some example text', '')).to.equal('');
        expect(uut('Some example text', 'key')).to.equal('');
        expect(uut('Some example text {"key":"1"}', 'key')).to.equal('');
      });

      it('should by default not extract non-trivial objects', function () {
        expect(uut('{"a":[1,2,3]}', 'a')).to.equal('');
        expect(uut('{"a":{"b":1}"}', 'a')).to.equal('');
      });

      it('should extract non-trivial objects when enabled', function () {
        expect(JSON.parse(uut('{"a":[1,2,3]}', 'a', true))).to.deep.equal([
          1, 2, 3,
        ]);
        expect(JSON.parse(uut('{"a":[1,2,3]}', 'a', true))).to.deep.equal([
          1, 2, 3,
        ]);
        expect(JSON.parse(uut('{"a":{"b":1}}', 'a', true))).to.deep.equal({
          b: 1,
        });
      });

      it('should ignore incorrect JSON', function () {
        expect(uut('', 'a')).to.equal('');
        expect(uut('][', 'a')).to.equal('');
        expect(uut('a:3', 'a')).to.equal('');
        expect(uut('a:3}', 'a')).to.equal('');
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string, string, [bool]]', function () {
        expect(() => uut()).to.throw();
        expect(() => uut('foo')).to.throw();
        expect(() => uut({ wrong: 'types' }, { wrong: 'types' })).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(
            fc.fullUnicodeString(),
            fc.string(),
            fc.boolean(),
            (untrustedText, path, extractObjects) => {
              expect(uut(untrustedText, path)).to.be.a('string');
              expect(uut(untrustedText, path, extractObjects)).to.be.a(
                'string',
              );
            },
          ),
        );
      });
    });
  });
});
