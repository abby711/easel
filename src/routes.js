// Route discovery helpers shared by stack adapters.
// Everything here is static analysis (file conventions + pattern matching) or
// crawling a running app. No AI: when we can't be sure, we say so (`guessed`).
import path from 'node:path';
import { walk, readText, lineOf } from './util.js';

/** Normalise and dedupe a list of routes. */
export function normalizeRoutes(list) {
  const seen = new Map();
  for (const r of list) {
    if (!r || r.path == null) continue;
    let p = String(r.path).trim();
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1) p = p.replace(/\/$/, '');
    const dynamic = /[:*]|\{|</.test(p);
    const key = p;
    if (!seen.has(key)) seen.set(key, { ...r, path: p, dynamic });
    else {
      const prev = seen.get(key);
      if (!prev.file && r.file) seen.set(key, { ...prev, file: r.file, line: r.line });
    }
  }
  return [...seen.values()].sort((a, b) => {
    if (a.path === '/') return -1;
    if (b.path === '/') return 1;
    return a.path.localeCompare(b.path);
  });
}

/** Replace bracket params: [[...x]] -> :x*?  [...x] -> :x*  [[x]] -> :x?  [x] / [x=matcher] -> :x */
function brackets(seg) {
  return seg
    .replace(/^\[\[\.\.\.([^\]]+)\]\]$/, ':$1*?')
    .replace(/^\[\.\.\.([^\]]+)\]$/, ':$1*')
    .replace(/^\[\[([^\]=]+)(=[^\]]+)?\]\]$/, ':$1?')
    .replace(/\[([^\]=]+)(=[^\]]+)?\]/g, ':$1');
}

const isGroup = (s) => /^\(.*\)$/.test(s);

/** Generic file-convention router. */
function fileRoutes(dir, { roots, exts, toSegments, filter = () => true }) {
  const out = [];
  for (const root of roots) {
    const files = walk(path.join(dir, root), { exts, max: 5000 });
    for (const f of files) {
      if (!filter(f)) continue;
      const segs = toSegments(f);
      if (!segs) continue;
      out.push({ path: '/' + segs.filter((s) => s !== '').join('/'), file: path.posix.join(root, f), source: 'files' });
    }
  }
  return out;
}

export function nextAppRoutes(dir) {
  const roots = ['app', 'src/app'];
  return fileRoutes(dir, {
    roots,
    exts: ['.js', '.jsx', '.ts', '.tsx', '.mdx', '.md'],
    filter: (f) => /(^|\/)page\.(jsx?|tsx?|mdx?)$/.test(f),
    toSegments: (f) => {
      const segs = f.split('/').slice(0, -1);
      if (segs.some((s) => s.startsWith('(.') || s.startsWith('_'))) return null; // intercepting / private
      return segs.filter((s) => !isGroup(s) && !s.startsWith('@')).map(brackets);
    },
  });
}

export function nextPagesRoutes(dir) {
  return fileRoutes(dir, {
    roots: ['pages', 'src/pages'],
    exts: ['.js', '.jsx', '.ts', '.tsx', '.mdx', '.md'],
    filter: (f) => !f.startsWith('api/') && !/(^|\/)_[^/]+$/.test(f.replace(/\.[^.]+$/, '')),
    toSegments: (f) => f.replace(/\.[^.]+$/, '').split('/').map((s) => (s === 'index' ? '' : brackets(s))),
  });
}

export function svelteKitRoutes(dir) {
  return fileRoutes(dir, {
    roots: ['src/routes'],
    exts: ['.svelte'],
    filter: (f) => /(^|\/)\+page(@[^.]*)?\.svelte$/.test(f),
    toSegments: (f) => f.split('/').slice(0, -1).filter((s) => !isGroup(s)).map(brackets),
  });
}

export function nuxtRoutes(dir) {
  return fileRoutes(dir, {
    roots: ['pages', 'app/pages', 'src/pages'],
    exts: ['.vue'],
    toSegments: (f) =>
      f
        .replace(/\.vue$/, '')
        .split('/')
        .filter((s) => !isGroup(s))
        .map((s) => (s === 'index' ? '' : s.startsWith('_') ? ':' + s.slice(1) : brackets(s))),
  });
}

/**
 * File-based routing plugins for Vite SPAs: Vue Router's own (vue-router/vite), unplugin-vue-router,
 * vite-plugin-pages, generouted. Convention: src/pages, index → "", [id] → :id, [...all] → catch-all.
 */
