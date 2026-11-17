// Runs workspaces: install → prepare → start dev server → put the Easel proxy in front.
// One instance per workspace (the Library checkout, and each frame copy).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, VENVS_DIR, APP_PORT_START } from './config.js';
import { freePort, releasePort, waitForPort, run, exists, which } from './util.js';
import { byId, makeCtx, missingToolchain } from './adapters/index.js';
import { createProxy } from './proxy.js';
import { MockEngine } from './mocks.js';
import { emit } from './events.js';
import { markSetupArtifacts } from './workspaces.js';
import { nodeRequirement } from './adapters/node.js';
import { ensureNode } from './node-versions.js';

const NODE_HOOK = path.join(ROOT, 'runtime', 'node-hook.cjs');
const instances = new Map();

export const venvFor = (projectId) => path.join(VENVS_DIR, projectId);

function publicInst(i) {
  if (!i) return null;
  return {
    id: i.id, projectId: i.projectId, status: i.status, step: i.step, error: i.error, adapter: i.adapter,
    proxyPort: i.proxyPort, appPort: i.appPort, url: i.proxyPort ? `http://127.0.0.1:${i.proxyPort}` : null,
    startedAt: i.startedAt, readyAt: i.readyAt, pid: i.proc?.pid || null, errors: i.errors.slice(-20), node: i.node || null,
  };
}

function setStatus(i, status, extra = {}) {
  Object.assign(i, { status }, extra);
  emit('instance', publicInst(i));
}

function pushLog(i, line) {
  const l = String(line).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  i.logs.push(l);
  if (i.logs.length > 600) i.logs.splice(0, i.logs.length - 600);
  emit('log', { id: i.id, line: l });
}

/** Hash of everything that decides whether dependencies need (re)installing. */
function installKey(appDir, adapterId, steps) {
  const h = crypto.createHash('sha1').update(adapterId + JSON.stringify(steps.map((s) => [s.cmd, s.args])));
  for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'package.json', 'requirements.txt', 'Pipfile.lock', 'poetry.lock', 'pyproject.toml', 'Gemfile.lock', 'composer.lock', 'go.sum', 'mix.lock']) {
    try {
      h.update(fs.readFileSync(path.join(appDir, f)));
    } catch {
      /* absent */
    }
  }
  return h.digest('hex');
}

async function runSteps(i, steps, cwd, env, phase) {
  // Remember which attempts already failed for this exact dependency set, so a restart
  // (Easel closed mid-install) goes straight to the next fallback instead of repeating them.
  const memoFile = path.join(cwd, '.easel-install-state.json');
  let memo = {};
  try {
    memo = JSON.parse(fs.readFileSync(memoFile, 'utf8'));
  } catch {
    memo = {};
  }
  if (memo.key !== i.installKey) memo = { key: i.installKey, failed: [] };
  const saveMemo = () => {
    try {
      fs.writeFileSync(memoFile, JSON.stringify(memo));
    } catch {
      /* read-only */
    }
  };
  for (const step of steps) {
    let tries = [step, ...(step.fallbacks || [])];
    const fresh = tries.filter((s) => !memo.failed.includes(`${phase}:${s.label}`));
    if (fresh.length) tries = fresh;
    let ok = false;
    for (const s of tries) {
      setStatus(i, i.status, { step: `${phase}: ${s.label}` });
      pushLog(i, `$ ${s.cmd} ${(s.args || []).join(' ')}`);
      // eslint-disable-next-line no-await-in-loop
      const r = await run(s.cmd, s.args || [], { cwd, env: { ...env, ...(s.env || {}) }, onLine: (l) => pushLog(i, l), timeout: 15 * 60 * 1000 });
      if (r.code === 0) {
        ok = true;
        break;
      }
      pushLog(i, `✗ ${s.label} exited with ${r.code}`);
      if (phase === 'install') {
        memo.failed.push(`${phase}:${s.label}`);
        saveMemo();
      }
    }
    if (!ok && !step.optional) throw new Error(`${phase} failed at "${step.label}". See logs.`);
  }
}

export function getInstance(id) {
  return publicInst(instances.get(id));
}
export function getInstanceRaw(id) {
  return instances.get(id) || null;
}
export function listInstances() {
  return [...instances.values()].map(publicInst);
}
export function instanceLogs(id) {
  return instances.get(id)?.logs.slice() || [];
}

/**
 * Start (or return) the instance for a workspace.
 * workspace: {id, projectId, appDir}; project: {stack: {adapter}}
 */
