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

import { expect, assert } from 'chai';
import * as fc from 'fast-check';

import Sanitizer from '../src/sanitizer';
import {
  TemporarilyUnableToFetchUrlError,
  PermanentlyUnableToFetchUrlError,
} from '../src/errors';
import DoublefetchPageHandler, {
  titlesMatchAfterDoublefetch,
  sanitizeActivity,
} from '../src/doublefetch-page-handler.js';

class JobSchedulerMock {
  registerHandler(type, handler, config) {
    expect(type).to.eql('doublefetch-page');
    expect(handler).to.be.a('function');
    if (config) {
      expect(config).to.be.an('object');
    }
  }
}

class CountryProviderMock {
  getSafeCountryCode() {
    return '--';
  }
}

class NewPageApproverMock {
  constructor() {
    this.privatePages = new Set();
  }

  async mightBeMarkedAsPrivate(url) {
    expect(url).to.be.a('string');
    return this.privatePages.has(url);
  }

  async markAsPrivate(url) {
    expect(url).to.be.a('string');
    this.privatePages.add(url);
  }
}

class PageFetcherMock {
  constructor(pageMocks = {}) {
    this._pageMocks = pageMocks; // url to (PageStructure or Error)
    this._requestedUrls = [];
  }

  reconfig(urlsToResults) {
    this._pageMocks = urlsToResults;
    this._requestedUrls = [];
  }

  expectAllFetchedOnce() {
    const expected = Object.keys(this._pageMocks).toSorted();
    const actual = [...new Set(this._requestedUrls)].toSorted();
    expect(actual).to.eql(expected);
  }

  async doublefetchUrl(url) {
    this._requestedUrls.push(url);
    const result = this._pageMocks[url];
    if (!result) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    if (result.isPermanentError) {
      return { rejectReason: `unable to fetch page (details: ${result})` };
    }
    if (result instanceof Error) {
      throw result;
    }
    return { pageStructure: result };
  }
}

function relaxedSafePageEqual(safePage_, expectedSafePage_) {
  const { aggregator: aggregator_, ...safePage } = safePage_;
  const { aggregator: expectedAggregator_, ...expectedSafePage } =
    expectedSafePage_;
  expect(safePage).to.eql(expectedSafePage);

  // When comparing the aggregated activity, values like the activity will
  // also be approximations of their input, because random noisy is applied.
  if (expectedAggregator_) {
    const { activity, aggregator } = aggregator_;
    const { activity: expectedActivity, expectedAggregator } =
      expectedAggregator_;
    if (activity !== expectedActivity) {
      expect(+activity).to.be.closeTo(+expectedActivity, 0.1);
    }
    expect(aggregator).to.eql(expectedAggregator);
  }
}

