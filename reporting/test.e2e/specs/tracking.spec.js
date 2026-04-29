import { expect } from 'chai';

const FIXTURE_PORT = Number(process.env.FIXTURE_PORT || 3300);
const FIXTURE_URL = `http://site.test:${FIXTURE_PORT}/index.html`;
const NEUTRAL_URL = `http://site.test:${FIXTURE_PORT}/blank.html`;

async function callExtension(op, args) {
  // Re-sends the request every 500ms until the content script answers.
  // The content script may not be injected yet (e.g. Safari blocks injection
  // until the user grants the per-host permission prompt). All retries use
  // the same id, so we resolve on the first response and ignore duplicates.
  const result = await browser.executeAsync(
    function (op, args, done) {
      var id = Math.random().toString(36).slice(2);
      var resolved = false;
      function onMessage(ev) {
        if (
          ev.source !== window ||
          !ev.data ||
          ev.data.source !== 'wtm-e2e-response' ||
          ev.data.id !== id ||
          resolved
        ) {
          return;
        }
        resolved = true;
        window.removeEventListener('message', onMessage);
        clearInterval(timer);
        done(ev.data);
      }
      function send() {
        if (resolved) return;
        window.postMessage(
          { source: 'wtm-e2e', id: id, op: op, args: args },
          '*',
        );
      }
      window.addEventListener('message', onMessage);
      send();
      var timer = setInterval(send, 500);
    },
    op,
    args || null,
  );
  if (!result || !result.ok) {
    throw new Error(`extension call ${op} failed: ${result && result.error}`);
  }
  return result.response;
}

function lap(label) {
  const now = Date.now();
  const dt = lap.last ? now - lap.last : 0;
  console.log(`[lap] +${dt}ms ${label}`);
  lap.last = now;
}
lap.reset = () => {
  lap.last = Date.now();
};

describe('request reporter — tracking attribution', () => {
  before(async () => {
    lap.reset();
    lap('start before');
    await browser.url(NEUTRAL_URL);
    lap('navigated to neutral');
    await callExtension('waitReady');
    lap('waitReady returned');
  });

  beforeEach(async () => {
    lap.reset();
    await browser.url(NEUTRAL_URL);
    lap('beforeEach: navigated to neutral');
    await callExtension('resetReporterMessages');
    lap('beforeEach: reset done');
  });

  it('attributes a 1st-party page load to its tab', async () => {
    lap.reset();
    await browser.url(FIXTURE_URL);
    lap('test1: navigated to fixture');
    await browser.pause(1500);

    const { pages } = await callExtension('getPages');
    lap('test1: getPages returned');
    const sitePage = pages
      .map((p) => p.page)
      .find((p) => p && p.url && p.url.includes('site.test'));

    expect(
      sitePage,
      `site.test page in pageStore. Got: ${JSON.stringify(pages)}`,
    ).to.exist;
    expect(sitePage.url).to.match(/^http:\/\/site\.test:/);
  });

  it('emits a tp_events message when the page is staged', async () => {
    lap.reset();
    await browser.url(FIXTURE_URL);
    lap('test2: navigated to fixture');
    await browser.pause(2500);

    // Navigate away so the fixture's documentId leaves the live set,
    // then force-flush the page store to bypass the BFCACHE TTL.
    await browser.url(NEUTRAL_URL);
    lap('test2: navigated to neutral');
    await browser.pause(500);
    await callExtension('forceFlushPages');
    lap('test2: forceFlush returned');
    await browser.pause(500);

    const { pages } = await callExtension('getPages');
    const { messages } = await callExtension('getReporterMessages');
    lap('test2: getReporterMessages returned');
    const tpEvents = messages.filter(
      (m) => m && m.action === 'wtm.attrack.tp_events',
    );

    expect(
      tpEvents.length,
      `expected at least one tp_events message. messages=${
        messages.length
      } actions=${messages
        .map((m) => m && m.action)
        .join(',')} pages=${JSON.stringify(
        pages.map((p) => ({
          url: p.tabUrl,
          stats: p.page && p.page.requestStats,
        })),
      )}`,
    ).to.be.greaterThan(0);

    const message = tpEvents[0];
    expect(message.type, 'envelope type').to.equal('wtm.request');
    expect(message.userAgent, 'userAgent').to.be.oneOf([
      'chrome',
      'safari',
      'edge',
      'opera',
      'yandex',
      '',
    ]);
    expect(message.ts, 'ts').to.match(/^\d{0,8}$/);
    expect(message['anti-duplicates'], 'anti-duplicates').to.be.a('number');

    const env = message.payload;
    expect(env, 'payload envelope').to.exist;
    expect(env.ver, 'payload.ver').to.be.a('string').and.match(/^\d/);
    expect(env.ts, 'payload.ts').to.be.a('string');
    expect(env.data, 'payload.data').to.be.an('array').with.lengthOf(1);

    const page = env.data[0];
    expect(page.scheme, 'page.scheme').to.equal('http');
    expect(page.c, 'page.c').to.equal(1);
    expect(page.t, 'page.t (ms alive)').to.be.a('number').and.greaterThan(0);
    expect(page.hostname, 'page.hostname is 16-hex hash').to.match(
      /^[0-9a-f]{16}$/,
    );
    expect(page.path, 'page.path is 16-hex hash').to.match(/^[0-9a-f]{16}$/);
    expect(page.placeHolder, 'placeHolder').to.equal(false);
    expect(page.redirects, 'redirects').to.deep.equal([]);

    const tps = page.tps || {};
    const tpDomains = Object.keys(tps);
    expect(tpDomains, 'tps non-empty').to.have.length.greaterThan(0);
    expect(
      tpDomains.includes('tracker.test'),
      `tracker.test in tps (got: ${tpDomains.join(', ')})`,
    ).to.equal(true);
    expect(
      tpDomains.includes('analytics.test'),
      `analytics.test in tps (got: ${tpDomains.join(', ')})`,
    ).to.equal(true);

    // Each tracker stats bucket should at least record the request count `c`.
    expect(
      tps['tracker.test'].c,
      'tracker.test request count',
    ).to.be.greaterThan(0);
    expect(
      tps['analytics.test'].c,
      'analytics.test request count',
    ).to.be.greaterThan(0);
  });
});
