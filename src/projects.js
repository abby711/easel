// Project lifecycle: add → read code → detect → env → install/start → find pages → board → check pages.
import fs from 'node:fs';
import path from 'node:path';
import { store, paths } from './store.js';
import { normalizeSource, repoName, fetchSource, ensureGit, ensureSubmodules, bootstrapEnv, syncStatus, pullLatest } from './ingest.js';
import { detectRepo, detectDir, discoverRoutes, byId } from './adapters/index.js';
import { crawl, fillParams, normalizeRoutes } from './routes.js';
import { ensureLibrary, libraryOf } from './workspaces.js';
import { startWorkspace, getInstance, getInstanceRaw, restartWorkspace } from './runner.js';
import { emit } from './events.js';
import { id as newId, slug, rmrf } from './util.js';

export const VIEWPORTS = {
  desktop: { w: 1280, h: 800, label: 'Desktop' },
  laptop: { w: 1440, h: 900, label: 'Laptop' },
  tablet: { w: 834, h: 1112, label: 'Tablet' },
  mobile: { w: 390, h: 844, label: 'Mobile' },
};

const STEPS = [
  ['read', 'Reading your code'],
  ['detect', 'Detecting your stack'],
  ['env', 'Preparing environment'],
  ['start', 'Installing & starting your app'],
  ['routes', 'Finding your pages'],
  ['board', 'Adding your pages'],
  ['check', 'Checking each page works'],
];

/** Update one setup step on the freshest copy of the project (other code may have saved it meanwhile). */
function setStep(p, key, status, detail) {
  const cur = store.getProject(p.id) || p;
  const s = cur.setup.steps.find((x) => x.key === key);
  if (s) Object.assign(s, { status, detail: detail ?? s.detail, at: Date.now() });
  store.saveProject(cur);
  p.setup = cur.setup;
  emit('setup', { projectId: cur.id, setup: cur.setup, status: cur.status });
}

export function publicProject(p) {
  return p;
}

export async function addProject({ source, name, branch, subdir }) {
  const src = normalizeSource(source);
  const pid = 'p' + slug(name || repoName(src)).slice(0, 20) + '-' + newId().slice(0, 4);
  const p = {
    id: pid,
    name: name || repoName(src),
    source: src,
    branch: branch || null,
    subdir: subdir ?? null,
    status: 'setting-up',
    createdAt: Date.now(),
    stack: null,
    candidates: [],
    routes: [],
    samples: {},
    routeStatus: {},
    env: null,
    setup: { steps: STEPS.map(([key, label]) => ({ key, label, status: 'pending' })) },
  };
  store.saveProject(p);
  emit('project', { project: p });
  runSetup(p.id);
  return p;
}

const settingUp = new Set();
function runSetup(pid) {
  if (settingUp.has(pid)) return;
  settingUp.add(pid);
  setup(pid)
    .catch((e) => {
      const cur = store.getProject(pid);
      if (!cur) return;
      cur.status = 'error';
      cur.error = e.message;
      const running = cur.setup.steps.find((s) => s.status === 'running');
      if (running) running.status = 'error';
      store.saveProject(cur);
      emit('setup', { projectId: pid, setup: cur.setup, status: 'error', error: e.message });
    })
    .finally(() => settingUp.delete(pid));
}

/**
 * Pick up a setup that was interrupted (Easel restarted, machine slept...).
 * Everything is idempotent: the clone is reused, installs skip when unchanged.
 */
export function resumeSetup(pid) {
  const p = store.getProject(pid);
  if (!p) return null;
  p.status = 'setting-up';
  p.error = null;
  for (const s of p.setup.steps) if (s.status !== 'done' || ['start', 'routes', 'board', 'check'].includes(s.key)) s.status = 'pending';
  store.saveProject(p);
  emit('setup', { projectId: pid, setup: p.setup, status: p.status });
  runSetup(pid);
  return p;
}

