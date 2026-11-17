// Easel's HTTP server: the canvas UI, a JSON API (used by the UI, the CLI and the MCP server), and an event stream.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PORT, HOST, MOCKS_DIR } from './config.js';
import { store } from './store.js';
import { sseHandler, emit } from './events.js';
import { addProject, rediscover, buildLibraryBoard, checkPages, setSubdir, syncProject, removeProject, resumeSetup, VIEWPORTS } from './projects.js';
import { ensureLibrary, createCopy, deleteCopy, listFiles, readFile, writeFile, findInCode, changedFiles, exportChanges, applyPatch, revertAll } from './workspaces.js';
import { startWorkspace, stopWorkspace, restartWorkspace, getInstance, getInstanceRaw, listInstances, instanceLogs } from './runner.js';
import { extractTokens, extractComponents, mergeCensus } from './tokens.js';
import { ADAPTERS, missingToolchain } from './adapters/index.js';
import { TOOLCHAINS } from './adapters/other.js';
import { which, id as newId, safeJoin, writeJSON, readJSON } from './util.js';

const UI_DIR = path.join(ROOT, 'ui');
const routes = [];
const on = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler });
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const need = (v, msg = 'Not found') => {
  if (!v) throw new HttpError(404, msg);
  return v;
};
const project = (pid) => need(store.getProject(pid), 'No such project');
const workspace = (wid) => need(store.getWorkspace(wid), 'No such workspace');

// ---------- API ----------
on('GET', '/api/health', () => ({ ok: true, version: '0.1.0' }));

on('GET', '/api/doctor', () => {
  const tools = ['node', 'npm', 'pnpm', 'yarn', 'bun', 'python3', 'ruby', 'bundle', 'php', 'composer', 'go', 'java', 'dotnet', 'mix', 'hugo', 'git'];
  return {
    tools: Object.fromEntries(tools.map((t) => [t, !!which(t)])),
    adapters: ADAPTERS.map((a) => ({ id: a.id, label: a.label, lang: a.lang, needs: TOOLCHAINS[a.id] || ['node'], ready: missingToolchain(a.id).length === 0 })),
  };
});

on('GET', '/api/viewports', () => VIEWPORTS);

on('GET', '/api/projects', () => store.listProjects());
on('POST', '/api/projects', async (_, body) => {
  if (!body.source) throw new HttpError(400, 'source (git URL, owner/repo or folder path) is required');
  return addProject(body);
});
on('GET', '/api/projects/:pid', ({ pid }) => {
  const p = project(pid);
  const workspaces = store.getWorkspaces(pid).map((w) => ({ ...w, instance: getInstance(w.id) }));
  return { project: p, workspaces, boards: store.getBoards(pid) };
});
on('DELETE', '/api/projects/:pid', async ({ pid }) => {
  project(pid);
  await removeProject(pid);
  return { ok: true };
});
on('POST', '/api/projects/:pid/subdir', ({ pid }, body) => setSubdir(pid, body.subdir ?? ''));
on('GET', '/api/projects/:pid/routes', ({ pid }) => project(pid).routes);
on('POST', '/api/projects/:pid/routes', ({ pid }, body) => {
  const p = project(pid);
  const pathStr = String(body.path || '').trim();
  if (!pathStr.startsWith('/')) throw new HttpError(400, 'path must start with /');
  p.routes = [...p.routes.filter((r) => r.path !== pathStr), { path: pathStr, source: 'manual', dynamic: /[:*]/.test(pathStr) }];
  store.saveProject(p);
  if (body.addFrame !== false) buildLibraryBoard(p);
  return p.routes;
});
on('POST', '/api/projects/:pid/rediscover', async ({ pid }) => {
  project(pid);
  const r = await rediscover(pid);
  buildLibraryBoard(store.getProject(pid));
  return r;
});
on('POST', '/api/projects/:pid/samples', ({ pid }, body) => {
  const p = project(pid);
  p.samples = { ...(p.samples || {}), ...(body.samples || {}) };
  store.saveProject(p);
  buildLibraryBoard(p);
  return p.samples;
});
on('POST', '/api/projects/:pid/check', async ({ pid }) => checkPages(project(pid)));
on('POST', '/api/projects/:pid/resume', ({ pid }) => resumeSetup(project(pid).id));
on('GET', '/api/projects/:pid/sync', ({ pid }) => syncProject(project(pid).id));
on('POST', '/api/projects/:pid/sync', ({ pid }) => syncProject(project(pid).id, { pull: true }));
on('GET', '/api/projects/:pid/design', ({ pid }, _, q) => {
  const p = project(pid);
  const ws = q.get('ws') ? workspace(q.get('ws')) : ensureLibrary(p);
  const reports = Object.values(getInstanceRaw(ws.id)?.census || {});
  return { tokens: extractTokens(ws.appDir), components: extractComponents(ws.appDir), rendered: mergeCensus(reports), pagesMeasured: reports.length };
});

