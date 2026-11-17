// Workspaces = checkouts of a project's code. The Library is the main checkout;
// a frame copy is a cheap clone with the parent's exact working tree, its own
// dev server, and changes you can take home as a diff, an mbox patch or a git bundle.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { store, paths } from './store.js';
import { MOCKS_DIR } from './config.js';
import { id as newId, git, gitSync, safeJoin, walk, readText, rmrf, exists, lineOf, IGNORED_DIRS } from './util.js';

const DEP_DIRS = ['node_modules', 'vendor'];
const EXCLUDES = [`:(exclude,glob)**/${MOCKS_DIR}/**`, ':(exclude,glob)**/.env', ':(exclude,glob)**/.env.local', ':(exclude,glob)**/.easel-installed', ':(exclude,glob)**/node_modules/**'];

export function libraryOf(project) {
  return store.getWorkspaces(project.id).find((w) => w.kind === 'library');
}

export function ensureLibrary(project) {
  const list = store.getWorkspaces(project.id);
  let lib = list.find((w) => w.kind === 'library');
  const dir = paths.repo(project.id);
  const head = gitSync(['rev-parse', 'HEAD'], dir).stdout.trim();
  if (!lib) {
    lib = { id: 'w' + project.id.slice(1) + 'lib', projectId: project.id, kind: 'library', name: 'Library', dir, appDir: path.join(dir, project.subdir || ''), baseCommit: head, createdAt: Date.now() };
    list.unshift(lib);
  } else {
    lib.appDir = path.join(dir, project.subdir || '');
    lib.baseCommit = head;
  }
  store.saveWorkspaces(project.id, list);
  return lib;
}

/** Copy a directory tree using hard links (or APFS clones on macOS). */
async function linkTree(src, dest) {
  if (!exists(src)) return false;
  if (process.platform === 'darwin') {
    if (spawnSync('cp', ['-cR', src, dest]).status === 0) return true;
  } else if (process.platform === 'linux') {
    if (spawnSync('cp', ['-al', src, dest]).status === 0) return true;
  }
  // Portable fallback: hard-link every file.
  const walkLink = (s, d) => {
    fs.mkdirSync(d, { recursive: true });
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      const sp = path.join(s, e.name);
      const dp = path.join(d, e.name);
      if (e.isDirectory()) walkLink(sp, dp);
      else if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(sp), dp);
      else {
        try {
          fs.linkSync(sp, dp);
        } catch {
          fs.copyFileSync(sp, dp);
        }
      }
    }
  };
  walkLink(src, dest);
  return true;
}

/** Overlay the source working tree (incl. untracked files, minus deps/.git) onto dest. */
async function overlayWorkingTree(src, dest) {
  const skip = new Set(['.git', ...DEP_DIRS, '.next', '.nuxt', '.svelte-kit', '.astro', '.angular', '.turbo', '.cache', '.parcel-cache', '__pycache__']);
  await fsp.cp(src, dest, {
    recursive: true,
    force: true,
    filter: (p) => !path.relative(src, p).split(path.sep).some((x) => skip.has(x)),
  });
}

/**
 * Files that setup itself produced (a generated package-lock.json, db.sqlite3, a stub .env...)
 * must never show up as "your changes". Remember them once, right after setup, and hide them
 * from git in this checkout and every copy made from it.
 */
export function markSetupArtifacts(dir) {
  const untracked = gitSync(['ls-files', '--others', '--exclude-standard'], dir).stdout.split('\n').filter(Boolean)
    .filter((f) => !f.startsWith(MOCKS_DIR + '/') && !f.includes(`/${MOCKS_DIR}/`));
  const modified = gitSync(['diff', '--name-only'], dir).stdout.split('\n').filter(Boolean);
  const file = path.join(dir, '.git', 'easel-setup.json');
  const prev = (() => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { untracked: [], modified: [] };
    }
  })();
  const rec = { untracked: [...new Set([...prev.untracked, ...untracked])], modified: [...new Set([...prev.modified, ...modified])] };
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  applySetupArtifacts(dir, rec);
  return rec;
}

function applySetupArtifacts(dir, rec) {
  const exclude = path.join(dir, '.git', 'info', 'exclude');
  let cur = '';
  try {
    cur = fs.readFileSync(exclude, 'utf8');
  } catch {
    /* new */
  }
  const add = rec.untracked.map((f) => '/' + f).filter((l) => !cur.split('\n').includes(l));
  if (add.length) fs.appendFileSync(exclude, `\n# easel setup artifacts\n${add.join('\n')}\n`);
  if (rec.modified.length) gitSync(['update-index', '--assume-unchanged', '--', ...rec.modified], dir);
}

