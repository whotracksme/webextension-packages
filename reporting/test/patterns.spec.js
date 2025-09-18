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

import Patterns, { lookupBuiltinTransform } from '../src/patterns.js';

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

  describe('#removeParams', function () {
    let removeParams;

    beforeEach(function () {
      removeParams = lookupBuiltinTransform('removeParams');
    });

    describe('core functionality', function () {
      it('should allow to remove one query parameter', function () {
        expect(
          removeParams('https://example.test/path?foo=remove&bar=keep', [
            'foo',
          ]),
        ).to.eql('https://example.test/path?bar=keep');
      });

      it('should allow to remove multiple parameter', function () {
        expect(
          removeParams('https://example.test/path?foo=remove&bar=remove#keep', [
            'foo',
            'bar',
          ]),
        ).to.eql('https://example.test/path#keep');
      });

      it('should accept empty list', function () {
        expect(
          removeParams('https://example.test/path?foo=foo&bar=bar#hash', []),
        ).to.eql('https://example.test/path?foo=foo&bar=bar#hash');
      });

      it('should remove all occurrences of a query parameter', function () {
        expect(
          removeParams('https://example.test/path?foo=first&foo=second', [
            'foo',
          ]),
        ).to.eql('https://example.test/path');
      });

      it('should work on simple URLs without query parameters', function () {
        expect(removeParams('https://example.test/', [])).to.eql(
          'https://example.test/',
        );
        expect(removeParams('https://example.test/', ['x'])).to.eql(
          'https://example.test/',
        );
      });

      it('should work on key-only query parameters', function () {
        expect(removeParams('https://example.test/foo?bar', [])).to.eql(
          'https://example.test/foo?bar',
        );
        expect(removeParams('https://example.test/foo?bar', ['x'])).to.eql(
          'https://example.test/foo?bar',
        );

        expect(removeParams('https://example.test/foo?bar=', [])).to.eql(
          'https://example.test/foo?bar=',
        );
        expect(removeParams('https://example.test/foo?bar=', ['x'])).to.eql(
          'https://example.test/foo?bar=',
        );
      });

      describe('should preserve information in the query string', function () {
        it('should keep plus-encoded white spaces untouched', function () {
          expect(
            removeParams(
              'https://example.test/path?foo=one+two+three&bar=one+two+three',
              ['foo'],
            ),
          ).to.eql('https://example.test/path?bar=one+two+three');
        });

        it('should keep percent-encoded white spaces untouched', function () {
          expect(
            removeParams(
              'https://example.test/path?foo=one%20two%20three&bar=one%20two%20three',
              ['foo'],
            ),
          ).to.eql('https://example.test/path?bar=one%20two%20three');
        });

        it('should preserve different representations of white spaces', function () {
          const url =
            'https://example.test/path?foo=one%20two%+three four++5&bar,baz';
          for (const nonExistingParams of [
            [],
            ['does-not-exist'],
            ['does', 'not', 'exist'],
          ]) {
            expect(removeParams(url, nonExistingParams)).to.eql(url);
          }
        });
      });

      describe('should support ULRs with non-ascii letters', function () {
        it('should handle Arabic', function () {
          const url =
            'http://abouwadi3-music.blogspot.com/search/label/مالوف تونسي?updated-max=2013-07-09T19:13:00-07:00&max-results=20&start=19&by-date=false&m=0';
          expect(removeParams(url, [])).to.eql(url);
          expect(removeParams(url, ['does-not-exist'])).to.eql(url);
          expect(removeParams(url, ['updated-max'])).to.eql(
            'http://abouwadi3-music.blogspot.com/search/label/مالوف تونسي?max-results=20&start=19&by-date=false&m=0',
          );
          expect(removeParams(url, ['updated-max', 'max-results'])).to.eql(
            'http://abouwadi3-music.blogspot.com/search/label/مالوف تونسي?start=19&by-date=false&m=0',
          );
          expect(
            removeParams(url, [
              'updated-max',
              'max-results',
              'start',
              'by-date',
              'm',
            ]),
          ).to.eql(
            'http://abouwadi3-music.blogspot.com/search/label/مالوف تونسي',
          );
        });
      });

      // To get some confidence, the hand-written code should behave identical
      // in simple cases, when there are only simple strings ([a-z0-9]*).
      // Using simple string, avoid all problematic encoding issues.
      it('should behave like searchParams in simple cases', function () {
        fc.assert(
          fc.property(
            fc.webUrl({ withQueryParameters: true, withFragments: true }),
            fc.array(fc.tuple(fc.hexaString(), fc.hexaString())),
            fc.array(fc.hexaString()),
            (url, paramsToAdd, paramsToRemove) => {
              const tmp1 = new URL(url);
              tmp1.search = new URLSearchParams(paramsToAdd);
              const urlPlusParams = tmp1.toString();

              const tmp2 = new URL(urlPlusParams);
              for (const param of paramsToRemove) {
                tmp2.searchParams.delete(param);
              }

              const expected = tmp2.toString();
              const actual = removeParams(urlPlusParams, paramsToRemove);
              expect(actual).to.eql(expected);
            },
          ),
        );
      });

      describe('should return null for invalid URIs', function () {
        ['This is a string but not an URL', '%', '%%', '-%-'].forEach(
          (invalidURI) => {
            it(`invalid URI: ${invalidURI}`, function () {
              expect(removeParams(invalidURI, ['foo'])).to.be.null;
            });
          },
        );
      });
    });

    it('the order of the parameters should not impact the results', function () {
      fc.assert(
        fc.property(
          fc.webUrl({ withQueryParameters: true, withFragments: true }),
          fc.array(fc.string()),
          (url, extraParams) => {
            const allParams = extraParams.concat(
              [...new URL(url).searchParams].map((x) => x[0]),
            );
            for (let i = 0; i < allParams.length; i += 1) {
              const params = allParams.slice(0, i);
              const result1 = removeParams(url, params);
              const result2 = removeParams(url, [...params, ...params]);
              const result3 = removeParams(url, [
                ...params.toSorted(),
                ...params.toReversed(),
              ]);
              expect(result1).to.eql(result2);
              expect(result1).to.eql(result3);
            }
          },
        ),
      );
    });

    it('listing parameters multiple times should not impact the results', function () {
      fc.assert(
        fc.property(
          fc.webUrl({ withQueryParameters: true, withFragments: true }),
          fc.array(fc.string()),
          (url, extraParams) => {
            const allParams = extraParams.concat(
              [...new URL(url).searchParams].map((x) => x[0]),
            );
            for (let i = 0; i < allParams.length; i += 1) {
              const params = allParams.slice(0, i);
              const result1 = removeParams(url, params);
              const result2 = removeParams(url, params.toSorted());
              const result3 = removeParams(url, params.toReversed());
              expect(result1).to.eql(result2);
              expect(result1).to.eql(result3);
            }
          },
        ),
      );
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string, [string]] (more parameters are ignored)', function () {
        expect(() => removeParams()).to.throw();
        expect(() => removeParams('too few arguments')).to.throw();
        expect(() => removeParams({ wrong: 'types' }, 42)).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            const result = removeParams(untrustedText, ['someTrustedParam']);
            if (result !== null) {
              expect(result).to.be.a('string');
              expect(URL.canParse(result)).to.be.true;
            }
          }),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(
            fc.webUrl({ withQueryParameters: true, withFragments: true }),
            (untrustedUrl) => {
              const result = removeParams(untrustedUrl, ['someTrustedParam']);
              if (result !== null) {
                expect(result).to.be.a('string');
                expect(URL.canParse(result)).to.be.true;
              }
            },
          ),
        );
      });
    });
  });

  describe('#requireURL', function () {
    let requireURL;

    beforeEach(function () {
      requireURL = lookupBuiltinTransform('requireURL');
    });

    describe('core functionality', function () {
      it('should accept a valid URL', function () {
        const url = 'https://example.test/some?valid=url#foo';
        expect(requireURL(url)).to.eql(url);
      });

      it('should replace an invalid URL by null', function () {
        expect(requireURL('This is text. It is not an url.')).to.be.null;
        expect(requireURL('/also/not/an/url')).to.be.null;
        expect(requireURL('')).to.be.null;
        expect(requireURL('%')).to.be.null;
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string] (more parameters are ignored)', function () {
        expect(() => requireURL()).to.throw();
        expect(() => requireURL({ wrong: 'types' }, 42)).to.throw();
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            const result = requireURL(untrustedText);
            if (result !== null) {
              expect(result).to.eql(untrustedText);
            }
          }),
        );
      });

      it('should not fail on well-formed but arbitrary URLs', function () {
        fc.assert(
          fc.property(
            fc.webUrl({ withQueryParameters: true, withFragments: true }),
            (untrustedUrl) => {
              expect(requireURL(untrustedUrl)).to.eql(untrustedUrl);
            },
          ),
        );
      });
    });
  });

  describe('#filterExact', function () {
    let filterExact;

    beforeEach(function () {
      filterExact = lookupBuiltinTransform('filterExact');
    });

    describe('core functionality', function () {
      it('should accept any string that is allowed', function () {
        expect(filterExact('allowed', ['allowed'])).to.eql('allowed');
        expect(filterExact('', [''])).to.eql('');
        expect(filterExact(' ', [' '])).to.eql(' ');
        expect(filterExact('0', ['0'])).to.eql('0');
        expect(filterExact('false', ['false'])).to.eql('false');
      });

      it('should reject any string that is not in the allowed list', function () {
        expect(filterExact('rejected', ['allowed'])).to.eql(null);
        expect(filterExact('rejected', [])).to.eql(null);
        expect(filterExact('', ['allowed'])).to.eql(null);
        expect(filterExact('', [])).to.eql(null);
      });

      it('should accept all matching texts', function () {
        fc.assert(
          fc.property(fc.array(fc.string()), (allowedTexts) => {
            for (const text of allowedTexts) {
              expect(filterExact(text, allowedTexts)).to.eql(text);
            }
          }),
        );
      });

      it('should drop all non-matching untrustedTexts', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            expect(filterExact(untrustedText, [])).to.eql(null);
            expect(
              filterExact(untrustedText, [untrustedText + 'force_mismatch']),
            ).to.eql(null);
            expect(
              filterExact(untrustedText, [
                untrustedText + 'force_mismatch',
                untrustedText + 'also_force_mismatch',
              ]),
            ).to.eql(null);
          }),
        );
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string, [string]] (more parameters are ignored)', function () {
        expect(() => filterExact()).to.throw();
        expect(() => filterExact({ wrong: 'types' }, 42)).to.throw();
        expect(() => filterExact('text', 42).to.throw());
        expect(() => filterExact('text', '42').to.throw());
        expect(() => filterExact(42, null).to.throw());
      });

      it('should not fail on well-formed but arbitrary text', function () {
        fc.assert(
          fc.property(
            fc.fullUnicodeString(),
            fc.array(fc.string()),
            (untrustedText, allowedValues) => {
              expect(filterExact(untrustedText, allowedValues)).to.be.oneOf([
                untrustedText,
                null,
              ]);
            },
          ),
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

      it('should return null for non URLs', function () {
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

      it('should allow to remove URL hashes', function () {
        expect(
          split('https://example.test/foo/bar?x=1&y=2#some-hash', '#', 0),
        ).to.eql('https://example.test/foo/bar?x=1&y=2');
        expect(split('https://example.test/#', '#', 0)).to.eql(
          'https://example.test/',
        );
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string, string, integer] (more parameters are ignored)', function () {
        expect(() => split()).to.throw();
        expect(() => split('too few arguments')).to.throw();
        expect(() => split('too few arguments', 'still too few')).to.throw();
        expect(() => split({ wrong: 'types' }, 42, 'wrong')).to.throw();
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

    describe('handling of native properties', function () {
      // The observation is that some property names are implicitly provided:
      //
      // x = '';
      // !!x['foo']       --> false
      // !!x['bar']       --> false
      // !!x['toString']  --> true
      // !!x['__proto__'] --> true
      [
        // this list is incomplete, but should cover all primitive
        '__proto__',
        'constructor',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString',
        'toString',
        'valueOf',
        'toExponential',
        'toFixed',
        'toPrecision',
      ].forEach((field) => {
        it(`should ignore the inherited ${field} field`, function () {
          expect(uut('"a"', field, true)).to.eql('');
          expect(uut('["a"]', field, true)).to.eql('');
          expect(uut('{"a":"b"}', field, true)).to.eql('');
        });
      });

      // This is mostly documenting the status quo, which results from
      // Object.has('foo', 'length') being true.
      //
      // Since this is so obscure, we should not built behavior on top of it.
      // However, it is not opening up attacks, so there is also not much
      // benefit in having extra logic to handle this situation.
      it('should gracefully handle the implicit "length" field', function () {
        expect(uut('"foo"', 'length')).to.eql('3');
        expect(uut('"foo"', 'length', true)).to.eql('3');
      });

      it('should support an explicit "length" field', function () {
        expect(uut('{"height": 17, "length": 42}', 'length')).to.eql('42');
        expect(uut('{"height": 17, "length": 42}', 'length', true)).to.eql(
          '42',
        );
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

  describe('#trim', function () {
    let trim;

    beforeEach(function () {
      trim = lookupBuiltinTransform('trim');
    });

    describe('core functionality', function () {
      it('"foo" -> "foo"', function () {
        expect(trim('foo')).to.eql('foo');
      });

      it('"foo bar" -> "foo bar"', function () {
        expect(trim('foo bar')).to.eql('foo bar');
      });

      it('"  foo  " -> "foo"', function () {
        expect(trim('  foo  ', '_', 0)).to.eql('foo');
      });

      it('"" -> ""', function () {
        expect(trim('')).to.eql('');
      });
    });

    describe('robustness on untrusted data', function () {
      it('should fail if input is not [string] (more parameters are ignored)', function () {
        expect(() => trim()).to.throw();
        expect(() => trim({ wrong: 'types' })).to.throw();
      });

      it('should work on arbitrary strings and behave like String.trim', function () {
        fc.assert(
          fc.property(fc.fullUnicodeString(), (untrustedText) => {
            const result = trim(untrustedText);
            expect(result).to.be.a('string').and.to.eql(untrustedText.trim());
          }),
        );
      });
    });
  });
});

describe('Patterns', function () {
  describe('#createDoublefetchRequest', function () {
    it('should default to an empty request', function () {
      const uut = new Patterns();
      const msgType = 'some-message-type';
      const url = 'https://example.test/foo';

      // message type is known, but has no explicit config
      uut.updatePatterns({
        [msgType]: {
          input: {},
          output: {},
        },
      });
      expect(uut.createDoublefetchRequest(msgType, url)).to.eql({ url });
    });

    it('should return null if the message type is unknown', function () {
      const uut = new Patterns();
      const msgType = 'some-message-type';
      const url = 'https://example.test/foo';

      uut.updatePatterns({});
      expect(uut.createDoublefetchRequest(msgType, url)).to.eql(null);
    });

    // General helper to verify that the doublefetch section from the
    // pattern rules is correctly converted to a doublefetch request.
    function check({ config: doublefetch, result: outputForUrl }) {
      expect(doublefetch).to.be.an('object');
      expect(outputForUrl).to.be.a('function');

      const uut = new Patterns();
      const msgType = 'some-message-type';
      const url = 'https://example.test/foo';

      uut.updatePatterns({
        [msgType]: {
          doublefetch,
          input: {},
          output: {},
        },
      });

      const actual = uut.createDoublefetchRequest(msgType, url);
      const expected = outputForUrl(url);
      expect(actual).to.eql(expected);
    }

    describe('should translate followRedirects=true to redirect=follow', function () {
      it('in a flat example', function () {
        check({
          config: {
            followRedirects: true,
          },
          result: (url) => ({
            url,
            redirect: 'follow',
          }),
        });
      });

      it('in a nested example', function () {
        check({
          config: {
            onError: {
              followRedirects: true,
            },
          },
          result: (url) => ({
            url,
            onError: {
              redirect: 'follow',
            },
          }),
        });
      });
    });

    describe('should forward', function () {
      // Specialized function for the common use case that the doublefetch
      // config in the patterns will be identical to the doublefetch request.
      function shouldForward(config) {
        check({
          config,
          result: (url) => ({
            url,
            ...config,
          }),
        });
      }

      it('empty configs', function () {
        shouldForward({});
      });

      it('header overwrites', function () {
        shouldForward({
          headers: {
            foo: 'foo',
            bar: 'bar',
          },
        });
      });

      it('simple steps', function () {
        shouldForward({
          steps: [{ dynamic: true }, {}],
        });
      });

      it('emptyHtml', function () {
        shouldForward({ emptyHtml: true });
        shouldForward({ emptyHtml: false });
      });

      it('onError', function () {
        shouldForward({ onError: {} });
        shouldForward({ onError: { emptyHtml: true } });
        shouldForward({ onError: { headers: { foo: 'foo' } } });
      });
    });

    describe('should drop unexpected fields', function () {
      function shouldDrop(config) {
        check({
          config,
          result: (url) => ({ url }),
        });
      }

      function shouldOnlyKeep(config, keep) {
        check({
          config,
          result: (url) => ({ url, ...keep }),
        });
      }

      it('in a flat example', function () {
        shouldDrop({ foo: 'unexpected field' });
        shouldDrop({ __proto__: { admin: true } });
      });

      it('in a nested example', function () {
        shouldOnlyKeep(
          { onError: { foo: 'unexpected field' } },
          { onError: {} },
        );
        shouldOnlyKeep(
          { onError: { __proto__: { admin: true } } },
          { onError: {} },
        );
      });
    });
  });
});
