// The web layer: HTTP in, Zubra-rendered pages out. It knows the application layer's functions and
// nothing about SQL; the application layer knows nothing about HTTP.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';
import { createStaff } from '../../vendor/kit/staff/index.js';
import { clientAddress, staffPages } from '../../vendor/kit/staff/pages.js';
import { createNotices } from '../../vendor/kit/notice/index.js';
import { createApp } from '../app/index.js';
import { sqliteStore } from '../infra/documents-store.js';
import { createRouter } from './router.js';
import { layout, say } from './ui.js';
import { createLimiter } from './limiter.js';
import { callRoutes } from './pages/calls.js';
import { customerRoutes } from './pages/customers.js';
import { itemRoutes } from './pages/items.js';
import { overviewRoutes } from './pages/overview.js';
import { ROLES } from '../domain/permissions.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', '..', 'public');
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const MAX_BODY = 256 * 1024;

export async function createWeb({ db, config, now = Date.now }) {
  const store = sqliteStore(db);
  const staff = createStaff({ store, roles: ROLES, name: 'call-store', secure: config.production });
  const notices = createNotices({ secret: config.secret });
  const zubra = createZubra({ components: join(here, 'components'), production: config.production });
  const clients = new Set();

  // Tell every open page something changed; each decides whether it cares.
  const app = createApp({
    db,
    now,
    changed(event) {
      const line = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) res.write(line);
    },
  });

  const people = {
    list: () => store.under('accounts').filter((a) => !a.disabled).map((a) => ({ email: a.email, name: a.name || a.email, roles: a.roles })),
    name(email) {
      if (!email) return '';
      const account = store.under('accounts').find((a) => a.email === email);
      return account?.name || email;
    },
  };

  const router = createRouter();
  callRoutes(router);
  customerRoutes(router);
  itemRoutes(router);
  overviewRoutes(router);

  const signInLimit = createLimiter({ max: 20, windowMs: 60_000, now });

  function html(res, status, body, extra = {}) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra });
    res.end(body);
  }

  // Pages the kit's staff routes draw (sign-in, people, password) sit inside the same layout.
  const pages = staffPages({
    staff,
    home: '/',
    business: config.business,
    notices,
    secure: config.production,
    proxies: config.proxies,
    render(res, title, body) {
      const who = res.cstoreWho ?? null;
      const page = zubra.page({ nonce: res.cspNonce });
      html(res, 200, page.finish(layout({ title, who, active: title === 'People' ? 'people' : '', body, business: config.business })), { 'content-security-policy': res.csp });
    },
  });

  function renderSignIn(req, res, url) {
    const page = zubra.page({ nonce: res.cspNonce });
    html(res, 200, page.finish(layout({ title: 'Sign in', who: null, body: pages.signIn(url), business: config.business })), { 'content-security-policy': res.csp });
  }

  async function readForm(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
      chunks.push(chunk);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  }

  /**
   * Posts must come from this site: browsers always say where from. A page with a no-referrer policy
   * (the kit's one-time link pages) posts with `Origin: null`; the browser's own Sec-Fetch-Site
   * header still tells the truth there.
   */
  function sameSite(req) {
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      try {
        return new URL(origin).host === req.headers.host;
      } catch {
        return false;
      }
    }
    return req.headers['sec-fetch-site'] === 'same-origin';
  }

  async function asset(url, res) {
    const name = url.pathname.slice('/assets/'.length);
    if (!/^[a-z0-9-]+\.(css|js)$/.test(name)) return false;
    try {
      const data = await readFile(join(PUBLIC, name));
      res.writeHead(200, { 'content-type': TYPES[extname(name)], 'cache-control': config.production ? 'public, max-age=3600' : 'no-cache', 'x-content-type-options': 'nosniff' });
      res.end(data);
    } catch {
      return false;
    }
    return true;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const nonce = randomBytes(16).toString('base64');
    res.cspNonce = nonce;
    res.csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    if (config.production) res.setHeader('strict-transport-security', 'max-age=31536000');

    if (url.pathname === '/healthz') {
      db.prepare('SELECT 1').get();
      return html(res, 200, 'ok', { 'content-type': 'text/plain' });
    }
    if (url.pathname.startsWith('/assets/')) {
      if (await asset(url, res)) return;
      return html(res, 404, 'Not found', { 'content-type': 'text/plain' });
    }
    if (zubra.handle(req, res)) return;

    const posting = req.method === 'POST';
    if (posting && !sameSite(req)) return html(res, 403, 'Cross-site posts are refused.', { 'content-type': 'text/plain' });
    let form = null;
    if (posting) {
      try {
        form = await readForm(req);
      } catch (error) {
        return html(res, error.status ?? 400, 'That request was too large.', { 'content-type': 'text/plain' });
      }
    }

    const who = staff.session(req);
    res.cstoreWho = who;

    // The kit's staff routes: sign-in, sign-out, invitations, people, password.
    if (url.pathname.startsWith('/staff')) {
      if (url.pathname === '/staff/sign-in' && posting && !signInLimit.take(clientAddress(req, { proxies: config.proxies }))) {
        return html(res, 429, 'Too many sign-in attempts. Wait a minute and try again.', { 'content-type': 'text/plain', 'retry-after': '60' });
      }
      if (!posting && url.pathname === '/staff/sign-in') {
        if (who) return redirect(res, '/');
        pages.noStore(res);
        return renderSignIn(req, res, url);
      }
      if (await pages.handle(req, res, url, form)) return;
    }

    const wantsJson = (req.headers.accept ?? '').includes('application/json');
    if (!who) {
      if (wantsJson) return json(res, { error: 'signed-out' }, 401);
      return redirect(res, '/staff/sign-in');
    }

    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    const found = router.match(req.method, url.pathname);
    const page = zubra.page({ nonce });
    const notice = notices.read(url);
    const ctx = {
      req, res, url, form, who, page, app, people, config, params: found?.params ?? {}, wantsJson, now,
      send(title, body, { active = '', live = false, script = '' } = {}, status = 200) {
        html(res, status, page.finish(layout({ title, who, active, body, notice, business: config.business, live, script })), { 'content-security-policy': res.csp });
      },
      redirect: (path, { done, problem } = {}) => redirect(res, notices.sign(done || problem ? `${path}${path.includes('?') ? '&' : '?'}${done ? 'done' : 'problem'}=${encodeURIComponent(done || problem)}` : path)),
      json: (value, status = 200) => json(res, value, status),
      notFound: () => ctx.send('Not found', '<div class="head"><h1>Not found</h1></div><p>That page isn’t here. <a href="/">Back to today</a>.</p>', {}, 404),
      forbidden: () => ctx.send('Not allowed', `<div class="head"><h1>Not allowed</h1></div><p>${say('forbidden')} <a href="/">Back to today</a>.</p>`, {}, 403),
    };

    if (!found) return router.knows(url.pathname) ? html(res, 405, 'Method not allowed', { 'content-type': 'text/plain' }) : ctx.notFound();
    try {
      await found.handler(ctx);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) ctx.send('Something went wrong', '<div class="head"><h1>Something went wrong</h1></div><p>It’s been logged. Try again, or tell whoever runs the system.</p>', {}, 500);
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Something went wrong.');
    });
  });
  server.on('close', () => {
    for (const res of clients) res.end();
  });

  return { server, app, staff, store, people };
}

function redirect(res, location) {
  res.writeHead(303, { location, 'cache-control': 'no-store' });
  res.end();
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