// boards
on('GET', '/api/projects/:pid/boards', ({ pid }) => store.getBoards(project(pid).id));
on('POST', '/api/projects/:pid/boards', ({ pid }, body) => {
  project(pid);
  const boards = store.getBoards(pid);
  const b = { id: 'b' + newId().slice(0, 8), kind: 'page', name: body.name || `Page ${boards.length}`, frames: body.frames || [], notes: [], arrows: [] };
  boards.push(b);
  store.saveBoards(pid, boards);
  emit('board', { projectId: pid, board: b });
  return b;
});
on('PUT', '/api/projects/:pid/boards/:bid', ({ pid, bid }, body) => {
  const boards = store.getBoards(project(pid).id);
  const i = boards.findIndex((b) => b.id === bid);
  need(i >= 0, 'No such board');
  boards[i] = { ...boards[i], ...body, id: bid, kind: boards[i].kind };
  store.saveBoards(pid, boards);
  emit('board', { projectId: pid, board: boards[i], from: body.clientId || null });
  return boards[i];
});
on('DELETE', '/api/projects/:pid/boards/:bid', ({ pid, bid }) => {
  const boards = store.getBoards(project(pid).id);
  const b = need(boards.find((x) => x.id === bid), 'No such board');
  if (b.kind === 'library') throw new HttpError(400, "The Library board can't be deleted");
  store.saveBoards(pid, boards.filter((x) => x.id !== bid));
  return { ok: true };
});

// workspaces & instances
on('POST', '/api/projects/:pid/workspaces', async ({ pid }, body) => {
  const p = project(pid);
  const ws = await createCopy(p, body.from, body.name);
  const start = body.start !== false;
  if (start) startWorkspace(p, ws); // don't block: frames show a "starting" page
  emit('workspace', { projectId: pid, workspace: ws });
  return { ...ws, instance: getInstance(ws.id) };
});
on('DELETE', '/api/workspaces/:wid', async ({ wid }) => {
  const ws = workspace(wid);
  await stopWorkspace(wid);
  await deleteCopy(project(ws.projectId), wid);
  return { ok: true };
});
on('POST', '/api/workspaces/:wid/start', ({ wid }) => {
  const ws = workspace(wid);
  startWorkspace(project(ws.projectId), ws);
  return getInstance(wid) || { status: 'preparing' };
});
on('POST', '/api/workspaces/:wid/stop', ({ wid }) => stopWorkspace(workspace(wid).id));
on('POST', '/api/workspaces/:wid/restart', ({ wid }) => {
  const ws = workspace(wid);
  restartWorkspace(project(ws.projectId), ws);
  return getInstance(wid) || { status: 'preparing' };
});
on('GET', '/api/workspaces/:wid', ({ wid }) => ({ ...workspace(wid), instance: getInstance(wid) }));
on('GET', '/api/workspaces/:wid/logs', ({ wid }) => instanceLogs(workspace(wid).id));
on('GET', '/api/instances', () => listInstances());

