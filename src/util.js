// Small shared helpers. Zero dependencies on purpose: Easel must install anywhere.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function id(prefix = '') {
  return prefix + crypto.randomBytes(5).toString('hex');
}

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
}

export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function readText(file, fallback = null) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'vendor', '.venv', 'venv', 'env', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.output', 'dist', 'build', 'out', 'coverage',
  '.cache', '.parcel-cache', '.turbo', '.vercel', '.idea', '.vscode', 'target', 'bin', 'obj',
  'tmp', 'log', 'storage', '.angular', '.expo', '.gradle', '_build', 'deps', 'public/build',
  '.easel', '.easel-venv',
]);

/**
 * Walk a directory and return relative POSIX paths of files.
 * opts.exts: array of extensions to keep (e.g. ['.js', '.tsx']); opts.max: cap on results.
 */
export function walk(root, opts = {}) {
  const { exts = null, max = 20000, ignore = IGNORED_DIRS, maxDepth = 25 } = opts;
  const out = [];
  const stack = [['', 0]];
  while (stack.length && out.length < max) {
    const [rel, depth] = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (ignore.has(e.name) || ignore.has(r) || depth >= maxDepth) continue;
        stack.push([r, depth + 1]);
      } else if (e.isFile()) {
        if (!exts || exts.includes(path.extname(e.name).toLowerCase())) out.push(r);
        if (out.length >= max) break;
      }
    }
  }
  return out.sort();
}

/** Find a free TCP port, starting at `start`. */
export async function freePort(start = 4810, host = '127.0.0.1') {
  for (let p = start; p < start + 2000; p++) {
    if (taken.has(p)) continue;
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.unref();
      srv.once('error', () => resolve(false));
      srv.listen(p, host, () => srv.close(() => resolve(true)));
    });
    if (ok) {
      taken.add(p);
      return p;
    }
  }
  throw new Error('No free port found');
}
const taken = new Set();
export function releasePort(p) {
  taken.delete(p);
}

/** Resolve when something accepts TCP connections on host:port. */
export async function waitForPort(port, { host = '127.0.0.1', timeout = 120000, isAlive = () => true } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!isAlive()) return false;
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, host);
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => resolve(false));
      s.setTimeout(1500, () => {
        s.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(400);
  }
  return false;
}

/** Is a command available on PATH? Cached. */
const whichCache = new Map();
export function which(cmd) {
  if (whichCache.has(cmd)) return whichCache.get(cmd);
  const isWin = process.platform === 'win32';
  const r = spawnSync(isWin ? 'where' : 'sh', isWin ? [cmd] : ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  const found = r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
  whichCache.set(cmd, found);
  return found;
}

/**
 * Run a command to completion, streaming lines to onLine. Resolves {code, out}.
 */
export function run(cmd, args, { cwd, env, onLine, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === 'win32' });
    } catch (e) {
      resolve({ code: -1, out: String(e) });
      return;
    }
    let timer = null;
    if (timeout) timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    const feed = (buf) => {
      const s = buf.toString();
      out += s;
      if (out.length > 200000) out = out.slice(-100000);
      if (onLine) s.split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, out: out + String(e) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

export function git(args, cwd, opts = {}) {
  return run('git', args, { cwd, ...opts });
}

export function gitSync(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}

/** Safe join: refuse paths escaping root. */
export function safeJoin(root, rel) {
  const p = path.resolve(root, String(rel || '').replace(/^[/\\]+/, ''));
  const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('Path escapes workspace: ' + rel);
  return p;
}

export async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

/** Line number (1-based) of a character offset within text. */
export function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function log(...a) {
  if (process.env.EASEL_QUIET) return;
  console.log('[easel]', ...a);
}