export async function startWorkspace(project, ws, { onReport } = {}) {
  const existing = instances.get(ws.id);
  if (existing && ['running', 'starting', 'installing', 'preparing'].includes(existing.status)) return publicInst(existing);
  const adapter = byId(project.stack?.adapter);
  const i = existing || { id: ws.id, projectId: project.id, logs: [], errors: [], census: {} };
  instances.set(ws.id, i);
  Object.assign(i, { adapter: adapter?.id, error: null, startedAt: Date.now(), readyAt: null, appDir: ws.appDir });
  setStatus(i, 'preparing', { step: 'checking toolchain' });
  if (!adapter) {
    setStatus(i, 'error', { error: 'No stack adapter for this project. Add an easel.json to tell Easel how to run it.' });
    return publicInst(i);
  }
  const missing = missingToolchain(adapter.id);
  if (missing.length) {
    setStatus(i, 'error', { error: `${adapter.label} needs ${missing.join(', ')} installed on this machine.` });
    return publicInst(i);
  }
  const ctx = makeCtx(ws.appDir, { venv: venvFor(project.id), projectId: project.id });
  const baseEnv = { CI: '', FORCE_COLOR: '0', npm_config_update_notifier: 'false' };

  // Mocks + proxy first, so frames show a "starting" page right away.
  if (!i.mocks) i.mocks = new MockEngine(ws.appDir, { onChange: () => { i.proxy?.broadcast('mocks'); emit('mocks-changed', { id: i.id }); } });
  if (!i.proxyPort) i.proxyPort = await freePort(APP_PORT_START);
  const target = {};
  if (!i.proxy) {
    i.proxy = createProxy({
      instanceId: i.id,
      mocks: i.mocks,
      target,
      onReport: (msg) => {
        if (msg.type === 'error') i.errors.push({ ...msg.data, t: Date.now(), frameId: msg.frameId });
        if (msg.type === 'census') i.census[msg.frameId || 'page'] = msg.data;
        if (msg.type === 'links') i.links = { ...(i.links || {}), ...(msg.data || {}) };
        emit('report', { id: i.id, ...msg });
        onReport?.(i, msg);
      },
    });
    await i.proxy.listen(i.proxyPort);
  }
  i.target = target;

  try {
    // Install (skipped when nothing changed since the last install).
    const steps = adapter.install ? adapter.install(ctx) : [];
    const marker = path.join(ctx.venv && adapter.lang === 'Python' ? ctx.venv : ws.appDir, '.easel-installed');
    const key = installKey(ws.appDir, adapter.id, steps);
    i.installKey = key;
    let installed = false;
    try {
      installed = fs.readFileSync(marker, 'utf8').trim() === key;
    } catch {
      installed = false;
    }
    const nodeReq = ctx.pkg ? nodeRequirement(ctx) : { ok: true };
    let nodeBin = null;
    if (!nodeReq.ok) {
      pushLog(i, `! This app asks for Node ${nodeReq.wanted}; this machine has ${process.versions.node}. Fetching a matching Node for it.`);
      setStatus(i, 'installing', { step: `getting Node ${nodeReq.wanted}` });
      try {
        const n = await ensureNode(nodeReq.wanted, { satisfies: (v) => nodeRequirement(ctx, v).ok, onLine: (l) => pushLog(i, l) });
        nodeBin = n.binDir;
        i.node = n.version;
        baseEnv.PATH = nodeBin + path.delimiter + (process.env.PATH || '');
        pushLog(i, `Using Node ${n.version} for this app.`);
      } catch (e) {
        pushLog(i, '! ' + e.message);
      }
    }
    if (steps.length && !installed) {
      setStatus(i, 'installing', { step: 'installing dependencies' });
      try {
        await runSteps(i, steps, ws.appDir, baseEnv, 'install');
      } catch (e) {
        const engine = i.logs.slice(-200).some((l) => /EBADDEVENGINES|EBADENGINE|Unsupported engine|engine "node" is incompatible|requires? node/i.test(l));
        if ((engine || !nodeReq.ok) && !nodeBin) throw new Error(`This app needs Node ${nodeReq.wanted || '(another version)'} and this machine has ${process.versions.node}. Install it (e.g. "nvm install ${(nodeReq.wanted || '').replace(/[^\d.]/g, '').split('.')[0] || 'lts'}") and restart Easel.`);
        throw e;
      }
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, key);
    }
    if (adapter.prepare) {
      setStatus(i, 'preparing', { step: 'preparing' });
      await runSteps(i, adapter.prepare(ctx), ws.appDir, baseEnv, 'prepare');
    }
    // Only right after a (re)install: later edits in the Library are real changes, not artifacts.
    if (ws.kind === 'library' && ws.dir && (!installed || !exists(path.join(ws.dir, '.git', 'easel-setup.json')))) markSetupArtifacts(ws.dir);

    setStatus(i, 'starting', { step: 'starting dev server' });
    const spec0 = adapter.start(ctx, { port: 0 });
    if (spec0.static) {
      target.staticRoot = path.join(ws.appDir, spec0.root || '');
      i.proxy.watchStatic((file) => emit('files-changed', { id: i.id, file }));
      setStatus(i, 'running', { step: null, readyAt: Date.now() });
      return publicInst(i);
    }
    i.appPort = await freePort(i.proxyPort + 1);
    target.port = i.appPort;
    const spec = adapter.start(ctx, { port: i.appPort });
    const env = {
      ...process.env,
      ...baseEnv,
      ...(spec.env || {}),
      EASEL: '1',
      EASEL_NET_URL: `http://127.0.0.1:${i.proxyPort}/__easel/net`,
    };
    if (adapter.lang === 'JavaScript' || adapter.lang === 'TypeScript' || spec.cmd.endsWith('npm') || spec.cmd.includes('node_modules')) {
      env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require "${NODE_HOOK}"`.trim();
    }
    if (ctx.venv && exists(ctx.venv)) {
      env.VIRTUAL_ENV = ctx.venv;
      env.PATH = path.join(ctx.venv, 'bin') + path.delimiter + (env.PATH || '');
    }
    pushLog(i, `$ ${spec.cmd} ${(spec.args || []).join(' ')}   (app :${i.appPort} → proxy :${i.proxyPort})`);
    if (!exists(spec.cmd) && !spec.cmd.includes('/') && !which(spec.cmd)) throw new Error(`"${spec.cmd}" isn't installed or on PATH.`);
    if (spec.cmd.includes('node_modules') && !exists(spec.cmd)) throw new Error(`${path.basename(spec.cmd)} isn't installed in node_modules. Did install fail? See logs.`);
    const proc = spawn(spec.cmd, spec.args || [], { cwd: spec.cwd || ws.appDir, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    i.proc = proc;
    const feed = (b) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => pushLog(i, l));
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    let exited = false;
    proc.on('exit', (code, sig) => {
      exited = true;
      pushLog(i, `process exited (${code ?? sig})`);
      if (i.status !== 'stopped') setStatus(i, 'crashed', { error: `Dev server exited (${code ?? sig}). Last log: ${i.logs.slice(-3).join(' | ').slice(0, 400)}` });
    });
    proc.on('error', (e) => {
      exited = true;
      setStatus(i, 'error', { error: `Could not start ${spec.cmd}: ${e.message}` });
    });
    const up = await waitForPort(i.appPort, { timeout: 5 * 60 * 1000, isAlive: () => !exited });
    if (!up) {
      if (!exited) setStatus(i, 'error', { error: 'Dev server did not open its port within 5 minutes.' });
      return publicInst(i);
    }
    setStatus(i, 'running', { step: null, readyAt: Date.now() });
  } catch (e) {
    setStatus(i, 'error', { error: e.message, step: null });
  }
  return publicInst(i);
}

function killTree(proc) {
  if (!proc || proc.exitCode != null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
    else process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
  setTimeout(() => {
    try {
      if (proc.exitCode == null) process.kill(-proc.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }, 3000).unref();
}

export async function stopWorkspace(id, { keepProxy = false } = {}) {
  const i = instances.get(id);
  if (!i) return null;
  setStatus(i, 'stopped', { step: null });
  killTree(i.proc);
  i.proc = null;
  if (i.appPort) releasePort(i.appPort);
  i.appPort = null;
  if (i.target) {
    delete i.target.port;
    delete i.target.staticRoot;
  }
  if (!keepProxy) {
    await i.proxy?.close();
    i.mocks?.close();
    if (i.proxyPort) releasePort(i.proxyPort);
    i.proxy = null;
    i.mocks = null;
    i.proxyPort = null;
    instances.delete(id);
  }
  return publicInst(i);
}

export async function restartWorkspace(project, ws) {
  await stopWorkspace(ws.id, { keepProxy: true });
  return startWorkspace(project, ws);
}

export function stopAll() {
  for (const i of instances.values()) killTree(i.proc);
}
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopAll();
    process.exit(0);
  });
}