async function setup(pid) {
  let p = store.getProject(pid);
  const repo = paths.repo(pid);

  setStep(p, 'read', 'running');
  const already = (() => {
    try {
      return fs.existsSync(path.join(repo, '.git')) && fs.readdirSync(repo).length > 1;
    } catch {
      return false;
    }
  })();
  const res = already ? { skippedSecrets: [], submodules: await ensureSubmodules(repo) } : await fetchSource(p.source, repo, { branch: p.branch });
  await ensureGit(repo);
  const notes = [];
  if (res.skippedSecrets?.length) notes.push(`Left out ${res.skippedSecrets.length} secret file(s)`);
  if (res.submodules) notes.push(res.submodules.ok ? 'Fetched submodules' : `Some submodules could not be fetched: ${res.submodules.out}`);
  if (already) notes.push('Reused the existing checkout');
  setStep(p, 'read', 'done', notes.join(' · ') || null);

  setStep(p, 'detect', 'running');
  p = store.getProject(pid);
  p.candidates = detectRepo(repo);
  // An explicitly requested app folder wins, even when detection didn't scan that deep.
  if (p.subdir && !p.candidates.some((c) => c.subdir === p.subdir) && fs.existsSync(path.join(repo, p.subdir))) {
    const res = detectDir(path.join(repo, p.subdir));
    if (res.length) p.candidates.unshift({ subdir: p.subdir, ...res[0], alternatives: res.slice(1, 4) });
  }
  const chosen = p.subdir != null ? p.candidates.find((c) => c.subdir === p.subdir) || p.candidates[0] : p.candidates[0];
  if (!chosen) {
    p.status = 'unsupported';
    store.saveProject(p);
    setStep(p, 'detect', 'error', "Couldn't tell how to run this repo. Add an easel.json (see README) and recompile.");
    return;
  }
  p.subdir = chosen.subdir;
  p.stack = { adapter: chosen.adapter, label: chosen.label, lang: chosen.lang, score: chosen.score };
  store.saveProject(p);
  setStep(p, 'detect', 'done', `${chosen.label}${chosen.subdir ? ` in ${chosen.subdir}/` : ''}`);

  setStep(p, 'env', 'running');
  const appDir = path.join(repo, p.subdir || '');
  const env = bootstrapEnv(appDir);
  p = store.getProject(pid);
  p.env = env;
  store.saveProject(p);
  setStep(p, 'env', 'done', env.created ? `Wrote ${env.created} from ${env.from} (${env.keys.length} placeholder value${env.keys.length === 1 ? '' : 's'})` : 'Nothing needed');

  setStep(p, 'start', 'running');
  const lib = ensureLibrary(p);
  const inst = await startWorkspace(p, lib);
  p = store.getProject(pid);
  if (inst.status !== 'running') {
    setStep(p, 'start', 'error', inst.error || inst.status);
    p.status = 'error';
    p.error = inst.error;
    store.saveProject(p);
    // Still lay out routes so the board isn't empty; frames will show the error.
  } else setStep(p, 'start', 'done', `${p.stack.label} on ${inst.url}`);

  setStep(p, 'routes', 'running');
  const routes = await findRoutes(p, inst);
  p = store.getProject(pid);
  p.routes = routes;
  store.saveProject(p);
  setStep(p, 'routes', 'done', `${routes.length} route${routes.length === 1 ? '' : 's'} (${routes.filter((r) => r.dynamic).length} need a value)`);

  setStep(p, 'board', 'running');
  buildLibraryBoard(p);
  setStep(p, 'board', 'done');

  setStep(p, 'check', 'running');
  if (inst.status === 'running') {
    const st = await checkPages(p);
    const bad = Object.values(st).filter((s) => !s.expected && !s.auth && (s.status >= 400 || s.status === 0)).length;
    setStep(p, 'check', bad ? 'warn' : 'done', bad ? `${bad} page(s) returned errors` : 'All pages respond');
  } else setStep(p, 'check', 'skipped', 'App did not start');
  p = store.getProject(pid);
  if (p.status === 'setting-up') p.status = 'ready';
  store.saveProject(p);
  emit('setup', { projectId: pid, setup: p.setup, status: p.status });
}

/** Static discovery + crawl of the running app (server-rendered stacks). */
async function findRoutes(p, inst) {
  const lib = libraryOf(p);
  const adapter = byId(p.stack.adapter);
  let routes = discoverRoutes(lib.appDir, p.stack.adapter);
  if (inst?.status === 'running' && inst.url && (adapter?.crawl || routes.length <= 1 || ['flask', 'django', 'rails', 'laravel', 'php', 'static', 'fastapi', 'sinatra'].includes(adapter?.id))) {
    try {
      const crawled = await crawl(inst.url, { max: 40, depth: 2 });
      routes = normalizeRoutes([...routes, ...crawled]);
    } catch {
      /* crawl is best effort */
    }
  }
  return routes;
}

export async function rediscover(pid) {
  const p = store.getProject(pid);
  const lib = libraryOf(p);
  const inst = getInstance(lib.id);
  const reported = getInstanceRaw(lib.id)?.links || {};
  let routes = await findRoutes(p, inst);
  routes = normalizeRoutes([...routes, ...Object.keys(reported).map((r) => ({ path: r, source: 'runtime' })), ...(p.routes || []).filter((r) => r.source === 'manual')]);
  p.routes = routes;
  store.saveProject(p);
  emit('project', { project: p });
  return routes;
}