export function pagesDirRoutes(dir, roots = ['src/pages', 'pages']) {
  return fileRoutes(dir, {
    roots,
    exts: ['.vue', '.jsx', '.tsx', '.js', '.ts', '.md', '.mdx', '.svelte'],
    filter: (f) => !f.split('/').some((s) => s.startsWith('_') || s.startsWith('.') || s === 'components') && !/^README\.md$/i.test(path.basename(f)) && !/^404\./.test(path.basename(f)),
    toSegments: (f) =>
      f
        .replace(/\.[^.]+$/, '')
        .split('/')
        .filter((s) => !isGroup(s))
        .map((s) => (s === 'index' ? '' : brackets(s))),
  });
}

export function astroRoutes(dir) {
  return fileRoutes(dir, {
    roots: ['src/pages'],
    exts: ['.astro', '.md', '.mdx', '.html', '.markdoc'],
    filter: (f) => !f.split('/').some((s) => s.startsWith('_')),
    toSegments: (f) => f.replace(/\.[^.]+$/, '').split('/').map((s) => (s === 'index' ? '' : brackets(s))),
  });
}

export function gatsbyRoutes(dir) {
  return fileRoutes(dir, {
    roots: ['src/pages'],
    exts: ['.js', '.jsx', '.ts', '.tsx'],
    filter: (f) => !f.split('/').some((s) => s.startsWith('_')),
    toSegments: (f) =>
      f.replace(/\.[^.]+$/, '').split('/').map((s) => (s === 'index' ? '' : s.replace(/^\[(.+)\]$/, ':$1').replace(/\{.*\}/, ':param'))),
  });
}

