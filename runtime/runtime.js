/* Easel runtime. Injected by the Easel proxy as the first script of every HTML page.
 * Stack-agnostic: it only touches browser APIs.
 *  - Routes cross-origin fetch/XHR through /__easel/net (mocks, record/replay, states)
 *  - Tags same-origin requests with the frame's state (x-easel-state)
 *  - Fakes WebSockets that have mock rules
 *  - Talks to the canvas over postMessage: ready, route, size, errors, links, style census, inspector picks
 * window.__EASEL_CONFIG__ is prepended by the proxy.
 */
(function () {
  'use strict';
  if (window.__EASEL_RUNTIME__) return;
  window.__EASEL_RUNTIME__ = true;
  var C = window.__EASEL_CONFIG__ || {};
  var NET = '/__easel/net';
  var origin = location.origin;

  // ---- frame identity & state (window.name survives navigation inside the iframe) ----
  var frame = {};
  try {
    if (typeof window.name === 'string' && window.name.indexOf('easel:') === 0) frame = JSON.parse(window.name.slice(6)) || {};
  } catch (e) { frame = {}; }
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('__easel_state')) frame.state = qs.get('__easel_state');
  } catch (e) { /* old browser */ }
  var state = frame.state || C.defaultState || 'default';
  var inFrame = window.parent && window.parent !== window;

  function post(type, data) {
    var msg = { __easel: true, frameId: frame.id || null, instance: C.instance, type: type, data: data };
    if (inFrame) { try { window.parent.postMessage(msg, '*'); } catch (e) { /* ignore */ } }
    if (type === 'error' || type === 'census' || type === 'links' || type === 'ready') {
      try {
        var body = JSON.stringify(msg);
        if (navigator.sendBeacon) navigator.sendBeacon('/__easel/report', new Blob([body], { type: 'application/json' }));
      } catch (e) { /* ignore */ }
    }
  }

  function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return String(u); } }
  function isCross(u) {
    try {
      var x = new URL(u, location.href);
      return (x.protocol === 'http:' || x.protocol === 'https:') && x.origin !== origin;
    } catch (e) { return false; }
  }

  // ---- fetch ----
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function netError(res) {
    var ne = res && res.headers && res.headers.get('x-easel-network-error');
    if (ne) {
      var why = ne;
      try { why = decodeURIComponent(ne); } catch (e) { /* raw */ }
      throw new TypeError('Failed to fetch (Easel: ' + why + ')');
    }
    return res;
  }
  if (realFetch) {
    window.fetch = function (input, init) {
      try {
        var isReq = typeof Request !== 'undefined' && input instanceof Request;
        var url = isReq ? input.url : String(input && input.href ? input.href : input);
        init = init || {};
        var method = String(init.method || (isReq ? input.method : 'GET')).toUpperCase();
        var headers = new Headers(init.headers || (isReq ? input.headers : undefined));
        if (isCross(url)) {
          headers.set('x-easel-url', absUrl(url));
          headers.set('x-easel-method', method);
          headers.set('x-easel-state', state);
          var simple = method === 'GET' || method === 'HEAD';
          var send = function (body) {
            return realFetch(NET, { method: simple ? 'GET' : 'POST', headers: headers, body: simple ? undefined : body, signal: init.signal, credentials: 'same-origin' }).then(netError);
          };
          if (isReq && init.body === undefined && !simple) return input.clone().arrayBuffer().then(send);
          return send(init.body);
        }
        headers.set('x-easel-state', state);
        if (isReq) return realFetch(new Request(input, { headers: headers })).then(netError);
        var copy = {};
        for (var k in init) copy[k] = init[k];
        copy.headers = headers;
        return realFetch(input, copy).then(netError);
      } catch (e) {
        return realFetch(input, init);
      }
    };
  }

  // ---- XMLHttpRequest ----
  if (window.XMLHttpRequest) {
    var XP = XMLHttpRequest.prototype;
    var xOpen = XP.open, xSend = XP.send, xSet = XP.setRequestHeader;
    XP.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      var m = String(method || 'GET').toUpperCase();
      this.__easel = { method: m, url: absUrl(url), cross: isCross(url) };
      if (this.__easel.cross) {
        args[0] = m === 'GET' || m === 'HEAD' ? 'GET' : 'POST';
        args[1] = NET;
      }
      return xOpen.apply(this, args);
    };
    XP.send = function () {
      var e = this.__easel;
      if (e) {
        try {
          if (e.cross) {
            xSet.call(this, 'x-easel-url', e.url);
            xSet.call(this, 'x-easel-method', e.method);
          }
          xSet.call(this, 'x-easel-state', state);
        } catch (err) { /* headers after send etc. */ }
      }
      return xSend.apply(this, arguments);
    };
  }

  // ---- WebSocket mocks ----
  var wsRules = C.wsRules || [];
  function globMatch(glob, s) {
    var re = new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(s);
  }
  if (window.WebSocket && wsRules.length) {
    var RealWS = window.WebSocket;
    var FakeWS = function (url) {
      var self = this;
      var rule = null;
      for (var i = 0; i < wsRules.length; i++) if (globMatch(wsRules[i].url, String(url))) rule = wsRules[i];
      if (!rule) return new RealWS(url, arguments[1]);
      self.url = String(url); self.readyState = 0; self.protocol = ''; self.extensions = ''; self.bufferedAmount = 0; self.binaryType = 'blob';
      self._l = {};
      var fire = function (type, ev) {
        ev.target = self;
        if (typeof self['on' + type] === 'function') self['on' + type](ev);
        (self._l[type] || []).forEach(function (fn) { fn.call(self, ev); });
      };
      self.addEventListener = function (t, fn) { (self._l[t] = self._l[t] || []).push(fn); };
      self.removeEventListener = function (t, fn) { self._l[t] = (self._l[t] || []).filter(function (x) { return x !== fn; }); };
      self.send = function (data) { if (rule.echo) setTimeout(function () { fire('message', { data: data }); }, 10); };
      self.close = function () { self.readyState = 3; fire('close', { code: 1000, reason: '', wasClean: true }); };
      setTimeout(function () {
        if (state === 'offline') { self.readyState = 3; fire('error', {}); fire('close', { code: 1006 }); return; }
        self.readyState = 1; fire('open', {});
        var msgs = (rule.states && rule.states[state]) || rule.messages || [];
        var gap = rule.interval || 400;
        msgs.forEach(function (m, idx) {
          setTimeout(function () { if (self.readyState === 1) fire('message', { data: typeof m === 'string' ? m : JSON.stringify(m) }); }, gap * (idx + 1));
        });
      }, 30);
    };
    FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
    window.WebSocket = FakeWS;
  }

  // ---- route reporting ----
  function here() { return location.pathname + location.search + location.hash; }
  function reportRoute() { post('route', { path: here(), title: document.title }); }
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    history[k] = function () { var r = orig.apply(this, arguments); setTimeout(reportRoute, 0); return r; };
  });
  window.addEventListener('popstate', reportRoute);
  window.addEventListener('hashchange', reportRoute);

  // ---- errors ----
  var errCount = 0;
  function reportError(message, extra) {
    if (errCount++ > 25) return;
    post('error', Object.assign({ message: String(message).slice(0, 500), path: here() }, extra || {}));
  }
  window.addEventListener('error', function (e) {
    if (e && e.message) reportError(e.message, { source: e.filename, line: e.lineno });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    reportError('Unhandled rejection: ' + (r && r.message ? r.message : r));
  });
  var cErr = console.error;
  console.error = function () {
    try { reportError(Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : typeof a === 'object' ? safeJson(a) : String(a); }).join(' ')); } catch (e) { /* ignore */ }
    return cErr.apply(console, arguments);
  };
  function safeJson(a) { try { return JSON.stringify(a).slice(0, 200); } catch (e) { return String(a); } }

  // ---- size & ready ----
  function height() {
    var d = document.documentElement, b = document.body;
    return Math.max(d ? d.scrollHeight : 0, b ? b.scrollHeight : 0);
  }
  var lastH = 0;
  function reportSize() {
    var h = height();
    if (Math.abs(h - lastH) > 4) { lastH = h; post('size', { height: h }); }
  }
  function links() {
    var out = {};
    var as = document.querySelectorAll('a[href]');
    for (var i = 0; i < as.length && i < 400; i++) {
      try {
        var u = new URL(as[i].getAttribute('href'), location.href);
        if (u.origin === origin && !/\.(png|jpe?g|gif|svg|pdf|zip|css|js)$/i.test(u.pathname)) out[u.pathname] = (as[i].textContent || '').trim().slice(0, 40);
      } catch (e) { /* ignore */ }
    }
    return out;
  }
  var readySent = false;
  function ready() {
    if (readySent) return;
    readySent = true;
    post('ready', { path: here(), title: document.title, height: height(), state: state });
    post('links', links());
    if (C.census !== false) setTimeout(function () { post('census', census()); }, 300);
  }
  var quiet;
  function settle() {
    clearTimeout(quiet);
    quiet = setTimeout(ready, 600);
  }
  if (document.readyState === 'complete') settle();
  else window.addEventListener('load', settle);
  setTimeout(ready, 8000); // never hang the canvas
  if (window.MutationObserver) {
    var mo = new MutationObserver(function () { if (!readySent) settle(); reportSizeSoon(); });
    var start = function () { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: false }); };
    if (document.documentElement) start();
  }
  var sizeT;
  function reportSizeSoon() { clearTimeout(sizeT); sizeT = setTimeout(reportSize, 250); }
  window.addEventListener('resize', reportSizeSoon);

  // ---- style census: what the page actually uses ----
  function census() {
    var counts = { colors: {}, backgrounds: {}, borders: {}, fonts: {}, sizes: {}, weights: {}, radii: {}, spacing: {} };
    var inc = function (bucket, k) { if (!k) return; counts[bucket][k] = (counts[bucket][k] || 0) + 1; };
    var els = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < els.length && i < 3000; i++) {
      var el = els[i];
      if (el.closest && el.closest('[data-easel-overlay]')) continue;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var hasText = false;
      for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) { hasText = true; break; }
      if (hasText) {
        inc('colors', cs.color);
        inc('fonts', cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
        inc('sizes', cs.fontSize);
        inc('weights', cs.fontWeight);
      }
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') inc('backgrounds', cs.backgroundColor);
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') inc('borders', cs.borderTopColor);
      if (cs.borderTopLeftRadius && cs.borderTopLeftRadius !== '0px') inc('radii', cs.borderTopLeftRadius);
      ['paddingTop', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'].forEach(function (p) {
        var v = cs[p];
        if (v && v !== '0px' && v !== 'normal' && /px$/.test(v)) inc('spacing', v);
      });
    }
    return counts;
  }

  // ---- inspector ----
  var inspecting = false, box = null, label = null, hovered = null;
  function overlay() {
    if (box) return;
    box = document.createElement('div');
    box.setAttribute('data-easel-overlay', '');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #e15001;background:rgba(225,80,1,.08);border-radius:2px;transition:all .05s;display:none';
    label = document.createElement('div');
    label.setAttribute('data-easel-overlay', '');
    label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#1f1f1f;color:#fff;font:11px/1.4 ui-monospace,Menlo,monospace;padding:2px 6px;border-radius:3px;display:none;white-space:nowrap';
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(label);
  }
  function domPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 8 && el !== document.documentElement) {
      var s = el.tagName.toLowerCase();
      if (el.id) { s += '#' + el.id; parts.unshift(s); break; }
      var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function sourceOf(el) {
    // React ≤18 dev builds: fiber._debugSource; Vue: __vueParentComponent.type.__file; Svelte: __svelte_meta
    try {
      for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (n.__svelte_meta && n.__svelte_meta.loc) return { file: n.__svelte_meta.loc.file, line: n.__svelte_meta.loc.line + 1, framework: 'svelte' };
        var vc = n.__vueParentComponent;
        if (vc && vc.type && vc.type.__file) return { file: vc.type.__file, framework: 'vue', component: vc.type.name || vc.type.__name };
        for (var k in n) {
          if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) {
            for (var f = n[k]; f; f = f.return) {
              if (f._debugSource) return { file: f._debugSource.fileName, line: f._debugSource.lineNumber, framework: 'react', component: f.type && (f.type.displayName || f.type.name) };
            }
            for (var g = n[k]; g; g = g.return) {
              if (g.type && typeof g.type === 'function' && (g.type.displayName || g.type.name)) return { framework: 'react', component: g.type.displayName || g.type.name };
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function describe(el) {
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean),
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      path: domPath(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: {
        color: cs.color, background: cs.backgroundColor, font: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        padding: cs.padding, margin: cs.margin, radius: cs.borderRadius, display: cs.display, gap: cs.gap,
      },
      source: sourceOf(el),
      page: here(),
    };
  }
  function onMove(e) {
    var el = e.target;
    if (!el || el === box || el === label) return;
    hovered = el;
    var r = el.getBoundingClientRect();
    box.style.display = label.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    label.textContent = domPath(el).split(' > ').pop() + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    label.style.left = Math.max(0, r.left) + 'px';
    label.style.top = Math.max(0, r.top - 20) + 'px';
  }
  function onClick(e) {
    if (!inspecting) return;
    e.preventDefault();
    e.stopPropagation();
    if (hovered) post('picked', describe(hovered));
  }
  function setInspect(on) {
    inspecting = !!on;
    overlay();
    if (on) {
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
    } else {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      box.style.display = label.style.display = 'none';
    }
  }

  // ---- commands from the canvas ----
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || !m.__easelCmd) return;
    if (m.type === 'navigate') location.assign(m.path);
    else if (m.type === 'reload') location.reload();
    else if (m.type === 'state') {
      frame.state = m.state;
      try { window.name = 'easel:' + JSON.stringify(frame); } catch (err) { /* ignore */ }
      location.reload();
    } else if (m.type === 'inspect') setInspect(m.on);
    else if (m.type === 'census') post('census', census());
    else if (m.type === 'ping') post('pong', { path: here(), state: state });
  });

  // Live reload is driven by the canvas (one event stream for all frames), not by
  // an EventSource per frame: browsers allow only ~6 connections per origin, and
  // a board can hold many frames of the same app.
  // Standalone tabs (not in a canvas) can opt in with ?__easel_live=1.
  try {
    if (!inFrame && window.EventSource && /[?&]__easel_live=1/.test(location.search)) {
      var es = new EventSource('/__easel/events');
      es.onmessage = function (ev) {
        var d = {};
        try { d = JSON.parse(ev.data); } catch (err) { return; }
        if (d.type === 'reload' || d.type === 'mocks') location.reload();
      };
    }
  } catch (e) { /* ignore */ }

  window.__easel = { state: state, frame: frame, census: census, post: post, version: C.version };
})();