/** The Library board: one frame per page, laid out in a grid. */
export function buildLibraryBoard(p, { keepExisting = true } = {}) {
  const lib = libraryOf(p);
  const boards = store.getBoards(p.id);
  let board = boards.find((b) => b.kind === 'library');
  if (!board) {
    board = { id: 'b' + newId().slice(0, 8), kind: 'library', name: 'Library', frames: [], notes: [], arrows: [] };
    boards.unshift(board);
  }
  const have = new Set(keepExisting ? board.frames.map((f) => f.route) : []);
  if (!keepExisting) board.frames = [];
  const vp = VIEWPORTS.desktop;
  const cols = 3;
  const gapX = 160;
  const gapY = 220;
  let n = board.frames.length;
  for (const r of p.routes) {
    const url = r.dynamic ? fillParams(r.path, p.samples || {}) : r.path;
    if (!url || have.has(url)) continue;
    const col = n % cols;
    const row = Math.floor(n / cols);
    board.frames.push({
      id: 'f' + newId().slice(0, 8),
      workspaceId: lib.id,
      route: url,
      pattern: r.dynamic ? r.path : null,
      label: labelFor(url),
      state: 'default',
      viewport: 'desktop',
      w: vp.w,
      h: vp.h,
      x: col * (vp.w + gapX),
      y: row * (vp.h + gapY),
    });
    have.add(url);
    n++;
  }
  store.saveBoards(p.id, boards);
  emit('board', { projectId: p.id, board });
  return board;
}

function labelFor(route) {
  if (route === '/') return 'Home';
  const last = route.split('/').filter(Boolean).pop() || route;
  return decodeURIComponent(last).replace(/\.(html?|php)$/, '').replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** GET each Library frame through the proxy; remember status codes. */
export async function checkPages(p) {
  const lib = libraryOf(p);
  const inst = getInstance(lib.id);
  if (!inst?.url) return {};
  const board = store.getBoards(p.id).find((b) => b.kind === 'library');
  const frames = (board?.frames || []).slice(0, 30);
  const out = {};
  const save = () => {
    const cur = store.getProject(p.id);
    if (!cur) return;
    cur.routeStatus = { ...out };
    store.saveProject(cur);
    emit('project', { project: cur });
  };
  // The first request to each page can trigger a compile (Next, Angular, Nuxt): a few at a time.
  const queue = frames.slice();
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      const t0 = Date.now();
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 60000);
        // eslint-disable-next-line no-await-in-loop
        const r = await fetch(inst.url + f.route, { headers: { accept: 'text/html' }, signal: ctl.signal, redirect: 'manual' });
        // eslint-disable-next-line no-await-in-loop
        await r.arrayBuffer().catch(() => null);
        clearTimeout(timer);
        // An app's own 404/500 page answering with that code is working as intended.
        const expected = new RegExp(`/${r.status}(\\.html?)?$`).test(f.route);
        // 401/403 means "sign in first": the page works, it's just gated.
        const auth = r.status === 401 || r.status === 403;
        out[f.route] = { status: r.status, ms: Date.now() - t0, redirect: r.headers.get('location') || null, ...(expected ? { expected: true } : {}), ...(auth ? { auth: true } : {}) };
      } catch (e) {
        out[f.route] = { status: 0, error: e.name === 'AbortError' ? 'timed out after 60s' : e.message };
      }
      save();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  save();
  return out;
}

export async function setSubdir(pid, subdir) {
  const p = store.getProject(pid);
  const c = p.candidates.find((x) => x.subdir === subdir);
  if (!c) throw new Error('No app at ' + subdir);
  p.subdir = subdir;
  p.stack = { adapter: c.adapter, label: c.label, lang: c.lang, score: c.score };
  store.saveProject(p);
  const lib = ensureLibrary(p);
  await restartWorkspace(p, lib);
  await rediscover(pid);
  buildLibraryBoard(store.getProject(pid), { keepExisting: false });
  return store.getProject(pid);
}

export async function syncProject(pid, { pull = false } = {}) {
  const p = store.getProject(pid);
  const repo = paths.repo(pid);
  const status = await syncStatus(repo);
  if (!pull) return status;
  const r = await pullLatest(repo);
  const lib = ensureLibrary(p);
  await restartWorkspace(p, lib);
  await rediscover(pid);
  buildLibraryBoard(store.getProject(pid));
  return { ...(await syncStatus(repo)), pulled: r };
}

export async function removeProject(pid) {
  const { stopWorkspace } = await import('./runner.js');
  for (const w of store.getWorkspaces(pid)) await stopWorkspace(w.id);
  await store.deleteProject(pid);
  await rmrf(paths.project(pid));
  emit('project-removed', { projectId: pid });
}