// files
on('GET', '/api/workspaces/:wid/files', ({ wid }) => listFiles(workspace(wid)));
on('GET', '/api/workspaces/:wid/file', ({ wid }, _, q) => ({ path: q.get('path'), content: readFile(workspace(wid), q.get('path')) }));
on('PUT', '/api/workspaces/:wid/file', ({ wid }, body) => {
  const ws = workspace(wid);
  const r = writeFile(ws, body.path, String(body.content ?? ''));
  emit('files-changed', { id: wid, file: body.path });
  return r;
});
on('GET', '/api/workspaces/:wid/find', ({ wid }, _, q) => findInCode(workspace(wid), q.getAll('q')));
on('GET', '/api/workspaces/:wid/changes', ({ wid }) => changedFiles(workspace(wid)));
on('POST', '/api/workspaces/:wid/apply', ({ wid }, body) => {
  const r = applyPatch(workspace(wid), String(body.patch || ''));
  emit('files-changed', { id: wid, file: '*' });
  return r;
});
on('POST', '/api/workspaces/:wid/revert', ({ wid }) => {
  revertAll(workspace(wid));
  emit('files-changed', { id: wid, file: '*' });
  return { ok: true };
});

// mocks
const mocksOf = (wid) => getInstanceRaw(wid)?.mocks || null;
on('GET', '/api/workspaces/:wid/mocks', ({ wid }) => {
  const ws = workspace(wid);
  const m = mocksOf(wid);
  if (m) return m.summary();
  return { mode: (readJSON(path.join(ws.appDir, MOCKS_DIR, '_config.json'), {}) || {}).mode || 'auto', rules: [], recorded: [], states: ['default'], log: [], stopped: true };
});
on('PUT', '/api/workspaces/:wid/mocks/file', ({ wid }, body) => {
  const ws = workspace(wid);
  const name = String(body.name || '').replace(/[^\w.-]/g, '');
  if (!name.endsWith('.json')) throw new HttpError(400, 'name must end with .json');
  let doc;
  try {
    doc = typeof body.content === 'string' ? JSON.parse(body.content) : body.content;
  } catch (e) {
    throw new HttpError(400, 'Invalid JSON: ' + e.message);
  }
  writeJSON(safeJoin(path.join(ws.appDir, MOCKS_DIR), name), doc);
  mocksOf(wid)?.load();
  emit('mocks-changed', { id: wid });
  return { ok: true };
});
on('GET', '/api/workspaces/:wid/mocks/file', ({ wid }, _, q) => {
  const ws = workspace(wid);
  const name = String(q.get('name') || '');
  return { name, content: fs.readFileSync(safeJoin(path.join(ws.appDir, MOCKS_DIR), name), 'utf8') };
});
on('POST', '/api/workspaces/:wid/mocks/mode', ({ wid }, body) => {
  const m = need(mocksOf(wid), 'Start the workspace first');
  if (!['auto', 'live', 'replay', 'off'].includes(body.mode)) throw new HttpError(400, 'mode: auto | live | replay | off');
  m.setMode(body.mode);
  emit('mocks-changed', { id: wid });
  return m.summary();
});

// ---------- plumbing ----------
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

const UI_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveUi(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  let file;
  try {
    file = safeJoin(UI_DIR, rel);
  } catch {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(UI_DIR, 'index.html');
  res.writeHead(200, { 'content-type': UI_TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/events') return sseHandler(req, res);
    if (url.pathname.startsWith('/api/workspaces/') && url.pathname.endsWith('/export')) {
      try {
        const wid = url.pathname.split('/')[3];
        const out = exportChanges(workspace(wid), url.searchParams.get('format') || 'diff', url.searchParams.get('message') || undefined);
        res.writeHead(200, { 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.filename}"`, 'x-easel-sha': out.sha || '' });
        return res.end(out.body);
      } catch (e) {
        res.writeHead(e.status || 500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    if (!url.pathname.startsWith('/api/')) return serveUi(req, res, url.pathname);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJsonBody(req) : {};
        const out = await r.handler(params, body, url.searchParams, req);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(out ?? null));
      } catch (e) {
        const status = e.status || (/ENOENT/.test(e.message) ? 404 : 500);
        res.writeHead(status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'No such endpoint' }));
  });
}

/** Start the server and bring every project's Library back up. */
export async function startServer({ port = PORT, host = HOST, autostart = true } = {}) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  if (autostart) {
    for (const p of store.listProjects()) {
      if (p.status === 'setting-up') {
        resumeSetup(p.id); // interrupted last time
        continue;
      }
      if (!p.stack) continue;
      const lib = store.getWorkspaces(p.id).find((w) => w.kind === 'library');
      if (lib) startWorkspace(p, lib);
    }
  }
  return server;
}