/** Remix / React Router v7 flat-file routes: users.$id.tsx, _index.tsx, ($lang).about.tsx */
export function remixFlatRoutes(dir) {
  const out = [];
  for (const root of ['app/routes']) {
    const files = walk(path.join(dir, root), { exts: ['.js', '.jsx', '.ts', '.tsx', '.md', '.mdx'], max: 3000 });
    for (const f of files) {
      let name;
      const parts = f.split('/');
      if (parts.length === 1) name = f.replace(/\.[^.]+$/, '');
      else if (/^route\.[jt]sx?$/.test(parts[parts.length - 1])) name = parts.slice(0, -1).join('.');
      else continue; // helper modules inside route folders
      const segs = [];
      for (let s of name.split(/(?<!\[)\.(?![^[]*\])/)) {
        if (s === '_index' || s === 'index') continue;
        if (s.startsWith('_')) continue; // pathless layout
        if (s.endsWith('_')) s = s.slice(0, -1);
        s = s.replace(/\[(.)\]/g, '$1');
        if (s === '$') segs.push('*');
        else if (/^\(\$(.+)\)$/.test(s)) segs.push(':' + s.slice(2, -1) + '?');
        else if (/^\((.+)\)$/.test(s)) segs.push(s.slice(1, -1));
        else if (s.startsWith('$')) segs.push(':' + s.slice(1));
        else segs.push(s);
      }
      out.push({ path: '/' + segs.join('/'), file: path.posix.join(root, f), source: 'files' });
    }
  }
  return out;
}

/** React Router v7 framework mode: app/routes.ts with route("path", ...) / index(...) */
export function reactRouterConfigRoutes(dir) {
  const out = [];
  for (const f of ['app/routes.ts', 'app/routes.js', 'app/routes.tsx']) {
    const text = readText(path.join(dir, f), null);
    if (!text) continue;
    if (/\bindex\(/.test(text)) out.push({ path: '/', file: f, source: 'config' });
    for (const m of text.matchAll(/\broute\(\s*['"`]([^'"`]*)['"`]/g)) {
      out.push({ path: '/' + m[1], file: f, line: lineOf(text, m.index), source: 'config' });
    }
  }
  return out;
}

/** TanStack Router file-based routes (src/routes). */
export function tanstackRoutes(dir) {
  const out = [];
  const files = walk(path.join(dir, 'src/routes'), { exts: ['.tsx', '.jsx', '.ts', '.js'], max: 3000 });
  for (const f of files) {
    if (/__root\./.test(f) || /\.lazy\./.test(f) && false) continue;
    const segs = [];
    for (let s of f.replace(/\.(lazy\.)?[jt]sx?$/, '').split(/[/.]/)) {
      if (s === 'index' || s === 'route' || s === '' || s.startsWith('__')) continue;
      if (s.startsWith('_') || isGroup(s) || s.startsWith('-')) continue;
      if (s.endsWith('_')) s = s.slice(0, -1);
      if (s === '$') segs.push('*');
      else if (s.startsWith('$')) segs.push(':' + s.slice(1));
      else segs.push(s);
    }
    out.push({ path: '/' + segs.join('/'), file: 'src/routes/' + f, source: 'files' });
  }
  return out;
}

/**
 * Pattern-based routes inside source files. `patterns` are regexes with the
 * route path in capture group `p` (named) or group 1.
 */
export function grepRoutes(dir, { exts, patterns, mustInclude = null, roots = [''], prefix = '' }) {
  const out = [];
  for (const root of roots) {
    const files = walk(path.join(dir, root), { exts, max: 4000 });
    for (const f of files) {
      if (/(^|\/)(__tests__|__mocks__|tests?|e2e|cypress|playwright|stories|fixtures)\/|\.(test|spec|stories|e2e)\.[a-z]+$/i.test(f)) continue;
      const text = readText(path.join(dir, root, f), '');
      if (!text || text.length > 800000) continue;
      if (mustInclude && !mustInclude.test(text)) continue;
      for (const re of patterns) {
        for (const m of text.matchAll(re)) {
          const p = m.groups?.p ?? m[1];
          if (p == null || /^https?:/.test(p) || p.includes('${')) continue;
          out.push({ path: prefix + (p.startsWith('/') ? p : '/' + p), file: path.posix.join(root, f), line: lineOf(text, m.index), source: 'code', guessed: !p.startsWith('/') });
        }
      }
    }
  }
  return out;
}

/** Static sites / plain PHP: one route per page file. */
export function pageFileRoutes(dir, root = '', exts = ['.html', '.htm']) {
  const files = walk(path.join(dir, root), { exts, max: 3000 });
  return files
    .filter((f) => !f.split('/').some((s) => s.startsWith('_') || s === 'partials' || s === 'includes' || s === 'templates'))
    .map((f) => {
      let p = '/' + f;
      p = p.replace(/\/index\.(html?|php)$/, '/');
      return { path: p, file: path.posix.join(root, f), source: 'files' };
    });
}

/**
 * Crawl a running app (through the Easel proxy) and collect same-origin links.
 * Works for any server-rendered stack. SPAs report links from the runtime instead.
 */
export async function crawl(baseUrl, { max = 40, depth = 2, timeout = 8000 } = {}) {
  const base = new URL(baseUrl);
  const seen = new Set(['/']);
  let frontier = ['/'];
  const found = [];
  for (let d = 0; d <= depth && frontier.length && found.length < max; d++) {
    const next = [];
    for (const p of frontier) {
      if (found.length >= max) break;
      let html = '';
      let status = 0;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), timeout);
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(new URL(p, base), { signal: ctl.signal, redirect: 'follow', headers: { accept: 'text/html' } });
        clearTimeout(t);
        status = res.status;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('html')) html = await res.text(); // eslint-disable-line no-await-in-loop
      } catch {
        continue;
      }
      if (status < 400) found.push({ path: p, source: 'crawl' });
      for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
        let u;
        try {
          u = new URL(m[1], new URL(p, base));
        } catch {
          continue;
        }
        if (u.host !== base.host) continue;
        if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|xml|json|txt|mp4|woff2?)$/i.test(u.pathname)) continue;
        if (u.pathname.startsWith('/__easel')) continue;
        const key = u.pathname;
        if (!seen.has(key)) {
          seen.add(key);
          next.push(key);
        }
      }
    }
    frontier = next;
  }
  return found;
}

/** Fill `:param` placeholders from a sample map; returns null when something is unfilled. */
export function fillParams(routePath, samples = {}) {
  let ok = true;
  const out = routePath
    .split('/')
    .map((s) => {
      const m = s.match(/^:([A-Za-z0-9_-]+)(\*)?(\?)?$/) || s.match(/^<(?:\w+:)?(\w+)>$/) || s.match(/^\{(\w+)\??\}$/);
      if (!m && /:[A-Za-z_]/.test(s)) {
        // a param inside a segment, e.g. "@:user" or "post-:id"
        return s.replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
          const v = samples[k];
          if (v == null || v === '') ok = false;
          return v == null ? '' : encodeURIComponent(v);
        });
      }
      if (!m) return s === '*' ? (samples['*'] ?? (ok = false)) : s;
      const v = samples[m[1]];
      if (v != null && v !== '') return encodeURIComponent(v);
      if (m[3] || s.endsWith('?}')) return '';
      ok = false;
      return s;
    })
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/(.)\/$/, '$1');
  return ok ? out || '/' : null;
}
