// The Easel proxy: one per running workspace. It sits in front of the app's dev
// server (any language) or serves a static folder itself, and:
//   - injects the runtime as the first <script> of every HTML page (streaming-safe)
//   - strips headers that stop pages rendering inside a canvas iframe
//   - answers /__easel/net (cross-origin calls → mock engine) and same-origin mock rules
//   - passes WebSocket upgrades through so the app's own hot reload keeps working
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './config.js';
import { safeJoin } from './util.js';

const RUNTIME_FILE = path.join(ROOT, 'runtime', 'runtime.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.map': 'application/json', '.md': 'text/plain; charset=utf-8',
};
const STRIP = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only'];
const TAG = '<script src="/__easel/runtime.js" data-easel></script>';

export function injectTag(html) {
  if (html.includes('/__easel/runtime.js')) return html;
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (head) return html.slice(0, head.index + head[0].length) + TAG + html.slice(head.index + head[0].length);
  const root = html.match(/<html(\s[^>]*)?>/i);
  if (root) return html.slice(0, root.index + root[0].length) + TAG + html.slice(root.index + root[0].length);
  const dt = html.match(/<!doctype[^>]*>/i);
  if (dt) return html.slice(0, dt.index + dt[0].length) + TAG + html.slice(dt.index + dt[0].length);
  return TAG + html;
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function bootingPage(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Starting…</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;color:#6b6b6b;background:#f6f4ef}
.d{width:8px;height:8px;border-radius:50%;background:#e15001;display:inline-block;margin-right:8px;animation:p 1s infinite}@keyframes p{50%{opacity:.2}}</style></head>
<body><div><span class="d"></span>${message}</div></body></html>`;
}

/**
 * Stream an HTML response through, inserting the runtime tag right after <head>.
 * Buffers only until the tag position is known (or 128 KB).
 */
function pipeInjected(src, res) {
  let buf = '';
  let done = false;
  src.setEncoding('utf8');
  src.on('data', (chunk) => {
    if (done) return void res.write(chunk);
    buf += chunk;
    if (/<head(\s[^>]*)?>/i.test(buf) || /<body/i.test(buf) || buf.length > 131072) {
      done = true;
      res.write(injectTag(buf));
      buf = '';
    }
  });
  src.on('end', () => {
    if (!done) res.write(injectTag(buf));
    res.end();
  });
  src.on('error', () => res.end());
}

export function createProxy({ instanceId, mocks, target, onReport = () => {}, version = '0.1.0' }) {
  const sseClients = new Set();
  let watcher = null;

  const runtimeScript = () => {
    let code = '';
    try {
      code = fs.readFileSync(RUNTIME_FILE, 'utf8');
    } catch {
      code = '/* runtime missing */';
    }
    const cfg = { instance: instanceId, version, wsRules: mocks ? mocks.wsRules() : [] };
    return `window.__EASEL_CONFIG__=${JSON.stringify(cfg)};\n${code}`;
  };

  function send(res, status, headers, body) {
    res.writeHead(status, headers);
    res.end(body);
  }

  async function answer(res, r) {
    if (r.hang) return; // "loading" state: never answer; the browser keeps waiting
    if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
    if (r.networkError) {
      const why = r.error ? `unreachable: ${String(r.error).slice(0, 160)}` : 'offline state';
      return send(res, 502, { 'x-easel-network-error': encodeURIComponent(why), 'content-type': 'text/plain' }, `Easel: network error (${why})`);
    }
    send(res, r.status || 200, { ...r.headers, 'x-easel-mock': '1', 'cache-control': 'no-store' }, r.body);
  }

  function stateOf(req, url) {
    return String(req.headers['x-easel-state'] || url.searchParams.get('__easel_state') || 'default');
  }

  async function handleEasel(req, res, url) {
    const p = url.pathname;
    if (p === '/__easel/runtime.js') return send(res, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }, runtimeScript());
    if (p === '/__easel/ping') return send(res, 200, { 'content-type': 'application/json' }, JSON.stringify({ ok: true, instance: instanceId }));
    if (p === '/__easel/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': easel\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (p === '/__easel/report') {
      try {
        const body = JSON.parse((await readBody(req, 2e6)).toString('utf8') || '{}');
        onReport(body);
      } catch {
        /* ignore malformed */
      }
      return send(res, 204, {}, '');
    }
    if (p === '/__easel/net') {
      const target = String(req.headers['x-easel-url'] || url.searchParams.get('url') || '');
      if (!/^https?:\/\//.test(target)) return send(res, 400, { 'content-type': 'text/plain' }, 'x-easel-url required');
      const method = String(req.headers['x-easel-method'] || req.method).toUpperCase();
      const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req);
      const r = mocks ? await mocks.handleNet({ method, url: target, headers: req.headers, body, state: stateOf(req, url) }) : { networkError: true };
      return answer(res, r);
    }
    return send(res, 404, { 'content-type': 'text/plain' }, 'unknown easel endpoint');
  }

  function serveStatic(req, res, url) {
    const root = target.staticRoot;
    let rel = decodeURIComponent(url.pathname);
    let file;
    try {
      file = safeJoin(root, rel);
    } catch {
      return send(res, 403, {}, 'forbidden');
    }
    let st = null;
    try {
      st = fs.statSync(file);
      if (st.isDirectory()) {
        const idx = ['index.html', 'index.htm'].map((f) => path.join(file, f)).find((f) => fs.existsSync(f));
        if (!idx) st = null;
        else {
          file = idx;
          st = fs.statSync(file);
        }
      }
    } catch {
      st = null;
    }
    if (!st && !path.extname(file) && fs.existsSync(file + '.html')) {
      file += '.html';
      st = fs.statSync(file);
    }
    if (!st) {
      return send(res, 404, { 'content-type': 'text/html; charset=utf-8' }, injectTag(`<!doctype html><html><head><title>Not found</title></head><body style="font:14px system-ui;padding:24px;color:#555">404 · ${rel.replace(/</g, '&lt;')} isn't in this site</body></html>`));
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (type.startsWith('text/html')) {
      return send(res, 200, { 'content-type': type, 'cache-control': 'no-store' }, injectTag(fs.readFileSync(file, 'utf8')));
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  function forward(req, res, url) {
    const isDoc = /text\/html/.test(req.headers.accept || '') || req.headers['sec-fetch-dest'] === 'document' || req.headers['sec-fetch-dest'] === 'iframe';
    const headers = { ...req.headers };
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-forwarded-proto'] = 'http';
    if (isDoc) headers['accept-encoding'] = 'identity';
    delete headers['x-easel-state'];
    const preq = http.request({ host: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers }, (pres) => {
      const h = { ...pres.headers };
      for (const k of STRIP) delete h[k];
      if (h.location) h.location = String(h.location).replace(new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0):${target.port}`), `http://${req.headers.host}`);
      if (h['set-cookie']) h['set-cookie'] = [].concat(h['set-cookie']).map((c) => c.replace(/;\s*Domain=[^;]*/i, ''));
      const ct = String(h['content-type'] || '');
      const isHtml = ct.includes('text/html') && req.method !== 'HEAD' && pres.statusCode !== 204 && pres.statusCode !== 304;
      if (!isHtml) {
        res.writeHead(pres.statusCode, h);
        return void pres.pipe(res);
      }
      const enc = String(h['content-encoding'] || '').toLowerCase();
      delete h['content-length'];
      delete h['content-encoding'];
      delete h.etag;
      h['cache-control'] = 'no-store';
      res.writeHead(pres.statusCode, h);
      let src = pres;
      if (enc === 'gzip' || enc === 'x-gzip') src = pres.pipe(zlib.createGunzip());
      else if (enc === 'br') src = pres.pipe(zlib.createBrotliDecompress());
      else if (enc === 'deflate') src = pres.pipe(zlib.createInflate());
      pipeInjected(src, res);
    });
    preq.on('error', (e) => {
      if (res.headersSent) return res.end();
      const starting = e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET';
      if (isDoc) send(res, 503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '2' }, bootingPage(starting ? 'Starting the app…' : 'App not reachable: ' + e.code));
      else send(res, 503, { 'content-type': 'text/plain' }, 'app not reachable');
    });
    req.pipe(preq);
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      return send(res, 400, {}, 'bad url');
    }
    try {
      if (url.pathname.startsWith('/__easel/')) return await handleEasel(req, res, url);
      if (mocks) {
        const r = mocks.handleSameOrigin(req.method, url.pathname, stateOf(req, url));
        if (r) return await answer(res, r);
      }
      if (target.staticRoot != null) return serveStatic(req, res, url);
      return forward(req, res, url);
    } catch (e) {
      if (!res.headersSent) send(res, 500, { 'content-type': 'text/plain' }, 'Easel proxy error: ' + e.message);
      else res.end();
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (!target.port) return socket.destroy();
    const up = net.connect(target.port, '127.0.0.1', () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      up.write(raw + '\r\n');
      if (head && head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });

  function broadcast(type) {
    for (const c of sseClients) {
      try {
        c.write(`data: ${JSON.stringify({ type })}\n\n`);
      } catch {
        sseClients.delete(c);
      }
    }
  }

  return {
    server,
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(port));
      });
    },
    watchStatic(onChange) {
      if (target.staticRoot == null) return;
      try {
        let t = null;
        watcher = fs.watch(target.staticRoot, { recursive: true }, (ev, file) => {
          if (file && /(^|[/\\])(\.git|node_modules|easel\.mocks)([/\\]|$)/.test(file)) return;
          clearTimeout(t);
          t = setTimeout(() => {
            broadcast('reload');
            onChange(file);
          }, 120);
        });
      } catch {
        /* recursive watch unsupported */
      }
    },
    broadcast,
    close() {
      try {
        watcher?.close();
      } catch {
        /* ignore */
      }
      for (const c of sseClients) c.end();
      return new Promise((r) => {
        server.close(() => r());
        server.closeAllConnections?.();
      });
    },
  };
}