describe('DoublefetchPageHandler', function () {
  let uut;
  let countryProvider;
  let jobScheduler;
  let sanitizer;
  let newPageApprover;
  let pageFetcherMock;

  beforeEach(function () {
    jobScheduler = new JobSchedulerMock();
    countryProvider = new CountryProviderMock();
    sanitizer = new Sanitizer(countryProvider);
    newPageApprover = new NewPageApproverMock();
    pageFetcherMock = new PageFetcherMock();
    uut = new DoublefetchPageHandler({
      jobScheduler,
      sanitizer,
      newPageApprover,
      pageFetcherProvider: () => pageFetcherMock,
    });
  });

  afterEach(function () {
    uut = null;
  });

  describe('when given a website without canonical URL', function () {
    it('should allow a safe page like https://software.codidact.com/posts/291498', async function () {
      const page = {
        aggregator: {
          firstSeenAt: 1717420575480,
          lastSeenAt: 1717420575483,
          lastWrittenAt: 1717420575583,
          activity: 0.005740833333333333,
        },
        url: 'https://software.codidact.com/posts/291498',
        status: 'complete',
        pageLoadMethod: 'full-page-load',
        title: 'Software Development - Check if a file exists in Node.js',
        preDoublefetch: {
          meta: {
            canonicalUrl: null,
            contentType: 'text/html',
            language: 'en',
            og: {
              image:
                'https://software.codidact.comhttps://codidact.com/community-assets/software/logo-large.png',
              title: 'Check if a file exists in Node.js',
              url: 'https://software.codidact.com/posts/291498',
            },
          },
          noindex: false,
          requestedIndex: false,
          title: 'Software Development - Check if a file exists in Node.js',
          url: 'https://software.codidact.com/posts/291498',
          lastUpdatedAt: 1717420575479,
        },
        lastUpdatedAt: 1717420575480,
        lang: 'en',
      };

      pageFetcherMock.reconfig({
        'https://software.codidact.com/posts/291498': {
          title:
            '\n  Software Development - Check if a file exists in Node.js\n',
          meta: {
            canonicalUrl: null,
            language: 'en',
            contentType: null,
            og: {
              title: 'Check if a file exists in Node.js',
              url: 'https://software.codidact.com/posts/291498',
              image:
                'https://software.codidact.comhttps://codidact.com/community-assets/software/logo-large.png',
            },
          },
          noindex: false,
          requestedIndex: false,
        },
      });

      const { ok, safePage } = await uut.runJob(page);

      expect(ok).to.be.true;
      pageFetcherMock.expectAllFetchedOnce();
      relaxedSafePageEqual(safePage, {
        url: 'https://software.codidact.com/posts/291498',
        title: 'Software Development - Check if a file exists in Node.js',
        requestedIndex: false,
        lang: {
          html: 'en',
          detect: 'en',
        },
        aggregator: {
          activity: '0.0062',
        },
        canonicalUrl: null,
      });
    });
  });

  describe('when given a website with canonical URL', function () {
    it('should allow a safe page like https://www.ghostery.com/ (coming from https://www.ghostery.com/)', async function () {
      const page = {
        aggregator: {
          firstSeenAt: 1717021430155,
          lastSeenAt: 1717021430158,
          lastWrittenAt: 1717021430395,
          activity: 0.005635,
        },
        url: 'https://www.ghostery.com/',
        status: 'complete',
        pageLoadMethod: 'full-page-load',
        title: 'Best Ad Blocker & Privacy Browser | Ghostery',
        redirects: [
          {
            from: 'https://ghostery.com/',
            to: 'https://www.ghostery.com/',
            statusCode: 301,
          },
        ],
        preDoublefetch: {
          meta: {
            canonicalUrl: 'https://www.ghostery.com/',
            contentType: 'text/html',
            language: 'en',
            og: {
              image:
                'https://www.ghostery.com/assets/ghostery-mobile-5b87b0a50ae994a6526277563ed73ab9ee96bb34506cf30b11b19bfc0d365f0f.png',
              title: 'Best Ad Blocker & Privacy Browser',
              url: 'https://www.ghostery.com/',
            },
          },
          noindex: false,
          requestedIndex: false,
          title: 'Best Ad Blocker & Privacy Browser | Ghostery',
          url: 'https://www.ghostery.com/',
          lastUpdatedAt: 1717021430154,
        },
        lastUpdatedAt: 1717021430156,
        lang: 'en',
      };

      pageFetcherMock.reconfig({
        'https://www.ghostery.com/': {
          title: 'Best Ad Blocker & Privacy Browser | Ghostery',
          meta: {
            canonicalUrl: 'https://www.ghostery.com/',
            language: 'en',
            contentType: null,
            og: {
              title: 'Best Ad Blocker & Privacy Browser',
              url: 'https://www.ghostery.com/',
              image:
                'https://www.ghostery.com/assets/ghostery-mobile-5b87b0a50ae994a6526277563ed73ab9ee96bb34506cf30b11b19bfc0d365f0f.png',
            },
          },
          noindex: false,
          requestedIndex: false,
        },
      });

      const { ok, safePage } = await uut.runJob(page);

      expect(ok).to.be.true;
      pageFetcherMock.expectAllFetchedOnce();
      relaxedSafePageEqual(safePage, {
        url: 'https://www.ghostery.com/',
        title: 'Best Ad Blocker & Privacy Browser | Ghostery',
        requestedIndex: false,
        lang: {
          html: 'en',
          detect: 'en',
        },
        aggregator: {
          activity: '0.0056',
        },
        canonicalUrl: 'https://www.ghostery.com/',
        redirects: [
          {
            from: 'https://ghostery.com/',
            to: 'https://www.ghostery.com/',
            statusCode: 301,
          },
        ],
      });
    });
  });

  describe('when a page indexed by search engine, has a canonical URL, and signals it wants to be shared', function () {
    it('should allow a safe Wikipedia page like https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp', async function () {
      const page = {
        aggregator: {
          firstSeenAt: 1717193683762,
          lastSeenAt: 1717193683763,
          lastWrittenAt: 1717193739746,
          activity: 0.05103,
        },
        url: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp',
        status: 'complete',
        pageLoadMethod: 'full-page-load',
        title: 'Jürgen Klopp – Wikipedia',
        search: {
          category: 'go',
          query: 'jürgen klopp',
          depth: 1,
        },
        ref: 'https://www.google.com/search?gs_ssp=eJzj4tLP1TcwMTOOLzA1YPTizTq8pyg9NU8hOye_oAAAcLEJFA&q=j%C3%BCrgen+klopp&oq=&gs_lcrp=EgZjaHJvbWUqDwgHEC4YAxiPARi0AhjqAjIJCAAQRRg7GMIDMhEIARAAGAMYQhiPARi0AhjqAjIRCAIQABgDGEIYjwEYtAIY6gIyEQgDEAAYAxhCGI8BGLQCGOoCMg8IBBAuGAMYjwEYtAIY6gIyEQgFEAAYAxhCGI8BGLQCGOoCMg8IBhAuGAMYjwEYtAIY6gIyDwgHEC4YAxiPARi0AhjqAtIBDDc4NTEwODA2ajBqN6gCCLACAQ&sourceid=chrome&ie=UTF-8',
        preDoublefetch: {
          meta: {
            canonicalUrl: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp',
            contentType: 'text/html',
            language: 'de',
            og: {
              image:
                'https://upload.wikimedia.org/wikipedia/commons/8/81/J%C3%BCrgen_Klopp%2C_Liverpool_vs._Chelsea%2C_UEFA_Super_Cup_2019-08-14_04.jpg',
              title: 'Jürgen Klopp – Wikipedia',
            },
          },
          noindex: false,
          requestedIndex: true,
          title: 'Jürgen Klopp – Wikipedia',
          url: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp',
          lastUpdatedAt: 1717193683762,
        },
        lastUpdatedAt: 1717193683763,
        lang: 'de',
      };

      pageFetcherMock.reconfig({
        'https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp': {
          title: 'Jürgen Klopp – Wikipedia',
          meta: {
            canonicalUrl: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp',
            language: 'de',
            contentType: null,
            og: {
              title: 'Jürgen Klopp – Wikipedia',
              image:
                'https://upload.wikimedia.org/wikipedia/commons/8/81/J%C3%BCrgen_Klopp%2C_Liverpool_vs._Chelsea%2C_UEFA_Super_Cup_2019-08-14_04.jpg',
            },
          },
          noindex: false,
          requestedIndex: true,
        },
      });

      const { ok, safePage } = await uut.runJob(page);

      expect(ok).to.be.true;
      pageFetcherMock.expectAllFetchedOnce();
      relaxedSafePageEqual(safePage, {
        url: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp',
        title: 'Jürgen Klopp – Wikipedia',
        requestedIndex: true,
        lang: {
          html: 'de',
          detect: 'de',
        },
        aggregator: {
          activity: '0.0510',
        },
        canonicalUrl: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Klopp',
        ref: 'https://www.google.com/ (PROTECTED)',
        search: {
          query: 'jürgen klopp',
          category: 'go',
          depth: 1,
        },
      });
    });
  });

  // YouTube is an example where this happens. Some single-page navigations update the
  // canonical URL in the DOM after navigations, but every page. The canonical URL
  // can only be trusted in after full page load. Either by a normal navigation, or
  // in a double-fetch request.
  describe('when canonical URLs do not get updated on history navigations', function () {
    it('should prefer the canonical URL in the doublefetch request', async function () {
      const page = {
        aggregator: {
          firstSeenAt: 1716993609947,
          lastSeenAt: 1716993610906,
          lastWrittenAt: 1716993616542,
          activity: 0.00962,
        },
        url: 'https://www.youtube.com/watch?v=y5uAf4ccrtE',
        status: 'complete',
        pageLoadMethod: 'history-navigation',
        title:
          'Eine kurze Geschichte über… das Mittelalter | Terra X | MrWissen2go - YouTube',
        ref: 'https://www.youtube.com/watch?v=Yzk-28bBKGs',
        preDoublefetch: {
          meta: {
            canonicalUrl: 'https://www.youtube.com/watch?v=hLT-W55y-LI',
            contentType: 'text/html',
            language: 'en',
            og: {
              image: 'https://i.ytimg.com/vi/hLT-W55y-LI/maxresdefault.jpg',
              title:
                'Vom Bürokratiewahnsinn im Wohnungsbau. Viele Normen - Teure Wohnungen? | SWR Doku',
              url: 'https://www.youtube.com/watch?v=hLT-W55y-LI',
            },
          },
          noindex: false,
          requestedIndex: false,
          title:
            'Feste Heimat: Wie lebte es sich auf einer Burg? | Ganze Folge Terra X - YouTube',
          url: 'https://www.youtube.com/watch?v=y5uAf4ccrtE',
          lastUpdatedAt: 1716993609947,
        },
        lastUpdatedAt: 1716993610906,
        lang: 'en',
      };

      pageFetcherMock.reconfig({
        'https://www.youtube.com/watch?v=hLT-W55y-LI': {
          title:
            'Vom Bürokratiewahnsinn im Wohnungsbau. Viele Normen - Teure Wohnungen? | SWR Doku - YouTube',
          meta: {
            canonicalUrl: 'https://www.youtube.com/watch?v=hLT-W55y-LI',
            language: 'en',
            contentType: null,
            og: {
              title:
                'Vom Bürokratiewahnsinn im Wohnungsbau. Viele Normen - Teure Wohnungen? | SWR Doku',
              url: 'https://www.youtube.com/watch?v=hLT-W55y-LI',
              image: 'https://i.ytimg.com/vi/hLT-W55y-LI/maxresdefault.jpg',
            },
          },
          noindex: false,
          requestedIndex: false,
        },
        'https://www.youtube.com/watch?v=y5uAf4ccrtE': {
          title:
            'Eine kurze Geschichte über… das Mittelalter | Terra X | MrWissen2go - YouTube',
          meta: {
            canonicalUrl: 'https://www.youtube.com/watch?v=y5uAf4ccrtE',
            language: 'en',
            contentType: null,
            og: {
              title:
                'Eine kurze Geschichte über… das Mittelalter | Terra X | MrWissen2go',
              url: 'https://www.youtube.com/watch?v=y5uAf4ccrtE',
              image: 'https://i.ytimg.com/vi/y5uAf4ccrtE/maxresdefault.jpg',
            },
          },
          noindex: false,
          requestedIndex: false,
        },
      });

      const { ok, safePage } = await uut.runJob(page);

      expect(ok).to.be.true;
      pageFetcherMock.expectAllFetchedOnce();
      relaxedSafePageEqual(safePage, {
        url: 'https://www.youtube.com/watch?v=y5uAf4ccrtE',
        title:
          'Eine kurze Geschichte über… das Mittelalter | Terra X | MrWissen2go - YouTube',
        requestedIndex: false,
        lang: {
          html: 'en',
          detect: 'en',
        },
        aggregator: {
          activity: '0.0096',
        },
        ref: 'https://www.youtube.com/ (PROTECTED)',
        canonicalUrl: 'https://www.youtube.com/watch?v=y5uAf4ccrtE',
      });
    });
  });

  describe('[error handling]', function () {
    function somePageWithoutCanonicalUrl() {
      return {
        aggregator: {
          firstSeenAt: 1717422627782,
          lastSeenAt: 1717422627784,
          lastWrittenAt: 1717422627883,
          activity: 0.004188333333333333,
        },
        url: 'https://www.example.com/',
        status: 'complete',
        pageLoadMethod: 'full-page-load',
        title: 'Example Domain',
        preDoublefetch: {
          meta: {
            canonicalUrl: null,
            contentType: 'text/html',
            language: null,
            og: {},
          },
          noindex: false,
          requestedIndex: false,
          title: 'Example Domain',
          url: 'https://www.example.com/',
          lastUpdatedAt: 1717422627782,
        },
        lastUpdatedAt: 1717422627784,
        lang: '--',
      };
    }

    it('should fail with a non-permanent error when a page is temporarily not reachable', async function () {
      const page = somePageWithoutCanonicalUrl();
      pageFetcherMock.reconfig({
        [page.url]: new TemporarilyUnableToFetchUrlError(),
      });

      try {
        await uut.runJob(page);
      } catch (err) {
        expect(err.isPermanentError).to.be.false;
        return;
      }
      assert.fail('Expected to throw');
    });

    it('should drop the page if it is permanently not reachable', async function () {
      const page = somePageWithoutCanonicalUrl();
      pageFetcherMock.reconfig({
        [page.url]: new PermanentlyUnableToFetchUrlError(),
      });

      const { ok, details } = await uut.runJob(page);

      expect(ok).to.be.false;
      expect(details).to.be.a('string').that.is.not.empty;
    });
  });
});