export async function createCopy(project, fromId, name) {
  const list = store.getWorkspaces(project.id);
  const from = list.find((w) => w.id === fromId) || list.find((w) => w.kind === 'library');
  if (!from) throw new Error('No source workspace');
  const wid = newId('w');
  const dest = paths.copy(project.id, wid);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const r = await git(['clone', '-q', '--shared', '--no-checkout', from.dir, dest], path.dirname(dest));
  if (r.code !== 0) throw new Error('copy failed: ' + r.out.slice(-300));
  const head = gitSync(['rev-parse', 'HEAD'], from.dir).stdout.trim();
  gitSync(['checkout', '-q', '-B', `easel/${wid}`, head], dest);
  gitSync(['config', 'user.name', 'Easel'], dest);
  gitSync(['config', 'user.email', 'easel@localhost'], dest);
  fs.appendFileSync(path.join(dest, '.git', 'info', 'exclude'), '\n# easel\nnode_modules/\n.easel-installed\n.easel-install-state.json\n*.easel-hidden\n');
  await overlayWorkingTree(from.dir, dest);
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(from.dir, '.git', 'easel-setup.json'), 'utf8'));
    fs.writeFileSync(path.join(dest, '.git', 'easel-setup.json'), JSON.stringify(rec));
    applySetupArtifacts(dest, rec);
  } catch {
    /* parent had no setup artifacts */
  }
  // Reuse installed dependencies from the parent (hard links: instant, no extra disk).
  const sub = project.subdir || '';
  for (const d of DEP_DIRS) {
    const s = path.join(from.dir, sub, d);
    const t = path.join(dest, sub, d);
    if (exists(s) && !exists(t)) await linkTree(s, t);
  }
  for (const cache of ['node_modules/.vite', 'node_modules/.cache']) await rmrf(path.join(dest, sub, cache));
  const marker = path.join(from.dir, sub, '.easel-installed');
  if (exists(marker)) fs.copyFileSync(marker, path.join(dest, sub, '.easel-installed'));
  const ws = {
    id: wid, projectId: project.id, kind: 'copy', name: name || `${from.name} copy`, parent: from.id,
    dir: dest, appDir: path.join(dest, sub), baseCommit: head, createdAt: Date.now(),
  };
  list.push(ws);
  store.saveWorkspaces(project.id, list);
  return ws;
}

export async function deleteCopy(project, wid) {
  const list = store.getWorkspaces(project.id);
  const ws = list.find((w) => w.id === wid);
  if (!ws || ws.kind === 'library') throw new Error('Only copies can be deleted');
  await rmrf(ws.dir);
  store.saveWorkspaces(project.id, list.filter((w) => w.id !== wid));
}

// ---------- files ----------

const TEXT_EXT = /\.(html?|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|vue|svelte|astro|json|md|mdx|py|rb|erb|php|blade\.php|twig|go|java|kt|cs|cshtml|razor|ex|exs|heex|eex|yml|yaml|toml|txt|xml|svg|env|example|sh|sql|graphql|gql|liquid|njk|hbs|ejs|pug)$/i;

export function listFiles(ws) {
  return walk(ws.appDir, { max: 8000 }).filter((f) => TEXT_EXT.test(f) || !path.extname(f));
}

export function readFile(ws, rel) {
  const p = safeJoin(ws.appDir, rel);
  const st = fs.statSync(p);
  if (st.size > 2 * 1024 * 1024) throw new Error('File too large to edit here');
  return fs.readFileSync(p, 'utf8');
}

export function writeFile(ws, rel, content) {
  const p = safeJoin(ws.appDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return { path: rel, bytes: Buffer.byteLength(content) };
}

/** Search the code for text/classes/ids: powers "find this element in code". */
export function findInCode(ws, terms, { max = 30 } = {}) {
  const words = [].concat(terms).map((t) => String(t || '').trim()).filter((t) => t.length >= 2).slice(0, 8);
  if (!words.length) return [];
  const files = walk(ws.appDir, { max: 6000 }).filter((f) => TEXT_EXT.test(f) && !/\.(json|md|txt|svg|lock)$/i.test(f) && !f.startsWith(MOCKS_DIR + '/'));
  const hits = [];
  for (const f of files) {
    const text = readText(path.join(ws.appDir, f), '');
    if (!text || text.length > 600000) continue;
    for (const w of words) {
      let idx = text.indexOf(w);
      let n = 0;
      while (idx !== -1 && n < 3) {
        const line = lineOf(text, idx);
        const lines = text.split('\n');
        hits.push({ file: f, line, term: w, preview: (lines[line - 1] || '').trim().slice(0, 160), score: words.length - words.indexOf(w) });
        idx = text.indexOf(w, idx + w.length);
        n++;
      }
    }
  }
  // Files matching several terms first.
  const byFile = new Map();
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) || 0) + h.score);
  return hits.sort((a, b) => byFile.get(b.file) - byFile.get(a.file) || b.score - a.score).slice(0, max);
}

