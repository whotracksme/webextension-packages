import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

const ONE_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const KNOWN_HOSTS = new Set(['site.test', 'tracker.test', 'analytics.test']);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function serveFile(res, hostDir, pathname) {
  const file = path.join(fixturesDir, hostDir, pathname.replace(/^\//, ''));
  if (!file.startsWith(path.join(fixturesDir, hostDir))) {
    return send(res, 403, 'forbidden');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found');
  }
  const ext = path.extname(file);
  const type =
    ext === '.html'
      ? 'text/html; charset=utf-8'
      : ext === '.js'
      ? 'application/javascript'
      : ext === '.css'
      ? 'text/css'
      : 'application/octet-stream';
  send(res, 200, fs.readFileSync(file), { 'content-type': type });
}

export function startFixtureServer({ port = 3300 } = {}) {
  const server = http.createServer((req, res) => {
    const hostHeader = (req.headers.host || '').split(':')[0];
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (!KNOWN_HOSTS.has(hostHeader)) {
      return send(res, 404, `unknown host: ${hostHeader}`);
    }

    if (hostHeader === 'tracker.test' && url.pathname === '/pixel.gif') {
      return send(res, 200, ONE_PIXEL_GIF, {
        'content-type': 'image/gif',
        'set-cookie': `uid=${Math.random()
          .toString(16)
          .slice(2)}; Path=/; SameSite=None; Secure`,
      });
    }

    if (hostHeader === 'analytics.test' && url.pathname === '/collect') {
      return send(res, 204, '');
    }

    serveFile(
      res,
      hostHeader,
      url.pathname === '/' ? '/index.html' : url.pathname,
    );
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.FIXTURE_PORT || 3300);
  startFixtureServer({ port }).then(() => {
    console.log(`fixture server on http://127.0.0.1:${port}`);
    console.log('hosts: site.test, tracker.test, analytics.test');
  });
}