describe('#titlesMatchAfterDoublefetch', function () {
  function shouldMatch(before, after) {
    if (!titlesMatchAfterDoublefetch({ before, after })) {
      expect.fail(
        `Expected titles to match, but they did not:\n` +
          `before: <<${before}>>\n` +
          `after:  <<${after}>>`,
      );
    }
  }

  function shouldNotMatch(before, after) {
    if (titlesMatchAfterDoublefetch({ before, after })) {
      expect.fail(
        `Did not expect titles to match, but they did:\n` +
          `before: <<${before}>>\n` +
          `after:  <<${after}>>`,
      );
    }
  }

  it('should always reject pages without titles', function () {
    shouldNotMatch({ before: '', after: '' });
    shouldNotMatch({ before: '', after: 'foo' });
    shouldNotMatch({ before: undefined, after: '' });
    shouldNotMatch({ before: null, after: '' });
  });

  it('should accept perfect matches', function () {
    shouldNotMatch({ before: 'Some title', after: 'Some title' });
  });

  it('should reject completely different titles', function () {
    shouldNotMatch({
      before: 'Some title (XYZ)',
      after: 'This is some unrelated title',
    });
  });

  it('should reject completely different titles', function () {
    shouldNotMatch({
      before: 'Some title (XYZ)',
      after: 'This is some unrelated title',
    });
  });

  describe('should not do precise matching for uppercase and lowercase letters', function () {
    for (const { before, after } of [
      { before: 'Example Search - YouTube', after: 'example search - YouTube' },
    ]) {
      it(`- ${before} --> ${after}`, function () {
        shouldMatch(before, after);
      });
    }
  });

  describe('should accept titles that are subsets of doublefetch, but not vice versa', function () {
    for (const { before, after } of [
      {
        // Note: might not be the best example, since this is still likely to
        // be dropped since it could trigger the email detector. But Mastodon
        // is an example where the title can be more detailed if you are not
        // logged in.
        before: 'muenchen.social - Die erste Mastodon Instanz für München',
        after:
          'Max Mustermann (@maxmustermann@muenchen.social) - muenchen.social - Die erste Mastodon Instanz für München',
      },
    ]) {
      it(`- ${before} --> ${after}`, function () {
        shouldMatch(before, after);
      });
      it(`- ${before} --> ${after} (swapping orders!)`, function () {
        shouldNotMatch(after, before);
      });
    }
  });

  describe('when the encoding is broken after doublefetch', function () {
    describe('should have some tolerance for broken characters', function () {
      for (const { before, after } of [
        {
          before: 'Imputada la de Sánchez (presuntamente) | España',
          after: 'Imputada la de S�nchez (presuntamente) | Espa�a',
        },
        {
          before: 'Opinión. Editoriales y columnas | EL MUNDO',
          after: '\nOpini�n. Editoriales y columnas | EL MUNDO ',
        },
        {
          before:
            'Zaragoza reclama el impago de 28 millones de euros en fondos europeos al Gobierno y amenaza con denunciarlo en Bruselas | Aragón',
          after:
            'Zaragoza reclama el impago de 28 millones de euros en fondos europeos al Gobierno y amenaza con denunciarlo en Bruselas | Arag�n',
        },
        {
          before: 'Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nCatalu�a - Noticias de Catalu�a | EL MUNDO ',
        },
        {
          before: 'Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nCatalu�a - Noticias de Cataluña | EL MUNDO ',
        },
        {
          before: 'AKŞAM - Haberler - Son Dakika Haberleri',
          after: 'AK�AM - Haberler - Son Dakika Haberleri',
        },
      ]) {
        it(`- ${before} --> ${after}`, function () {
          shouldMatch(before, after);
        });
      }
    });

    describe('should have some tolerance even if it is not consistently broken', function () {
      for (const { before, after } of [
        {
          before: 'Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nCataluña - Noticias de Cataluña | EL MUNDO ',
        },
        {
          before: 'Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nCatalu�a - Noticias de Cataluña | EL MUNDO ',
        },
        {
          before: 'Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nCataluña - Noticias de Catalu�a | EL MUNDO ',
        },
        {
          before: 'Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nCatalu�a - Noticias de Catalu�a | EL MUNDO ',
        },
        {
          before: 'öäÖÄß€ Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nöäÖÄß€ Catalu�a - Noticias de Catalu�a | EL MUNDO ',
        },
        {
          before: 'öäÖÄß€ Cataluña - Noticias de Cataluña | EL MUNDO',
          after: '\nöäÖÄ�€ Catalu�a - Noticias de Catalu�a | EL MUNDO ',
        },
      ]) {
        it(`- ${before} --> ${after}`, function () {
          shouldMatch(before, after);
        });
      }
    });

    describe('should only tolerate encoding errors for non-ascii characters', function () {
      for (const { before, after } of [
        {
          before: 'This is a pure ascii text',
          after: 'This is a p�re ascii text',
        },
        {
          before: 'Imputada la de Sánchez (presuntamente) | España',
          after: '�mputada la de S�nchez (presuntamente) | Espa�a',
        },
      ]) {
        it(`- ${before} --> ${after}`, function () {
          shouldNotMatch(before, after);
        });
      }
    });

    describe('should still reject if doublefetch encoding errors destroy too much', function () {
      for (const { before, after } of [
        { before: 'á', after: '�' },
        {
          before: 'Imputada la de Sánchez (presuntamente) | España',
          after: '�������� �� �� ������� (presuntamente) | Espa�a',
        },
      ]) {
        it(`- ${before} --> ${after}`, function () {
          shouldNotMatch(before, after);
        });
      }
    });
  });

  describe('should tolerate removing a limited amount of chars in a longer title', function () {
    describe('if most of the text is still preserved', function () {
      for (const { before, after } of [
        {
          before:
            'Darts-WM 2025: Alle Spiele heute live in TV und Stream schauen - COMPUTER BILD',
          after:
            'Darts-WM 2025: Alle Spiele live in TV und Stream schauen - COMPUTER BILD',
        },
        {
          before:
            'Darts-WM 2025: Alle Spiele heute live in TV und Stream schauen - COMPUTER BILD',
          after:
            'Darts-WM: Alle Spiele heute live in TV und Stream schauen - COMPUTER BILD',
        },
      ]) {
        it(`- ${before} --> ${after}`, function () {
          shouldMatch(before, after);
        });
      }
    });

    describe('but reject if too much is removed', function () {
      for (const { before, after } of [
        {
          before:
            'Darts-WM 2025: Alle Spiele heute live in TV und Stream schauen - COMPUTER BILD',
          after: 'Darts-WM 2025',
        },
        {
          before:
            'Darts-WM 2025: Alle Spiele heute live in TV und Stream schauen - COMPUTER BILD',
          after: 'COMPUTER BILD',
        },
      ]) {
        it(`- ${before} --> ${after}`, function () {
          shouldNotMatch(before, after);
        });
      }
    });
  });
});

