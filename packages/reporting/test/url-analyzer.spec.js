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

import UrlAnalyzer from '../src/url-analyzer.js';

describe('#UrlAnalyzer', function () {
  describe('with simple generic patterns', function () {
    let uut;

    beforeEach(function () {
      const patterns = {
        createDoublefetchRequest(msgType, url) {
          return { url };
        },
      };
      uut = new UrlAnalyzer(patterns);
    });

    for (const [expectedType, examples] of Object.entries({
      'search-goi': {
        'https://www.google.com/search?q=cat&source=lnms&tbm=isch&sa=X&ved=2ahUKEwi7hP-jm4b8AhVXxgIHHQdcCAcQ_AUoAXoECAEQAw&biw=1916&bih=991':
          {
            query: 'cat',
            doublefetchUrl:
              'https://www.google.com/search?tbm=isch&gbv=1&q=cat',
          },
        'https://www.google.de/search?q=katze&source=lnms&tbm=isch&sa=X&ved=2ahUKEwiOqNirm4b8AhVf57sIHXF3CboQ_AUoAXoECAEQAw&biw=1916&bih=991':
          {
            query: 'katze',
            doublefetchUrl:
              'https://www.google.de/search?tbm=isch&gbv=1&q=katze',
          },
        'https://www.google.co.uk/search?q=British+Shorthair&source=lnms&tbm=isch&sa=X&ved=2ahUKEwiP1Yu5_Ib8AhUOhf0HHV39Bl8Q_AUoAXoECAEQAw&biw=1916&bih=950':
          {
            query: 'British Shorthair',
            doublefetchUrl:
              'https://www.google.co.uk/search?tbm=isch&gbv=1&q=British+Shorthair',
          },
      },
      'search-go': {
        'https://www.google.com/search?q=eiffel+tower&source=hp&ei=qqCgY9uPNYOHxc8P65ic2AU&iflsig=AJiK0e8AAAAAY6CuukvNWgA7Z8DOk7aU5niFXq0FPyV_&ved=0ahUKEwjbjN3cm4b8AhWDQ_EDHWsMB1sQ4dUDCAs&uact=5&oq=eiffel+tower&gs_lcp=Cgdnd3Mtd2l6EAMyDgguEIAEELEDEMcBEK8BMgUIABCABDIFCAAQgAQyBQgAEIAEMgsILhCvARDHARCABDIFCAAQgAQyBQgAEIAEMgUIABCABDIFCC4QgAQyBQgAEIAEOhEILhCABBCxAxCDARDHARDRAzoLCAAQgAQQsQMQgwE6CAgAELEDEIMBOg4ILhCABBCxAxDHARDRAzoLCC4QgAQQxwEQ0QM6CAguELEDEIMBOggIABCABBCxAzoLCC4QsQMQgwEQ1AI6CwguEIAEELEDEIMBOg4ILhCvARDHARCxAxCABDoLCC4QgAQQsQMQ1AI6CwguEIAEEMcBEK8BOggILhCABBCxA1Cj4gFYhfUBYIr4AWgBcAB4AIABWIgBjAeSAQIxMpgBAKABAbABAA&sclient=gws-wiz':
          {
            query: 'eiffel tower',
            doublefetchUrl: 'https://www.google.com/search?q=eiffel+tower',
          },
        'https://www.google.de/search?q=eiffelturm&source=hp&ei=4aCgY4-pKsj5kgWp4JrwCA&iflsig=AJiK0e8AAAAAY6Cu8Y3ud9bEicmzyHDM0uBYFatsxelY&ved=0ahUKEwjPne_2m4b8AhXIvKQKHSmwBo4Q4dUDCAo&uact=5&oq=eiffelturm&gs_lcp=Cgdnd3Mtd2l6EAMyDgguEK8BEMcBELEDEIAEMggIABCABBCxAzIICAAQgAQQsQMyCwgAEIAEELEDEIMBMgUIABCABDIFCAAQgAQyBQgAEIAEMggIABCABBCxAzIFCAAQgAQyBQgAEIAEOhEILhCABBCxAxCDARDHARDRAzoICAAQsQMQgwE6DgguEIAEELEDEMcBENEDOgsILhCABBDHARDRAzoICC4QsQMQgwE6CwguELEDEIMBENQCOgsILhCABBCxAxCDAToFCC4QgAQ6CwguEIAEELEDENQCOgsILhCABBDHARCvAToICC4QgAQQsQNQgQJY2BRg7RVoAnAAeACAAVaIAfsFkgECMTGYAQCgAQGwAQA&sclient=gws-wiz':
          {
            query: 'eiffelturm',
            doublefetchUrl: 'https://www.google.de/search?q=eiffelturm',
          },
        'https://www.google.co.uk/search?q=big+ben&source=hp&ei=rAahY8WiMs6A9u8PwrWYwAY&iflsig=AJiK0e8AAAAAY6EUvMiuI7T8I426gYrRkT_KwUCXK7pJ&ved=0ahUKEwjFqOqA_Yb8AhVOgP0HHcIaBmgQ4dUDCAo&uact=5&oq=big+ben&gs_lcp=Cgdnd3Mtd2l6EAMyDgguEK8BEMcBELEDEIAEMgUIABCABDIFCAAQgAQyBQgAEIAEMgUIABCABDILCC4QrwEQxwEQgAQyBQgAEIAEMgUIABCABDIFCAAQgAQyCwguEIAEEMcBEK8BOgsIABCABBCxAxCDAToLCC4QgAQQsQMQ1AI6CAgAEIAEELEDOgsILhCABBDHARDRAzoICAAQsQMQgwE6EQguEK8BEMcBEJIDEMkDEIAEOhEILhCABBCxAxCDARDHARCvAToLCC4QgAQQsQMQgwE6DgguEIAEELEDEMcBEK8BOgcIABCxAxAKOhEILhCDARCvARDHARCxAxCABDoNCAAQgAQQsQMQgwEQClCkEljAHGDlHmgBcAB4AIABV4gBjASSAQE3mAEAoAEBsAEA&sclient=gws-wiz':
          {
            query: 'big ben',
            doublefetchUrl: 'https://www.google.co.uk/search?q=big+ben',
          },
      },
      'search-ya': {
        'https://de.search.yahoo.com/search?p=katze&fr=yfp-t&fr2=p%3Afp%2Cm%3Asb&ei=UTF-8&fp=1':
          {
            query: 'katze',
            doublefetchUrl: 'https://de.search.yahoo.com/search?q=katze',
          },
        'https://se.search.yahoo.com/search?p=lingon&fr=yfp-t&fr2=p%3Afp%2Cm%3Asb&ei=UTF-8&fp=1':
          {
            query: 'lingon',
            doublefetchUrl: 'https://se.search.yahoo.com/search?q=lingon',
          },
        'https://se.search.yahoo.com/search?q=lingon': {
          query: 'lingon',
          doublefetchUrl: 'https://se.search.yahoo.com/search?q=lingon',
        },
      },
      'search-bii': {
        'https://www.bing.com/images/search?q=cat&form=HDRSC2&first=1&tsc=ImageHoverTitle':
          {
            query: 'cat',
            doublefetchUrl: 'https://www.bing.com/images/search?q=cat',
          },
      },
      'search-bi': {
        'https://www.bing.com/search?q=eiffel+tower&search=&form=QBLH': {
          query: 'eiffel tower',
          doublefetchUrl: 'https://www.bing.com/search?q=eiffel+tower',
        },
      },
      'search-am': {
        'https://www.amazon.com/s/ref=nb_sb_noss?url=search-alias%3Daps&field-keywords=usb+stick':
          {
            query: 'usb stick',
            doublefetchUrl:
              'https://www.amazon.com/s/?field-keywords=usb+stick',
          },
        'https://www.amazon.com/s/?field-keywords=usb+stick': {
          query: 'usb stick',
          doublefetchUrl: 'https://www.amazon.com/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.com/s?k=usb+stick&ref=nb_sb_noss': {
          query: 'usb stick',
          doublefetchUrl: 'https://www.amazon.com/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.de/s/ref=nb_sb_noss?__mk_de_DE=%C3%85M%C3%85%C5%BD%C3%95%C3%91&url=search-alias%3Daps&field-keywords=usb+stick':
          {
            query: 'usb stick',
            doublefetchUrl: 'https://www.amazon.de/s/?field-keywords=usb+stick',
          },
        'https://www.amazon.de/s/?field-keywords=usb+stick': {
          query: 'usb stick',
          doublefetchUrl: 'https://www.amazon.de/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.de/s?k=usb+stick&ref=nb_sb_noss': {
          query: 'usb stick',
          doublefetchUrl: 'https://www.amazon.de/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.de/s?k=usb+stick&link_code=qs&sourceid=Mozilla-search&tag=firefox-de-21':
          {
            query: 'usb stick',
            doublefetchUrl: 'https://www.amazon.de/s/?field-keywords=usb+stick',
          },
        'https://www.amazon.fr/s/ref=nb_sb_noss?__mk_fr_FR=%C3%85M%C3%85%C5%BD%C3%95%C3%91&url=search-alias%3Daps&field-keywords=usb+stick':
          {
            query: 'usb stick',
            doublefetchUrl: 'https://www.amazon.fr/s/?field-keywords=usb+stick',
          },
        'https://www.amazon.fr/s/?field-keywords=usb+stick': {
          query: 'usb stick',
          doublefetchUrl: 'https://www.amazon.fr/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.fr/s?k=usb+stick&ref=nb_sb_noss': {
          query: 'usb stick',
          doublefetchUrl: 'https://www.amazon.fr/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.co.uk/s/ref=nb_sb_noss?url=search-alias%3Daps&field-keywords=usb+stick':
          {
            query: 'usb stick',
            doublefetchUrl:
              'https://www.amazon.co.uk/s/?field-keywords=usb+stick',
          },
        'https://www.amazon.co.uk/s/?field-keywords=usb+stick': {
          query: 'usb stick',
          doublefetchUrl:
            'https://www.amazon.co.uk/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.co.uk/s?k=usb+stick&ref=nb_sb_noss': {
          query: 'usb stick',
          doublefetchUrl:
            'https://www.amazon.co.uk/s/?field-keywords=usb+stick',
        },
        'https://www.amazon.co.uk/s?k=usb+stick&rh=n%3A430554031%2Cp_n_size_browse-bin%3A22433143031&dc&ds=v1%3AUkq7oU94vQBXuTjKsehQt6yIvm5lD8NEbMGVFKI3jOg&qid=1674079209&rnid=310771031&ref=sr_nr_p_n_size_browse-bin_8':
          {
            query: 'usb stick',
            doublefetchUrl:
              'https://www.amazon.co.uk/s/?field-keywords=usb+stick',
          },
      },
      'search-dd': {
        'https://duckduckgo.com/?q=eiffel+tower&t=h_&ia=web': {
          query: 'eiffel tower',
          doublefetchUrl: 'https://duckduckgo.com/?q=eiffel+tower',
        },
        'https://duckduckgo.com/?t=ffab&q=eiffel+tower&ia=web': {
          query: 'eiffel tower',
          doublefetchUrl: 'https://duckduckgo.com/?q=eiffel+tower',
        },
        'https://duckduckgo.com/?q=eiffel+tower': {
          query: 'eiffel tower',
          doublefetchUrl: 'https://duckduckgo.com/?q=eiffel+tower',
        },
      },
    })) {
      describe(`and examples for type: ${expectedType}`, function () {
        for (const [
          url,
          { query: expectedQuery, doublefetchUrl },
        ] of Object.entries(examples)) {
          it(`should match ${url}`, function () {
            const { found, type, query, doublefetchRequest } =
              uut.parseSearchLinks(url);
            expect(found).to.be.true;
            expect(type).to.eql(expectedType);
            expect(query).to.eql(expectedQuery);
            expect(doublefetchRequest.url).to.eql(doublefetchUrl);
          });
        }
      });
    }

    describe('and examples for URLs that should not match', function () {
      for (const url of [
        'https://example.com/',
        'http://127.0.0.1:8080/',
        'http://fritz.box/',
        'https://www.ghostery.com/blog',
        'https://store.google.com/DE/?utm_source=hp_header&utm_medium=google_ooo&utm_campaign=GS100042&hl=de-DE',
        'https://accounts.google.com/v3/signin/identifier?dsh=S788983809%3A1671471756806523&continue=https%3A%2F%2Fwww.google.com%2F&ec=GAZAmgQ&hl=de&passive=true&flowName=GlifWebSignIn&flowEntry=ServiceLogin&ifkv=AeAAQh45t5f0ZbYt-xWR7sB1PXU0thVRp5kcqclfTVoP24W7gXKVxWVXvWbzo-yUMs7LIMkaCYUepg',
        'https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fs%2Fref%3Dnb_sb_noss%2F%3F_encoding%3DUTF8%26field-keywords%3Dusb%2520stick%26url%3Dsearch-alias%253Daps%26ref_%3Dnav_ya_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&',
        'https://www.amazon.com/SanDisk-Ultra-Flair-128GB-Flash/dp/B015CH1PJU/ref=sr_1_3?keywords=usb+stick&qid=1674077012&sr=8-3',
        'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B0752BLWNB&Quantity.1=1',
        'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B00SUZWGHM&Quantity.1=1&ASIN.2=B00809ERAM&Quantity.2=1',
        'https://duckduckgo.com/?t=ffab&q=eiffel+tower&iax=images&ia=images',
        'https://duckduckgo.com/?t=ffab&q=eiffel+tower&iax=videos&ia=videos',
        'https://duckduckgo.com/?t=ffab&q=eiffel+tower&iar=news&ia=news',
        'https://duckduckgo.com/?t=ffab&q=eiffel+tower&ia=news&iaxm=about',
      ]) {
        it(`should not match ${url}`, function () {
          const { found } = uut.parseSearchLinks(url);
          expect(found).to.be.false;
        });
      }
    });
  });

  describe('with fake patterns for search-go', function () {
    function searchGoDoublefetch(url) {
      return {
        url,
        redirect: 'follow',
        headers: {
          Cookie: 'SOME_DUMMY_VALUE',
        },
      };
    }

    function searchGoFakePatterns() {
      return {
        createDoublefetchRequest(msgType, url) {
          if (msgType === 'search-go') {
            return searchGoDoublefetch(url);
          }
          throw new Error(`Unexpected msgType: ${msgType}`);
        },
      };
    }

    let uut;

    beforeEach(function () {
      const patterns = searchGoFakePatterns();
      uut = new UrlAnalyzer(patterns);
    });

    it('should detect the query "trump alaska"', function () {
      const url =
        'https://www.google.de/search?source=hp&ei=c1tmXYGgDsXGkwXak4z4BQ&q=trump+alaska&oq=trump+alaska&gs_l=psy-ab.3..0i324j0i3j0i22i30l8.4708.6506..6817...0.0..0.476.1834.2j5j1j1j1......0....1..gws-wiz.......0i131j0.tK4mGhzYgHg&ved=0ahUKEwjBpazHsaXkAhVF46QKHdoJA18Q4dUDCAc&uact=5';
      expect(uut.parseSearchLinks(url)).to.eql({
        found: true,
        type: 'search-go',
        query: 'trump alaska',
        doublefetchRequest: searchGoDoublefetch(
          'https://www.google.de/search?q=trump+alaska',
        ),
      });
    });

    it('should detect query with "+" sign: "a+b"', function () {
      const url =
        'https://www.google.com/search?q=a%2Bb&oq=a%2Bb&aqs=chrome..69i57j0l5.9078j0j8&sourceid=chrome&ie=UTF-8#sbfbu=1&pi=a%2Bb';
      expect(uut.parseSearchLinks(url)).to.eql({
        found: true,
        type: 'search-go',
        query: 'a+b',
        doublefetchRequest: searchGoDoublefetch(
          'https://www.google.com/search?q=a%2Bb',
        ),
      });
    });

    it('should detect query with "#" sign: "c# how to read a file"', function () {
      const url =
        'https://www.google.com/search?q=c%23+how+to+read+a+file&oq=c%23+how+to+read+a+file&aqs=chrome..69i57j69i58.7270j0j7&sourceid=chrome&ie=UTF-8';
      expect(uut.parseSearchLinks(url)).to.eql({
        found: true,
        type: 'search-go',
        query: 'c# how to read a file',
        doublefetchRequest: searchGoDoublefetch(
          'https://www.google.com/search?q=c%23+how+to+read+a+file',
        ),
      });
    });

    it('should detect query with more special characters', function () {
      const url =
        'https://www.google.com/search?q=a%2Bb&oq=a%2Bb&aqs=chrome..69i57j0l5.9078j0j8&sourceid=chrome&ie=UTF-8#sbfbu=1&pi=a%2Bb';
      expect(uut.parseSearchLinks(url)).to.eql({
        found: true,
        type: 'search-go',
        query: 'a+b',
        doublefetchRequest: searchGoDoublefetch(
          'https://www.google.com/search?q=a%2Bb',
        ),
      });
    });

    it('should support queries from auto-completion ("magnus ca" -> "magnus carlsen")', function () {
      const url =
        'https://www.google.com/search?q=magnus+carlsen&source=hp&oq=magnus+ca&gs_l=mobile-heirloom-hp.1.1.41j0i512i433i131l2j0i3l2.3398.7907.0.12670.10.8.0.2.2.0.250.1118.1j6j1.8.0....0...1c.1.34.mobile-heirloom-hp..0.10.1209.82wOg7b9tFw';
      expect(uut.parseSearchLinks(url)).to.eql({
        found: true,
        type: 'search-go',
        query: 'magnus carlsen',
        doublefetchRequest: searchGoDoublefetch(
          'https://www.google.com/search?q=magnus+carlsen',
        ),
      });
    });

    it('should not find term queries on non-search pages (no false-positives)', function () {
      const urls = [
        'https://cliqz.com/',
        'about:config',
        'http://127.0.0.1:8080/foo/bar',
        'https://www.google.de/',
        'https://www.google.com/intl/de/gmail/about/',
      ];

      for (const url of urls) {
        expect(uut.parseSearchLinks(url)).to.eql({ found: false });
      }
    });

    it('should support special characters (ascii)', function () {
      fc.assert(
        fc.property(fc.string(), (text) => {
          fc.pre(text.length > 0 && text === text.trim());
          const encodedText = encodeURIComponent(text);
          const url = `https://www.google.com/search?q=${encodedText}`;

          const { query } = uut.parseSearchLinks(url);
          return query === text;
        }),
      );
    });

    it('should support special characters (unicode)', function () {
      fc.assert(
        fc.property(fc.fullUnicodeString(), (text) => {
          fc.pre(text.length > 0 && text === text.trim());
          const encodedText = encodeURIComponent(text);
          const url = `https://www.google.com/search?q=${encodedText}`;

          const { query } = uut.parseSearchLinks(url);
          return query === text;
        }),
      );
    });

    it('should handle all kind of URLs without throwing an exception', function () {
      fc.assert(
        fc.property(fc.webUrl(), (url) => {
          // should not throw
          uut.parseSearchLinks(url);
        }),
      );
    });
  });
});
