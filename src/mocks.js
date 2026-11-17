// The mock engine. Rule files live in <app>/easel.mocks/*.json, recordings in
// <app>/easel.mocks/recorded/. No AI: you write rules, or Easel records real
// responses once and replays them. Every rule gets free derived states:
//   default · empty (arrays emptied) · error (500) · slow (+3s) · loading (never answers) · offline (network error)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MOCKS_DIR } from './config.js';
import { readJSON, writeJSON } from './util.js';

export const BUILTIN_STATES = ['default', 'empty', 'error', 'slow', 'loading', 'offline'];
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer', 'content-length', 'content-encoding', 'host']);

function globToRegex(glob) {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^]*?').replace(/\u0000/g, '[^]*');
  return new RegExp('^' + esc + '$');
}

/** Match a same-origin path pattern like /api/users/:id or /api/* */
function pathMatches(pattern, p) {
  if (pattern.includes('*')) return globToRegex(pattern).test(p);
  const a = pattern.replace(/\/$/, '').split('/');
  const b = p.replace(/\/$/, '').split('/');
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.startsWith(':') || s === b[i]);
}

/** Recursively empty every array: the "empty state" of any JSON. */
export function emptied(v) {
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = emptied(x);
    return o;
  }
  return v;
}

export class MockEngine {
  constructor(appDir, { onChange } = {}) {
    this.appDir = appDir;
    this.dir = path.join(appDir, MOCKS_DIR);
    this.onChange = onChange || (() => {});
    this.rules = [];
    this.recorded = [];
    this.log = [];
    this.config = { mode: 'auto' };
    this.load();
    this.watch();
  }