describe('#sanitizeActivity', function () {
  function ensureInRange(x) {
    expect(x).to.be.a('string');
    expect(Number(x)).to.be.within(0, 1);
  }

  it('should map bad inputs to "0"', function () {
    expect(sanitizeActivity(null)).to.eql('0');
    expect(sanitizeActivity(undefined)).to.eql('0');
    expect(sanitizeActivity({})).to.eql('0');
    expect(sanitizeActivity('x')).to.eql('0');
    expect(sanitizeActivity('1')).to.eql('0');
  });

  it('should reasonably normalize values like 0.33333...', function () {
    const result = sanitizeActivity(1 / 3);
    ensureInRange(result);
    expect(Number(result)).to.be.greaterThan(0.2);
    expect(Number(result)).to.be.lessThan(0.45);
    expect(result.length).to.be.lessThanOrEqual('0.1234'.length);
  });

  describe('[property based testing]', function () {
    it('should keep values between 0 and 1', function () {
      fc.assert(
        fc.property(fc.double(), (x) => {
          ensureInRange(sanitizeActivity(x));
        }),
      );
    });

    it('should not change numbers too drastically', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
          const result = sanitizeActivity(x);
          ensureInRange(result);
          expect(Number(result)).to.be.within(x - 0.1, x + 0.1);
        }),
      );
    });

    it('should not drastically change the ordering', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 0.4, noNaN: true }), (low) => {
          const high = 1.0 - low;
          const low_ = sanitizeActivity(low);
          const high_ = sanitizeActivity(high);
          ensureInRange(low_);
          ensureInRange(high_);
          expect(Number(low_)).to.be.lessThan(Number(high_));
        }),
      );
    });

    it('should not round up small numbers to 1', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 0.85, noNaN: true }), (x) => {
          const result = sanitizeActivity(x);
          expect(Number(result)).to.be.lessThan(1.0);
        }),
      );
    });

    it('should not round up big numbers to 0', function () {
      fc.assert(
        fc.property(fc.double({ min: 0.15, max: 1, noNaN: true }), (x) => {
          const result = sanitizeActivity(x);
          expect(Number(result)).to.be.greaterThan(0.0);
        }),
      );
    });

    it('should map bad inputs to "0"', function () {
      fc.assert(
        fc.property(fc.anything(), (x) => {
          if (!Number.isFinite(x)) {
            expect(sanitizeActivity(x)).to.eql('0');
          }
        }),
      );
    });

    it('should not change the mean too much', function () {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
          const numRuns = 1000;
          let sum = 0;
          for (let i = 0; i < numRuns; i += 1) {
            sum += Number(sanitizeActivity(x));
          }
          const mean = sum / numRuns;
          expect(mean).to.be.within(x - 0.03, x + 0.03);
        }),
      );
    });
  });
});