// ---------- changes & export ----------

export function changedFiles(ws) {
  gitSync(['add', '-A', '-N', '--', '.', ...EXCLUDES], ws.dir);
  const out = gitSync(['status', '--porcelain', '--', '.', ...EXCLUDES], ws.dir).stdout;
  return out.split('\n').filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), file: l.slice(3) }));
}

export function diff(ws) {
  gitSync(['add', '-A', '-N', '--', '.', ...EXCLUDES], ws.dir);
  return gitSync(['diff', '--no-color', '--binary', 'HEAD', '--', '.', ...EXCLUDES], ws.dir).stdout;
}

/** Snapshot the working tree as a commit without moving HEAD. Returns its sha. */
function snapshotCommit(ws, message) {
  const tmpIndex = path.join(os.tmpdir(), `easel-index-${ws.id}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  const runEnv = (args) => spawnSync('git', args, { cwd: ws.dir, env, encoding: 'utf8' });
  runEnv(['read-tree', 'HEAD']);
  runEnv(['add', '-A', '--', '.', ...EXCLUDES]);
  const tree = runEnv(['write-tree']).stdout.trim();
  const sha = spawnSync('git', ['commit-tree', tree, '-p', 'HEAD', '-m', message], {
    cwd: ws.dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Easel', GIT_AUTHOR_EMAIL: 'easel@localhost', GIT_COMMITTER_NAME: 'Easel', GIT_COMMITTER_EMAIL: 'easel@localhost' },
  }).stdout.trim();
  try {
    fs.unlinkSync(tmpIndex);
  } catch {
    /* ignore */
  }
  if (!sha) throw new Error('Could not snapshot changes');
  return sha;
}

/**
 * Export a workspace's changes.
 * format: 'diff' (unified diff) | 'patch' (mbox for `git am`) | 'bundle' (binary, refs/heads/easel/<id>)
 */
export function exportChanges(ws, format = 'diff', message) {
  if (format === 'diff') return { contentType: 'text/x-diff; charset=utf-8', filename: `${ws.name.replace(/\W+/g, '-')}.diff`, body: Buffer.from(diff(ws)) };
  const msg = message || `Easel: ${ws.name}`;
  const sha = snapshotCommit(ws, msg);
  if (format === 'patch') {
    const out = gitSync(['format-patch', '-1', sha, '--stdout'], ws.dir).stdout;
    return { contentType: 'application/mbox', filename: `${ws.name.replace(/\W+/g, '-')}.patch`, body: Buffer.from(out), sha };
  }
  if (format === 'bundle') {
    const ref = `refs/heads/easel/${ws.id}-export`;
    gitSync(['update-ref', ref, sha], ws.dir);
    const file = path.join(os.tmpdir(), `easel-${ws.id}.bundle`);
    const r = spawnSync('git', ['bundle', 'create', file, ref, `^${ws.baseCommit}`], { cwd: ws.dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('bundle failed: ' + r.stderr);
    const body = fs.readFileSync(file);
    fs.unlinkSync(file);
    return { contentType: 'application/octet-stream', filename: `${ws.name.replace(/\W+/g, '-')}.bundle`, body, sha, ref };
  }
  throw new Error('Unknown format ' + format);
}

/** Apply a unified diff (e.g. from a local coding agent) onto a workspace. */
export function applyPatch(ws, patchText) {
  const tmp = path.join(os.tmpdir(), `easel-apply-${Date.now()}.diff`);
  fs.writeFileSync(tmp, patchText);
  let r = spawnSync('git', ['apply', '--whitespace=nowarn', tmp], { cwd: ws.dir, encoding: 'utf8' });
  if (r.status !== 0) r = spawnSync('git', ['apply', '--3way', '--whitespace=nowarn', tmp], { cwd: ws.dir, encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status !== 0) throw new Error('Patch did not apply: ' + (r.stderr || r.stdout).trim().slice(0, 500));
  return { ok: true };
}

export function revertAll(ws) {
  gitSync(['checkout', '--', '.'], ws.dir);
  gitSync(['clean', '-fdq', '--', '.', ...EXCLUDES], ws.dir);
}

export { IGNORED_DIRS };
