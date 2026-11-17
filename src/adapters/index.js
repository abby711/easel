// Stack detection. An adapter answers three questions for one stack:
//   how to install it, how to start it on a given port, and where its routes are.
// Everything else in Easel (proxy, runtime, mocks, canvas, copies) is stack-agnostic.
import fs from 'node:fs';
import path from 'node:path';
import { makeCtx } from './context.js';
import { nodeAdapters } from './node.js';
import { pythonAdapters } from './python.js';
import { otherAdapters, missingToolchain } from './other.js';
import { normalizeRoutes } from '../routes.js';
import { IGNORED_DIRS } from '../util.js';

export const ADAPTERS = [...otherAdapters.filter((a) => a.id === 'custom'), ...nodeAdapters, ...pythonAdapters, ...otherAdapters.filter((a) => a.id !== 'custom')];
export const byId = (id) => ADAPTERS.find((a) => a.id === id);
export { makeCtx, missingToolchain };

/** Score every adapter for one folder; best first. */
export function detectDir(dir, opts = {}) {
  const ctx = makeCtx(dir, opts);
  const scored = [];
  for (const a of ADAPTERS) {
    let s = 0;
    try {
      s = a.detect(ctx) || 0;
    } catch {
      s = 0;
    }
    if (s > 0) scored.push({ adapter: a.id, label: a.describe ? a.describe(ctx) : a.label, lang: a.lang, score: s });
  }
  return scored.sort((x, y) => y.score - x.score);
}

const APP_DIR_HINTS = ['apps', 'packages', 'frontend', 'client', 'web', 'app', 'site', 'www', 'backend', 'server', 'ui', 'src', 'services', 'examples', 'demo'];

/**
 * Find app candidates in a repo, including monorepos (up to two levels deep).
 * Returns [{subdir, adapter, label, lang, score}] best first.
 */
export function detectRepo(repoDir) {
  const out = [];
  const consider = (sub) => {
    const res = detectDir(path.join(repoDir, sub));
    if (res.length) out.push({ subdir: sub, ...res[0], alternatives: res.slice(1, 4) });
  };
  consider('');
  const kids = (rel) => {
    try {
      return fs.readdirSync(path.join(repoDir, rel), { withFileTypes: true }).filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')).map((e) => (rel ? rel + '/' : '') + e.name);
    } catch {
      return [];
    }
  };
  const rootPkg = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
    } catch {
      return null;
    }
  })();
  const isWorkspaceRoot = rootPkg && (rootPkg.workspaces || fs.existsSync(path.join(repoDir, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(repoDir, 'turbo.json')) || fs.existsSync(path.join(repoDir, 'nx.json')));
  const rootScore = out[0]?.score || 0;
  if (rootScore < 80 || isWorkspaceRoot) {
    for (const k of kids('')) {
      consider(k);
      if (APP_DIR_HINTS.includes(path.basename(k))) for (const k2 of kids(k)) consider(k2);
    }
  }
  // Drop a folder that's just part of an app above it (e.g. /blog inside a static site).
  const kept = out.filter((c) => !out.some((o) => o !== c && o.adapter === c.adapter && (o.subdir === '' ? c.subdir !== '' : c.subdir.startsWith(o.subdir + '/'))));
  // Prefer real frameworks over generic fallbacks; prefer shallower dirs on ties.
  return kept
    .filter((c) => c.score >= 15)
    .sort((a, b) => b.score - a.score || a.subdir.split('/').length - b.subdir.split('/').length);
}

/** Discover routes for an app folder with a given adapter. */
export function discoverRoutes(appDir, adapterId, opts = {}) {
  const a = byId(adapterId);
  if (!a) return [];
  const ctx = makeCtx(appDir, opts);
  let routes = [];
  try {
    routes = a.routes(ctx) || [];
  } catch (e) {
    routes = [{ path: '/', source: 'default', note: 'route discovery failed: ' + e.message }];
  }
  return normalizeRoutes(routes);
}
