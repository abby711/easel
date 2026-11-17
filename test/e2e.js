// End-to-end: run Easel in-process, add real projects, and check what a user would see.
//   node test/e2e.js                 static, covid tracker (git), Flask, Django, Vite+React, MCP
//   node test/e2e.js --next          also Next.js (bigger install)
//   node test/e2e.js --only flask    just one
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test', 'fixtures');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'easel-e2e-'));
process.env.EASEL_HOME = HOME;
process.env.EASEL_QUIET = '1';
const PORT = 4890 + Math.floor(Math.random() * 50);
process.env.EASEL_APP_PORT_START = String(PORT + 100);
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const withNext = args.includes('--next') || only === 'next';
const want = (name) => (only ? only === name : name !== 'next' || withNext);

const { startServer } = await import('../src/server.js');
const server = await startServer({ port: PORT, autostart: false });
const B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(method, p, body) {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${d?.error || t}`);
  return d;
}

const results = [];
let current = '';
function check(name, ok, detail = '') {
  results.push({ suite: current, name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function addAndWait(source, timeout = 600000) {
  const p = await j('POST', '/api/projects', { source });
  const t0 = Date.now();
  for (;;) {
    const d = await j('GET', `/api/projects/${p.id}`);
    if (['ready', 'error', 'unsupported'].includes(d.project.status)) return { ...d, secs: Math.round((Date.now() - t0) / 1000) };
    if (Date.now() - t0 > timeout) return { ...d, secs: Math.round((Date.now() - t0) / 1000), timedOut: true };
    await sleep(1000);
  }
}
const libOf = (d) => d.workspaces.find((w) => w.kind === 'library');
const html = async (url) => (await fetch(url, { headers: { accept: 'text/html' } })).text();
async function waitRunning(wid, timeout = 300000) {
  const t0 = Date.now();
  for (;;) {
    const w = await j('GET', `/api/workspaces/${wid}`);
    if (w.instance?.status === 'running') return w;
    if (['error', 'crashed'].includes(w.instance?.status) || Date.now() - t0 > timeout) return w;
    await sleep(800);
  }
}
function wsUpgrade(port, pathName, protocol) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(`GET ${pathName} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ''}\r\n`);
    });
    s.once('data', (d) => {
      resolve(d.toString().split('\r\n')[0]);
      s.destroy();
    });
    s.on('error', (e) => resolve('error ' + e.message));
    setTimeout(() => {
      resolve('timeout');
      s.destroy();
    }, 8000);
  });
}
const setupSummary = (d) => d.project.setup.steps.map((s) => `${s.status === 'done' ? '✓' : s.status}:${s.label}${s.detail ? ` (${s.detail})` : ''}`).join(' | ');

// jsdom with CDN scripts served locally (the sandbox may have no internet)
const require = createRequire(import.meta.url);
async function renderInDom(url, { windowName } = {}) {
  const { JSDOM, ResourceLoader, VirtualConsole } = await import('jsdom');
  class Loader extends ResourceLoader {
    fetch(u, o) {
      if (/jquery[^/]*\.js/.test(u)) return Promise.resolve(fs.readFileSync(require.resolve('jquery/dist/jquery.min.js')));
      if (!u.startsWith(new URL(url).origin)) return Promise.resolve(Buffer.from(''));
      return super.fetch(u, o);
    }
  }
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = await JSDOM.fromURL(url, { runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) {
    if (windowName) w.name = windowName;
  } });
  return { dom, errors };
}

// ------------------------------------------------------------------ suites
async function suiteStatic() {
  current = 'static';
  console.log('\n▸ Static site (local folder)');
  const d = await addAndWait(path.join(FIX, 'static-site'));
  check('setup finishes', d.project.status === 'ready', `${d.secs}s · ${setupSummary(d)}`);
  check('routes found', JSON.stringify(d.project.routes.map((r) => r.path)) === JSON.stringify(['/', '/about.html', '/blog/post-1.html']), d.project.routes.map((r) => r.path).join(' '));
  check('every page responds 200', Object.values(d.project.routeStatus).every((s) => s.status === 200), JSON.stringify(d.project.routeStatus));
  check('Library board has one frame per page', d.boards[0].frames.length === 3);
  const lib = libOf(d);
  const page = await html(lib.instance.url + '/about.html');
  check('runtime injected into HTML', page.includes('/__easel/runtime.js'));
  const design = await j('GET', `/api/projects/${d.project.id}/design`);
  check('design tokens extracted', design.tokens.vars.some((v) => v.name === '--brand') && design.tokens.fonts.some((f) => f.value === 'Inter'), `${design.tokens.vars.length} vars · ${design.tokens.colors.length} colours`);
  // live reload signal for static sites
  const es = await fetch(lib.instance.url + '/__easel/events');
  const reader = es.body.getReader();
  await reader.read();
  fs.appendFileSync(path.join(lib.appDir, 'about.html'), '\n<!-- edit -->');
  const got = await Promise.race([reader.read().then((r) => new TextDecoder().decode(r.value)), sleep(4000).then(() => '')]);
  check('editing a file signals reload', got.includes('reload'));
  reader.cancel();
  return d;
}

async function suiteCovid() {
  current = 'covid';
  console.log('\n▸ dynamic-covidtracker (GitHub) — the dead-API case');
  const d = await addAndWait('https://github.com/abby711/dynamic-covidtracker');
  check('setup finishes', d.project.status === 'ready', `${d.secs}s · ${d.project.stack?.label}`);
  const lib = libOf(d);
  // 1. without mocks: the API is unreachable, like the live site
  let r = await renderInDom(lib.instance.url + '/');
  await sleep(2500);
  const before = r.dom.window.document.querySelector('#confirmed1')?.textContent;
  check('without mocks it shows 0 (API unreachable, same as the live site)', before === '0', `confirmed=${before}`);
  r.dom.window.close();
  // 2. write a mock rule with a realistic payload
  const mock = { rules: [{ id: 'covid-india', match: { method: 'GET', url: 'https://data.covid19india.org/data.json' }, states: {
    default: { json: { statewise: [{ lastupdatedtime: '31/10/2021 23:59:00 (mock)', confirmed: '34285814', deltaconfirmed: '12514', deaths: '458470', deltadeaths: '251', active: '158817', recovered: '33668527', deltarecovered: '12718' }] } },
    spike: { json: { statewise: [{ lastupdatedtime: 'spike scenario', confirmed: '99999999', deltaconfirmed: '400000', deaths: '1000000', deltadeaths: '4000', active: '5000000', recovered: '93999999', deltarecovered: '300000' }] } },
  } }] };
  await j('PUT', `/api/workspaces/${lib.id}/mocks/file`, { name: 'covid.json', content: mock });
  await sleep(400);
  r = await renderInDom(lib.instance.url + '/');
  await sleep(2500);
  const doc = r.dom.window.document;
  const after = doc.querySelector('#confirmed1')?.textContent;
  check('with a mock rule the page renders real-looking data', after === '34285814', `confirmed=${after} updated="${doc.querySelector('#update_date_time')?.textContent}"`);
  check('runtime intercepted jQuery XHR via /__easel/net', !!r.dom.window.__easel);
  r.dom.window.close();
  // 3. per-frame state via window.name
  r = await renderInDom(lib.instance.url + '/', { windowName: 'easel:' + JSON.stringify({ id: 'f1', state: 'spike' }) });
  await sleep(2500);
  check('custom state "spike" renders different data in another frame', r.dom.window.document.querySelector('#confirmed1')?.textContent === '99999999');
  r.dom.window.close();
  r = await renderInDom(lib.instance.url + '/', { windowName: 'easel:' + JSON.stringify({ id: 'f2', state: 'empty' }) });
  await sleep(2500);
  check('automatic "empty" state exposes the app\'s missing empty state (stays 0, script error)', r.dom.window.document.querySelector('#confirmed1')?.textContent === '0', r.errors[0]?.slice(0, 80) || '');
  r.dom.window.close();
  const m = await j('GET', `/api/workspaces/${lib.id}/mocks`);
  check('request log shows mocked calls', m.log.some((l) => l.outcome === 'mock' && l.url.includes('covid19india')), `${m.log.length} calls · outcomes: ${[...new Set(m.log.map((l) => l.outcome))].join(',')}`);
  // 4. copy, edit, export
  const copy = await j('POST', `/api/projects/${d.project.id}/workspaces`, { name: 'Indian number format' });
  await waitRunning(copy.id);
  const script = (await j('GET', `/api/workspaces/${copy.id}/file?path=script.js`)).content;
  const edited = script.replace('$(this).text(Math.ceil(now));', "$(this).text(Math.ceil(now).toLocaleString('en-IN'));");
  await j('PUT', `/api/workspaces/${copy.id}/file`, { path: 'script.js', content: edited });
  const cw = await j('GET', `/api/workspaces/${copy.id}`);
  r = await renderInDom(cw.instance.url + '/');
  await sleep(2500);
  const fmt = r.dom.window.document.querySelector('#confirmed1')?.textContent;
  check('frame copy runs its own code (mocks came along)', fmt === '3,42,85,814', `confirmed=${fmt}`);
  r.dom.window.close();
  const diff = await (await fetch(`${B}/api/workspaces/${copy.id}/export?format=diff`)).text();
  check('diff contains only the code change (no mocks, no .env)', diff.includes("toLocaleString('en-IN')") && !diff.includes('easel.mocks'), `${diff.split('\n').length} lines`);
  const libScript = (await j('GET', `/api/workspaces/${lib.id}/file?path=script.js`)).content;
  check('Library untouched by the copy', !libScript.includes('toLocaleString'));
  return d;
}

async function suiteFlask() {
  current = 'flask';
  console.log('\n▸ Flask (Python)');
  const d = await addAndWait(path.join(FIX, 'flask-app'));
  check('setup finishes (venv + pip install + flask run)', d.project.status === 'ready', `${d.secs}s · ${setupSummary(d)}`);
  const routes = d.project.routes.map((r) => r.path);
  check('routes from code + crawl', routes.includes('/products/:pid') && routes.includes('/products/7'), routes.join(' '));
  check('pages respond 200', Object.values(d.project.routeStatus).every((s) => s.status === 200), JSON.stringify(d.project.routeStatus));
  const lib = libOf(d);
  check('Jinja page gets the runtime', (await html(lib.instance.url + '/products/7')).includes('/__easel/runtime.js'));
  check('JSON passes through untouched', (await (await fetch(lib.instance.url + '/api/status')).json()).ok === true);
  await j('PUT', `/api/workspaces/${lib.id}/mocks/file`, { name: 'status.json', content: { rules: [{ id: 'st', match: { method: 'GET', path: '/api/status' }, states: { default: { json: { ok: 'mocked' } } } }] } });
  await sleep(300);
  check('same-origin mock overrides the Flask endpoint', (await (await fetch(lib.instance.url + '/api/status')).json()).ok === 'mocked');
  const err = await fetch(lib.instance.url + '/api/status', { headers: { 'x-easel-state': 'error' } });
  check('state header switches the same endpoint to its error state', err.status === 500);
  return d;
}

async function suiteDjango() {
  current = 'django';
  console.log('\n▸ Django (Python)');
  const d = await addAndWait(path.join(FIX, 'django-app'));
  check('setup finishes (venv + pip + migrate + runserver)', d.project.status === 'ready', `${d.secs}s · ${setupSummary(d)}`);
  check('URLconf routes resolved through include()', ['/', '/posts/:pk', '/archive/:year', '/accounts/profile', '/admin'].every((p) => d.project.routes.some((r) => r.path === p)), d.project.routes.map((r) => r.path).join(' '));
  const lib = libOf(d);
  const r = await fetch(lib.instance.url + '/posts/1/', { headers: { accept: 'text/html' } });
  const body = await r.text();
  check('page renders through the proxy', r.status === 200 && body.includes('Post 1'));
  check("Django's X-Frame-Options: DENY is stripped so it can sit on the canvas", !r.headers.get('x-frame-options'));
  const prof = await fetch(lib.instance.url + '/accounts/profile/', { redirect: 'manual' });
  check('login-required page redirects to login (Location rewritten to the proxy)', prof.status === 302 && (prof.headers.get('location') || '').startsWith('/admin/login'), prof.headers.get('location'));
  return d;
}

async function suiteVite() {
  current = 'vite';
  console.log('\n▸ Vite + React (npm install)');
  const d = await addAndWait(path.join(FIX, 'vite-react'));
  check('setup finishes (npm install + vite)', d.project.status === 'ready', `${d.secs}s · ${setupSummary(d)}`);
  check('env bootstrapped from .env.example', d.project.env?.created === '.env' && d.project.env.keys.includes('VITE_API_URL'), JSON.stringify(d.project.env));
  check('React Router routes', ['/', '/users', '/users/:id', '/about'].every((p) => d.project.routes.some((r) => r.path === p)));
  const lib = libOf(d);
  const page = await html(lib.instance.url + '/users');
  check('runtime injected before Vite client', page.indexOf('/__easel/runtime.js') > -1 && page.indexOf('/__easel/runtime.js') < page.indexOf('/@vite/client'));
  const mod = await (await fetch(lib.instance.url + '/src/pages/Home.jsx')).text();
  check('modules compile through the proxy', /Dashboard/.test(mod) && /jsx|createElement/.test(mod));
  const port = Number(new URL(lib.instance.url).port);
  check('HMR websocket upgrades through the proxy', (await wsUpgrade(port, '/', 'vite-hmr')).includes('101'));
  const copy = await j('POST', `/api/projects/${d.project.id}/workspaces`, { name: 'Dashboard idea' });
  const cw = await waitRunning(copy.id);
  check('frame copy starts on its own port (deps hard-linked, no reinstall)', cw.instance?.status === 'running' && cw.instance.url !== lib.instance.url, cw.instance?.url);
  const home = (await j('GET', `/api/workspaces/${copy.id}/file?path=src/pages/Home.jsx`)).content;
  await j('PUT', `/api/workspaces/${copy.id}/file`, { path: 'src/pages/Home.jsx', content: home.replace('Dashboard', 'Revenue overview') });
  await sleep(600);
  const mod2 = await (await fetch(cw.instance.url + '/src/pages/Home.jsx')).text();
  check('copy serves the edit; Library does not', mod2.includes('Revenue overview') && !(await (await fetch(lib.instance.url + '/src/pages/Home.jsx')).text()).includes('Revenue overview'));
  const patch = await (await fetch(`${B}/api/workspaces/${copy.id}/export?format=patch`)).text();
  check('mbox patch ready for git am', patch.startsWith('From ') && patch.includes('Revenue overview') && !patch.includes('node_modules') && !patch.includes('.env'));
  const design = await j('GET', `/api/projects/${d.project.id}/design`);
  const btn = design.components.find((c) => c.name === 'Button');
  check('components with file:line, props, usage', btn && btn.file === 'src/components/Button.jsx' && btn.uses >= 1 && btn.props.includes("variant='secondary'"), btn ? `${btn.file}:${btn.line} ${btn.props.join(',')} ×${btn.uses}` : 'missing');
  const found = await j('GET', `/api/workspaces/${lib.id}/find?q=New%20report&q=btn-primary`);
  check('find-in-code locates an element by its text', found.some((h) => h.file === 'src/pages/Home.jsx'), found.slice(0, 2).map((h) => `${h.file}:${h.line}`).join(' '));
  return d;
}

async function suiteNext() {
  current = 'next';
  console.log('\n▸ Next.js App Router (npm install next)');
  const d = await addAndWait(path.join(FIX, 'next-app'));
  check('setup finishes', d.project.status === 'ready', `${d.secs}s · ${setupSummary(d)}`);
  const lib = libOf(d);
  const page = await html(lib.instance.url + '/about');
  check('server-rendered page gets the runtime', page.includes('/__easel/runtime.js') && page.includes('app/about/page.tsx'));
  let news = await html(lib.instance.url + '/news');
  check('server component fetch to an unreachable API → error UI', news.includes('news-error'));
  await j('PUT', `/api/workspaces/${lib.id}/mocks/file`, { name: 'news.json', content: { rules: [{ id: 'news', match: { method: 'GET', url: 'https://api.example-news.com/top' }, states: { default: { json: [{ id: 1, title: 'Mocked on the server' }, { id: 2, title: 'Second story' }] } } }] } });
  await sleep(300);
  news = await html(lib.instance.url + '/news');
  check('server-side fetch answered by Easel mocks (Node hook)', news.includes('Mocked on the server'));
  const port = Number(new URL(lib.instance.url).port);
  check('Next HMR websocket upgrades', (await wsUpgrade(port, '/_next/webpack-hmr')).includes('101'));
  return d;
}

async function suiteMcp() {
  current = 'mcp';
  console.log('\n▸ MCP server (stdio)');
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'easel.js'), 'mcp'], { env: { ...process.env, EASEL_URL: B }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  child.stdout.on('data', (b) => lines.push(...b.toString().split('\n').filter(Boolean)));
  const call = async (id, method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (let i = 0; i < 100; i++) {
      const hit = lines.map((l) => JSON.parse(l)).find((m) => m.id === id);
      if (hit) return hit;
      await sleep(50);
    }
    return null;
  };
  const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
  check('initialize', init?.result?.serverInfo?.name === 'easel');
  const list = await call(2, 'tools/list', {});
  check('tools/list', list?.result?.tools?.length >= 15, `${list?.result?.tools?.length} tools`);
  const projects = await call(3, 'tools/call', { name: 'easel_projects_list', arguments: {} });
  const parsed = JSON.parse(projects?.result?.content?.[0]?.text || '[]');
  check('tools/call easel_projects_list', Array.isArray(parsed) && parsed.length > 0, parsed.map((p) => p.name).join(', '));
  child.kill();
}

// ------------------------------------------------------------------ run
const t0 = Date.now();
const suites = { static: suiteStatic, covid: suiteCovid, flask: suiteFlask, django: suiteDjango, vite: suiteVite, next: suiteNext, mcp: suiteMcp };
for (const [name, fn] of Object.entries(suites)) {
  if (!want(name)) continue;
  try {
    await fn();
  } catch (e) {
    current = name;
    check('suite crashed', false, e.stack?.split('\n').slice(0, 3).join(' ') || e.message);
  }
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} checks passed in ${Math.round((Date.now() - t0) / 1000)}s  (data: ${HOME})`);
fs.writeFileSync(path.join(HOME, 'e2e-results.json'), JSON.stringify(results, null, 2));
const { stopAll } = await import('../src/runner.js');
stopAll();
server.close();
process.exit(pass === results.length ? 0 : 1);
