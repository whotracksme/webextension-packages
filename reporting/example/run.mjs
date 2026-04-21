import { remote } from 'webdriverio';
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const { values } = parseArgs({
  options: {
    url: { type: 'string', multiple: true, default: [] },
    wait: { type: 'string', default: '10' },
    headless: { type: 'boolean', default: false },
    'keep-open': { type: 'boolean', default: false },
    'log-file': { type: 'string' },
    'browser-version': { type: 'string', default: 'canary' },
    port: { type: 'string', default: '7878' },
  },
});

const exampleDir = path.dirname(fileURLToPath(import.meta.url));

for (const bundle of ['index.bundle.js', 'content.bundle.js']) {
  if (!fs.existsSync(path.join(exampleDir, bundle))) {
    console.error(
      `missing example/${bundle} — run \`npm --workspace=reporting run build\` first`,
    );
    process.exit(1);
  }
}

if (!fs.existsSync(path.join(exampleDir, 'manifest.json'))) {
  fs.copyFileSync(
    path.join(exampleDir, 'manifests', 'chromium.json'),
    path.join(exampleDir, 'manifest.json'),
  );
}

const logDir = path.join(exampleDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = values['log-file'] || path.join(logDir, 'run.log');
fs.writeFileSync(logFile, '');

function log(source, level, text) {
  const line = `${new Date().toISOString()} [${source}] [${level}] ${text}\n`;
  fs.appendFileSync(logFile, line);
  process.stdout.write(line);
}

function stringifyArg(v) {
  if (v == null) return String(v);
  if (v.type === 'string') return v.value ?? '';
  if (v.type === 'number' || v.type === 'boolean') return String(v.value);
  if (v.type === 'object' || v.type === 'array') return JSON.stringify(v);
  return v.value !== undefined ? String(v.value) : JSON.stringify(v);
}

const chromeArgs = [
  '--no-first-run',
  '--no-default-browser-check',
  '--enable-unsafe-extension-debugging',
];
if (values.headless) chromeArgs.push('--headless=new');

log(
  'runner',
  'info',
  `launching chrome (browserVersion=${values['browser-version']})`,
);

const browser = await remote({
  logLevel: 'warn',
  capabilities: {
    browserName: 'chrome',
    browserVersion: values['browser-version'],
    'goog:chromeOptions': { args: chromeArgs },
    webSocketUrl: true,
  },
});

await browser.sessionSubscribe({ events: ['log.entryAdded'] });
browser.on('log.entryAdded', (entry) => {
  const text = entry.args
    ? entry.args.map(stringifyArg).join(' ')
    : entry.text || '';
  const ctx = entry.source?.context;
  const realm = entry.source?.realm;
  const src = ctx
    ? `page:${ctx.slice(0, 8)}`
    : realm
      ? `realm:${realm.slice(0, 8)}`
      : 'page';
  log(src, entry.level || 'info', text);
});

let extensionId;
try {
  const result = await browser.webExtensionInstall({
    extensionData: { type: 'path', path: exampleDir },
  });
  extensionId = result.extension;
  log('runner', 'info', `extension installed: ${extensionId}`);
} catch (err) {
  log('runner', 'error', `webExtension.install failed: ${err.message}`);
  await browser.deleteSession();
  process.exit(1);
}

let swWorker = null;
const debuggerAddress =
  browser.capabilities['goog:chromeOptions']?.debuggerAddress;
if (debuggerAddress) {
  try {
    const cdpBrowser = await puppeteer.connect({
      browserURL: `http://${debuggerAddress}`,
      defaultViewport: null,
    });
    const attached = new WeakSet();
    const attachSW = async (target) => {
      if (attached.has(target) || target.type() !== 'service_worker') return;
      attached.add(target);
      try {
        const worker = await target.worker();
        if (!worker) return;
        swWorker = worker;
        worker.on('console', (msg) => log('sw', msg.type(), msg.text()));
        worker.on('error', (err) => log('sw', 'error', err.message));
        log('runner', 'info', `attached SW: ${target.url()}`);
      } catch (err) {
        log('runner', 'warn', `SW attach failed: ${err.message}`);
      }
    };
    for (const t of cdpBrowser.targets()) await attachSW(t);
    cdpBrowser.on('targetcreated', attachSW);
  } catch (err) {
    log('runner', 'warn', `CDP side-channel failed: ${err.message}`);
  }
} else {
  log('runner', 'warn', 'no debuggerAddress — SW logs will not be captured');
}

for (const url of values.url) {
  log('runner', 'info', `navigating: ${url}`);
  try {
    await browser.url(url);
  } catch (err) {
    log('runner', 'error', `navigate ${url} failed: ${err.message}`);
  }
}

const waitMs = Math.max(0, Number(values.wait) * 1000);

async function shutdown() {
  if (extensionId) {
    await browser
      .webExtensionUninstall({ extension: extensionId })
      .catch(() => {});
  }
  await browser.deleteSession().catch(() => {});
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ _parseError: true });
      }
    });
  });
}

async function handleControl(method, url, body) {
  const p = url.pathname;

  if (method === 'POST' && p === '/navigate') {
    if (!body.url) return [400, { error: 'missing url' }];
    await browser.url(body.url);
    return [
      200,
      { url: await browser.getUrl(), title: await browser.getTitle() },
    ];
  }

  if (method === 'POST' && p === '/eval') {
    if (!body.code) return [400, { error: 'missing code' }];
    if (body.target === 'sw') {
      if (!swWorker) return [409, { error: 'no SW attached' }];
      try {
        const result = await swWorker.evaluate(body.code);
        return [200, { result }];
      } catch (err) {
        return [500, { error: err.message }];
      }
    }
    try {
      const result = await browser.execute(body.code);
      return [200, { result }];
    } catch (err) {
      return [500, { error: err.message }];
    }
  }

  if (method === 'GET' && p === '/state') {
    const handles = await browser.getWindowHandles();
    const cur = await browser.getWindowHandle();
    const tabs = [];
    for (const h of handles) {
      await browser.switchToWindow(h);
      tabs.push({
        handle: h,
        url: await browser.getUrl(),
        title: await browser.getTitle(),
      });
    }
    await browser.switchToWindow(cur);
    return [
      200,
      {
        extensionId,
        tabs,
        sw: swWorker ? { url: swWorker.url() } : null,
      },
    ];
  }

  if (method === 'GET' && p === '/logs/tail') {
    const n = Number(url.searchParams.get('lines')) || 50;
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(-n);
    return [200, { lines }];
  }

  return [404, { error: 'unknown route' }];
}

let controlServer;
function startControlServer(port) {
  controlServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      if (req.method === 'POST' && url.pathname === '/shutdown') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        setTimeout(async () => {
          await shutdown();
          process.exit(0);
        }, 10);
        return;
      }
      const [status, reply] = await handleControl(req.method, url, body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  controlServer.listen(port, '127.0.0.1', () => {
    log('runner', 'info', `control on http://127.0.0.1:${port}`);
    log(
      'runner',
      'info',
      'routes: POST /navigate {url}, POST /eval {code,target?}, POST /shutdown, GET /state, GET /logs/tail?lines=N',
    );
  });
}

if (values['keep-open']) {
  startControlServer(Number(values.port));
  log('runner', 'info', 'keeping browser open (ctrl-c to exit)');
  process.on('SIGINT', async () => {
    controlServer?.close();
    await shutdown();
    process.exit(0);
  });
} else {
  log('runner', 'info', `waiting ${values.wait}s`);
  await new Promise((r) => setTimeout(r, waitMs));
  await shutdown();
  log('runner', 'info', `done, logs at ${logFile}`);
}
