import { expect } from 'chai';

const FIXTURE_PORT = Number(process.env.FIXTURE_PORT || 3300);
const FIXTURE_URL = `http://site.test:${FIXTURE_PORT}/index.html`;

async function callExtension(op, args) {
  const result = await browser.execute(
    (op, args) =>
      new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        function onMessage(ev) {
          if (
            ev.source !== window ||
            !ev.data ||
            ev.data.source !== 'wtm-e2e-response' ||
            ev.data.id !== id
          ) {
            return;
          }
          window.removeEventListener('message', onMessage);
          resolve(ev.data);
        }
        window.addEventListener('message', onMessage);
        window.postMessage({ source: 'wtm-e2e', id, op, args }, '*');
      }),
    op,
    args || null,
  );
  if (!result || !result.ok) {
    throw new Error(`extension call ${op} failed: ${result && result.error}`);
  }
  return result.response;
}

describe('request reporter — tracking attribution', () => {
  beforeEach(async () => {
    await browser.url('about:blank');
    await callExtension('resetReporterMessages');
  });

  it('attributes a 1st-party page load to its tab', async () => {
    await browser.url(FIXTURE_URL);
    await browser.pause(1500);

    const { pages } = await callExtension('getPages');
    const sitePage = pages
      .map((p) => p.page)
      .find((p) => p && p.url && p.url.includes('site.test'));

    expect(sitePage, 'site.test page in pageStore').to.exist;
    expect(sitePage.url).to.match(/^http:\/\/site\.test:/);
  });

  it('records 3rd-party tracker domains as request stats', async () => {
    await browser.url(FIXTURE_URL);
    await browser.pause(2500);

    const { pages } = await callExtension('getPages');
    const sitePage = pages
      .map((p) => p.page)
      .find((p) => p && p.url && p.url.includes('site.test'));
    expect(sitePage, 'site.test page in pageStore').to.exist;

    const stats = sitePage.requestStats || {};
    const trackedDomains = Object.keys(stats);
    expect(
      trackedDomains.some((d) => d.includes('tracker.test')),
      `expected tracker.test in stats, got: ${trackedDomains.join(', ')}`,
    ).to.equal(true);
    expect(
      trackedDomains.some((d) => d.includes('analytics.test')),
      `expected analytics.test in stats, got: ${trackedDomains.join(', ')}`,
    ).to.equal(true);
  });
});
