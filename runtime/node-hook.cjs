// Preloaded into Node dev servers (NODE_OPTIONS=--require ...) so server-side
// calls to external APIs go through Easel's mock engine too:
//   - global fetch()  (Next.js server components, Remix loaders, SvelteKit load, Astro frontmatter, Nuxt)
//   - http/https.request + get  (axios, got, node-fetch, the Stripe/Twilio/AWS-style SDKs)
// Local addresses (the app's own server, a local DB over HTTP) are left alone.
// Opt out with EASEL_HOOK_HTTP=0 (http module only) or by unsetting EASEL_NET_URL.
'use strict';
const NET = process.env.EASEL_NET_URL;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const isLocal = (host) => !host || LOCAL.has(host) || host.endsWith('.localhost') || host.endsWith('.local');
const STATE = () => process.env.EASEL_STATE || 'default';

function netErrorMessage(url, raw) {
  let why = raw;
  try {
    why = decodeURIComponent(raw);
  } catch (e) {
    /* keep raw */
  }
  return `request failed: ${url} (Easel: ${why}; add a mock rule for it)`;
}

if (NET && !globalThis.__EASEL_NODE_HOOK__) {
  globalThis.__EASEL_NODE_HOOK__ = true;
  const netUrl = new URL(NET);

  // ---------- fetch ----------
  if (typeof globalThis.fetch === 'function') {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async function easelFetch(input, init) {
      init = init || {};
      let url;
      try {
        url = new URL(typeof input === 'string' ? input : input && (input.url || input.href) ? input.url || input.href : String(input));
      } catch (e) {
        return realFetch(input, init);
      }
      if (isLocal(url.hostname) || !/^https?:$/.test(url.protocol)) return realFetch(input, init);
      const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
      const headers = new Headers(init.headers || (input && input.headers) || undefined);
      headers.set('x-easel-url', url.href);
      headers.set('x-easel-method', method);
      headers.set('x-easel-state', STATE());
      headers.set('x-easel-origin', 'server');
      const simple = method === 'GET' || method === 'HEAD';
      let body = simple ? undefined : init.body;
      if (!simple && body === undefined && input && typeof input.arrayBuffer === 'function') body = await input.clone().arrayBuffer();
      const opts = { method: simple ? 'GET' : 'POST', headers, body, signal: init.signal };
      if (body && typeof body.getReader === 'function') opts.duplex = 'half';
      const res = await realFetch(NET, opts);
      const netErr = res.headers.get('x-easel-network-error');
      if (netErr) throw new TypeError('fetch failed: ' + netErrorMessage(url.href, netErr));
      return res;
    };
  }

  // ---------- http / https ----------
  if (process.env.EASEL_HOOK_HTTP !== '0') {
    const http = require('http');
    const https = require('https');
    const realRequest = http.request.bind(http);

    // Normalise (url?, options?, callback?) like Node does.
    function parseArgs(defaultProtocol, args) {
      let url = null;
      let options = {};
      let cb;
      for (const a of args) {
        if (typeof a === 'function') cb = a;
        else if (typeof a === 'string' || a instanceof URL) url = new URL(String(a));
        else if (a && typeof a === 'object') options = { ...options, ...a };
      }
      const protocol = options.protocol || (url && url.protocol) || defaultProtocol;
      const hostname = options.hostname || (options.host && String(options.host).replace(/:\d+$/, '')) || (url && url.hostname) || 'localhost';
      const port = options.port || (url && url.port) || '';
      const pathName = options.path || (url ? url.pathname + url.search : '/');
      const target = `${protocol}//${hostname}${port && !((protocol === 'https:' && +port === 443) || (protocol === 'http:' && +port === 80)) ? ':' + port : ''}${pathName}`;
      return { url, options, cb, hostname, target, method: String(options.method || 'GET').toUpperCase() };
    }

    function wrap(defaultProtocol, original) {
      return function easelRequest(...args) {
        let p;
        try {
          p = parseArgs(defaultProtocol, args);
        } catch (e) {
          return original(...args);
        }
        if (isLocal(p.hostname) || p.options.socketPath || p.options.__easelPassthrough) return original(...args);
        const headers = {};
        for (const [k, v] of Object.entries(p.options.headers || {})) if (v != null) headers[k] = v;
        delete headers.host;
        delete headers.Host;
        Object.assign(headers, {
          host: netUrl.host,
          'x-easel-url': p.target,
          'x-easel-method': p.method,
          'x-easel-state': STATE(),
          'x-easel-origin': 'server',
        });
        const simple = p.method === 'GET' || p.method === 'HEAD';
        const req = realRequest(
          { host: netUrl.hostname, port: netUrl.port, path: netUrl.pathname, method: simple ? 'GET' : 'POST', headers, timeout: p.options.timeout, signal: p.options.signal },
          (res) => {
            const ne = res.headers['x-easel-network-error'];
            if (ne) {
              res.resume();
              const err = new Error(netErrorMessage(p.target, ne));
              err.code = 'ECONNREFUSED';
              req.destroy(err);
              return;
            }
            if (p.cb) p.cb(res);
          },
        );
        return req;
      };
    }

    const httpReq = wrap('http:', http.request.bind(http));
    const httpsReq = wrap('https:', https.request.bind(https));
    http.request = httpReq;
    https.request = httpsReq;
    http.get = function easelGet(...args) {
      const r = httpReq(...args);
      r.end();
      return r;
    };
    https.get = function easelGets(...args) {
      const r = httpsReq(...args);
      r.end();
      return r;
    };
  }
}