  load() {
    this.config = { mode: 'auto', ...(readJSON(path.join(this.dir, '_config.json'), {}) || {}) };
    const rules = [];
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    } catch {
      /* no mocks yet */
    }
    for (const f of files) {
      const doc = readJSON(path.join(this.dir, f), null);
      if (!doc) continue;
      const list = Array.isArray(doc) ? doc : doc.rules || (doc.match ? [doc] : []);
      list.forEach((r, i) => rules.push(this.normalize(r, `${f}#${r.id || i}`, f)));
    }
    this.rules = rules;
    const rec = [];
    try {
      for (const f of fs.readdirSync(path.join(this.dir, 'recorded')).filter((x) => x.endsWith('.json'))) {
        const r = readJSON(path.join(this.dir, 'recorded', f), null);
        if (r) rec.push(this.normalize(r, 'recorded/' + f, 'recorded/' + f));
      }
    } catch {
      /* none */
    }
    this.recorded = rec;
  }

  normalize(r, id, file) {
    const states = r.states || {};
    if (r.response && !states.default) states.default = r.response;
    const m = r.match || {};
    return {
      id: r.id || id,
      file,
      method: (m.method || '*').toUpperCase(),
      url: m.url || null,
      path: m.path || null,
      urlRe: m.url ? globToRegex(m.url.split('#')[0]) : null,
      ws: r.ws || null,
      states,
      note: r.note || '',
    };
  }

  watch() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      let t = null;
      this.watcher = fs.watch(this.dir, { recursive: true }, () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const self = Date.now() - (this._selfWrite || 0) < 1000;
          this.load();
          if (!self) this.onChange();
        }, 150);
      });
    } catch {
      /* fs.watch unsupported */
    }
  }

  close() {
    try {
      this.watcher?.close();
    } catch {
      /* ignore */
    }
  }

  setMode(mode) {
    this._selfWrite = Date.now();
    this.config.mode = mode;
    writeJSON(path.join(this.dir, '_config.json'), this.config);
  }

  /** Rules that apply to WebSocket URLs (sent to the browser runtime). */
  wsRules() {
    return this.rules.filter((r) => r.ws && r.url).map((r) => ({ id: r.id, url: r.url, ...r.ws }));
  }

  find(list, method, url, samePath) {
    for (const r of list) {
      if (r.method !== '*' && r.method !== method) continue;
      if (samePath != null) {
        if (r.path && pathMatches(r.path, samePath)) return r;
        continue;
      }
      if (r.urlRe) {
        const noQuery = url.split('?')[0];
        if (r.urlRe.test(r.url.includes('?') ? url : noQuery)) return r;
      }
    }
    return null;
  }

  /** Build a response object for a rule in a given state. */
  respond(rule, state) {
    const base = rule.states.default || { status: 200, json: null };
    let s = rule.states[state];
    if (!s) {
      if (state === 'empty') s = { ...base, json: base.json !== undefined ? emptied(base.json) : undefined };
      else if (state === 'error') s = { status: 500, json: { error: 'Simulated error (Easel error state)' } };
      else if (state === 'slow') s = { ...base, delay: (base.delay || 0) + 3000 };
      else if (state === 'loading') s = { ...base, hang: true };
      else if (state === 'offline') s = { networkError: true };
      else s = base;
    }
    if (s.networkError) return { networkError: true };
    const headers = { ...(s.headers || {}) };
    let body;
    if (s.json !== undefined) {
      body = Buffer.from(JSON.stringify(s.json));
      headers['content-type'] ||= 'application/json; charset=utf-8';
    } else if (s.file) {
      try {
        body = fs.readFileSync(path.join(this.dir, s.file));
      } catch {
        body = Buffer.from('');
      }
    } else if (s.bodyBase64) body = Buffer.from(s.bodyBase64, 'base64');
    else body = Buffer.from(s.text ?? s.body ?? '');
    if (!headers['content-type'] && s.text != null) headers['content-type'] = 'text/plain; charset=utf-8';
    return { status: s.status || 200, headers, body, delay: s.delay || 0, hang: !!s.hang };
  }

  record(entry) {
    this.log.push({ t: Date.now(), ...entry });
    if (this.log.length > 300) this.log.shift();
  }

  /**
   * Same-origin request (the app calling its own backend). Returns a response
   * when a rule matches, otherwise null so the proxy forwards to the app.
   */
  handleSameOrigin(method, pathname, state) {
    if (this.config.mode === 'off') return null;
    const rule = this.find(this.rules, method, null, pathname);
    if (!rule) {
      if (state === 'offline' && /^\/(api|graphql|trpc)\b/.test(pathname)) return { networkError: true };
      return null;
    }
    const r = this.respond(rule, state);
    this.record({ method, url: pathname, rule: rule.id, state, outcome: 'mock', status: r.status || 0 });
    return r;
  }

  /**
   * Cross-origin request routed through /__easel/net.
   * auto: rules → recorded → live (and record it)   live: rules → live
   * replay: rules → recorded → 504                   off: live, no rules
   */
  async handleNet({ method, url, headers, body, state }) {
    const mode = this.config.mode || 'auto';
    const t0 = Date.now();
    if (mode !== 'off') {
      const rule = this.find(this.rules, method, url, null) || ((mode === 'auto' || mode === 'replay') && this.find(this.recorded, method, url, null));
      if (rule) {
        const r = this.respond(rule, state);
        this.record({ method, url, rule: rule.id, state, outcome: rule.file.startsWith('recorded/') ? 'replay' : 'mock', status: r.status || 0 });
        return r;
      }
      if (state === 'offline') {
        this.record({ method, url, state, outcome: 'offline', status: 0 });
        return { networkError: true };
      }
      if (mode === 'replay') {
        this.record({ method, url, state, outcome: 'miss', status: 504 });
        return { status: 504, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ error: 'Not recorded (Easel replay mode)', url })) };
      }
    }
    // Live request.
    try {
      const h = {};
      for (const [k, v] of Object.entries(headers || {})) {
        const lk = k.toLowerCase();
        if (HOP.has(lk) || lk.startsWith('x-easel') || lk === 'origin' || lk === 'referer' || lk === 'cookie' || lk.startsWith('sec-')) continue;
        h[lk] = v;
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(url, { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'follow', signal: ctl.signal });
      const buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(timer);
      const outHeaders = {};
      res.headers.forEach((v, k) => {
        if (!HOP.has(k) && k !== 'set-cookie') outHeaders[k] = v;
      });
      let outcome = 'live';
      if (mode === 'auto' && res.ok && buf.length <= MAX_RECORD_BYTES) {
        this.saveRecording(method, url, res.status, outHeaders, buf);
        outcome = 'recorded';
      }
      this.record({ method, url, state, outcome, status: res.status, ms: Date.now() - t0 });
      return { status: res.status, headers: outHeaders, body: buf };
    } catch (e) {
      this.record({ method, url, state, outcome: 'error', status: 0, error: String(e.message || e) });
      return { networkError: true, error: String(e.message || e) };
    }
  }

  saveRecording(method, url, status, headers, buf) {
    const u = new URL(url);
    const h = crypto.createHash('sha1').update(method + ' ' + url.split('#')[0]).digest('hex').slice(0, 8);
    const name = `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 80) + '_' + h + '.json';
    const ct = headers['content-type'] || '';
    const resp = { status, headers: { 'content-type': ct } };
    if (/json/.test(ct)) {
      try {
        resp.json = JSON.parse(buf.toString('utf8'));
      } catch {
        resp.text = buf.toString('utf8');
      }
    } else if (/^text\/|javascript|xml|svg/.test(ct)) resp.text = buf.toString('utf8');
    else resp.bodyBase64 = buf.toString('base64');
    const rule = { id: 'rec-' + h, note: `Recorded ${new Date().toISOString()}`, match: { method, url: url.split('#')[0] }, states: { default: resp } };
    const file = path.join(this.dir, 'recorded', name);
    try {
      this._selfWrite = Date.now();
      writeJSON(file, rule);
      this.recorded.push(this.normalize(rule, 'recorded/' + name, 'recorded/' + name));
    } catch {
      /* read-only? ignore */
    }
  }

  /** All states any rule defines (for the state picker). */
  states() {
    const s = new Set(BUILTIN_STATES);
    for (const r of [...this.rules, ...this.recorded]) Object.keys(r.states).forEach((k) => s.add(k));
    return [...s];
  }

  summary() {
    const pub = (r) => ({ id: r.id, file: r.file, method: r.method, url: r.url, path: r.path, states: Object.keys(r.states), ws: !!r.ws, note: r.note });
    return { mode: this.config.mode, dir: MOCKS_DIR, rules: this.rules.map(pub), recorded: this.recorded.map(pub), states: this.states(), log: this.log.slice(-100) };
  }
}
