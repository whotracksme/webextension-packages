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

import {
  replacePlaceholders,
  findPlaceholders,
  buildDependencyGraph,
} from '../src/http.js';

describe('#replacePlaceholders', function () {
  const emptyContext = {
    cookie: new Map(),
  };

  const cookie_x_to_y = {
    cookie: new Map([['x', 'y']]),
  };

  it('should work with empty strings', function () {
    expect(replacePlaceholders({ key: '' }, emptyContext)).to.eql({ key: '' });
  });

  it('should work with expressions without placeholders', function () {
    expect(replacePlaceholders({ key: 'foo' }, emptyContext)).to.eql({
      key: 'foo',
    });
  });

  it('should replace one placeholder in the start', function () {
    expect(
      replacePlaceholders({ key: '{{cookie:x}};bar' }, cookie_x_to_y),
    ).to.eql({ key: 'y;bar' });
  });

  it('should replace one placeholder in the middle', function () {
    expect(
      replacePlaceholders({ key: 'foo={{cookie:x}};bar' }, cookie_x_to_y),
    ).to.eql({ key: 'foo=y;bar' });
  });

  it('should replace one placeholder at the end', function () {
    expect(
      replacePlaceholders({ key: 'foo={{cookie:x}}' }, cookie_x_to_y),
    ).to.eql({ key: 'foo=y' });
  });

  it('should support multiple placeholders', function () {
    expect(
      replacePlaceholders(
        { key: 'foo={{cookie:x}};bar={{cookie:x}}' },
        cookie_x_to_y,
      ),
    ).to.eql({ key: 'foo=y;bar=y' });
  });

  describe('should support short-circut placeholders with "||"', function () {
    it('with left-side argument present', function () {
      expect(
        replacePlaceholders(
          { key: 'foo={{cookie:x||cookie:MISSING}}' },
          cookie_x_to_y,
        ),
      ).to.eql({ key: 'foo=y' });
    });

    it('with right-side argument present', function () {
      expect(
        replacePlaceholders(
          { key: 'foo={{cookie:MISSING||cookie:x}}' },
          cookie_x_to_y,
        ),
      ).to.eql({ key: 'foo=y' });
    });

    it('falling back to empty if none arguments are present', function () {
      expect(
        replacePlaceholders(
          { key: 'foo={{cookie:MISSING||cookie:ALSO_MISSING}}' },
          cookie_x_to_y,
        ),
      ).to.eql({ key: 'foo=' });
    });

    it('left-argument should win', function () {
      const ctx = {
        cookie: new Map([
          ['left', 'left-won'],
          ['right', 'right-won'],
        ]),
      };
      expect(
        replacePlaceholders({ key: 'foo={{cookie:left||cookie:right}}' }, ctx),
      ).to.eql({ key: 'foo=left-won' });
    });

    it('blank values do not win, even if present', function () {
      const ctx = {
        cookie: new Map([
          ['left', ''],
          ['right', 'right'],
        ]),
      };
      expect(
        replacePlaceholders({ key: 'foo={{cookie:left||cookie:right}}' }, ctx),
      ).to.eql({ key: 'foo=right' });
    });
  });
});

describe('#findPlaceholders', function () {
  it('should work with empty strings', function () {
    expect(findPlaceholders('')).to.eql([]);
  });

  it('should work when there are no placeholders', function () {
    expect(findPlaceholders('foo')).to.eql([]);
  });

  it('should find one placeholder', function () {
    expect(findPlaceholders('x={{cookie:foo}}')).to.eql(['cookie:foo']);
  });

  it('should find multiple placeholders', function () {
    expect(findPlaceholders('x={{foo}};y={{bar}}')).to.eql(['foo', 'bar']);
  });

  it('should support the reuse of placeholders', function () {
    expect(findPlaceholders('x={{foo}};y={{foo}}')).to.eql(['foo', 'foo']);
  });

  it('should support (ill-formed) empty placeholders', function () {
    expect(findPlaceholders('x={{}}')).to.eql(['']);
  });

  it('should support broken texts gracefully', function () {
    expect(findPlaceholders('x={{} }')).to.eql([]);
    expect(findPlaceholders('x={{ {{}}')).to.eql([' {{']);
    expect(findPlaceholders('x={{')).to.eql([]);
    expect(findPlaceholders('x={{foo')).to.eql([]);
    expect(findPlaceholders('}}{{')).to.eql([]);
  });

  describe('should support short-circuit evaluation with "||"', function () {
    expect(findPlaceholders('abc={{foo||bar}}')).to.eql(['foo||bar']);
  });
});

describe('#buildDependencyGraph', function () {
  it('should be immediately ready if there is no next step', function () {
    expect(buildDependencyGraph(undefined).allReady).to.eql(true);
  });

  it('should be immediately ready if there are no dependencies', function () {
    expect(buildDependencyGraph({}).allReady).to.eql(true);
    expect(
      buildDependencyGraph({
        headers: {},
      }).allReady,
    ).to.eql(true);
    expect(
      buildDependencyGraph({
        headers: {
          SomeHeader: 'some text, but no placeholder',
        },
      }).allReady,
    ).to.eql(true);
  });

  it('should not resolve immediately, but when its single dependency is resolved', function () {
    const graph = buildDependencyGraph({
      headers: {
        Cookie: 'some text, with {{cookie:FOO}} placeholder',
      },
    });
    expect(graph.allReady).to.eql(false);

    let onReadyCalled = 0;
    graph.onReady = () => {
      onReadyCalled += 1;
    };

    graph.onChange('cookie', 'FOO', 'dummy value');
    expect(onReadyCalled).to.eql(1);
    expect(graph.allReady).to.eql(true);
  });

  it('should not resolve when both dependencies are ready', function () {
    const graph = buildDependencyGraph({
      headers: {
        Cookie: 'first={{cookie:X}};second={{cookie:Y}}',
      },
    });
    expect(graph.allReady).to.eql(false);

    let onReadyCalled = 0;
    graph.onReady = () => {
      onReadyCalled += 1;
    };

    // not yet resolved, one missing
    graph.onChange('cookie', 'X', 'dummy value');
    expect(onReadyCalled).to.eql(0);
    expect(graph.allReady).to.eql(false);

    // ... but now both are ready
    graph.onChange('cookie', 'Y', 'dummy value');
    expect(onReadyCalled).to.eql(1);
    expect(graph.allReady).to.eql(true);
  });

  it('should support short-circuit "||" expressions', function () {
    const graph = buildDependencyGraph({
      headers: {
        Cookie:
          'first={{cookie:X1||cookie:X2}};second={{cookie:Y1||cookie:Y2}}',
      },
    });
    expect(graph.allReady).to.eql(false);

    let onReadyCalled = 0;
    graph.onReady = () => {
      onReadyCalled += 1;
    };

    // this resolves the first placeholder
    graph.onChange('cookie', 'X1', 'dummy value');
    expect(onReadyCalled).to.eql(0);
    expect(graph.allReady).to.eql(false);

    // this resolves the second placeholder
    graph.onChange('cookie', 'Y2', 'dummy value');
    expect(onReadyCalled).to.eql(1);
    expect(graph.allReady).to.eql(true);
  });
});
