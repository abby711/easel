// Builds demo/easel-demo.html: a self-contained, clickable snapshot of the Easel UI
// (real API data + page snapshots captured from running apps). Useful for sharing
// what Easel looks like without running it, and for visual checks.
//   node test/make-demo.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.EASEL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'easel-demo-'));
process.env.EASEL_QUIET = '1';
const PORT = Number(process.env.EASEL_DEMO_PORT || 4960);
process.env.EASEL_APP_PORT_START ||= '5100';
const { startServer } = await import('../src/server.js');
const server = await startServer({ port: PORT, autostart: false });
const B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return r.json();
};
async function add(source) {
  const p = await j('POST', '/api/projects', { source });
  for (;;) {
    const d = await j('GET', `/api/projects/${p.id}`);
    if (d.project.status !== 'setting-up') return d;
    await sleep(800);
  }
}

const covid = await add('https://github.com/abby711/dynamic-covidtracker');
await add(path.join(ROOT, 'test/fixtures/static-site'));
await add(path.join(ROOT, 'test/fixtures/flask-app'));
const pid = covid.project.id;
const lib = covid.workspaces.find((w) => w.kind === 'library');
await j('PUT', `/api/workspaces/${lib.id}/mocks/file`, { name: 'covid.json', content: { rules: [{ id: 'covid-india', match: { method: 'GET', url: 'https://data.covid19india.org/data.json' }, states: {
  default: { json: { statewise: [{ lastupdatedtime: '31/10/2021 23:59:00', confirmed: '34285814', deltaconfirmed: '12514', deaths: '458470', deltadeaths: '251', active: '158817', recovered: '33668527', deltarecovered: '12718' }] } },
  spike: { json: { statewise: [{ lastupdatedtime: 'what-if: spike', confirmed: '99999999', deltaconfirmed: '400000', deaths: '1000000', deltadeaths: '4000', active: '5000000', recovered: '93999999', deltarecovered: '300000' }] } },
} }] } });
const copy = await j('POST', `/api/projects/${pid}/workspaces`, { name: 'Indian number format' });
await sleep(800);
const script = (await j('GET', `/api/workspaces/${copy.id}/file?path=script.js`)).content;
await j('PUT', `/api/workspaces/${copy.id}/file`, { path: 'script.js', content: script.replace('$(this).text(Math.ceil(now));', "$(this).text(Math.ceil(now).toLocaleString('en-IN'));") });

// Lay out a board like a designer would.
let d = await j('GET', `/api/projects/${pid}`);
const board = d.boards[0];
const base = board.frames[0];
const W = 1280, H = 800, GX = 160, GY = 220;
board.frames = [
  { ...base, label: 'India dashboard', x: 0, y: 0 },
  { ...base, id: 'fcopy01', workspaceId: copy.id, label: 'Indian number format', x: W + GX, y: 0 },
  { ...base, id: 'fspike1', state: 'spike', label: 'India dashboard', x: 2 * (W + GX), y: 0 },
  { ...base, id: 'fempty1', state: 'empty', label: 'India dashboard', x: 0, y: H + GY },
  { ...base, id: 'ferror1', state: 'error', label: 'India dashboard', x: W + GX, y: H + GY },
  { ...base, id: 'fmob001', viewport: 'mobile', w: 390, h: 844, label: 'India dashboard · Mobile', x: 2 * (W + GX), y: H + GY },
];
board.notes = [{ id: 'n1', x: 3 * (W + GX), y: 0, w: 520, h: 300, text: 'Crore-size totals are hard to read.\n\nCopy on the right formats them the Indian way (3,42,85,814). Empty and error states show the page has no fallback UI yet.' }];
await j('PUT', `/api/projects/${pid}/boards/${board.id}`, board);
d = await j('GET', `/api/projects/${pid}`);

// Snapshot each frame's rendered page with jsdom (CSS inlined, scripts removed).
const require = createRequire(import.meta.url);
const { JSDOM, ResourceLoader, VirtualConsole } = await import('jsdom');
async function snapshot(url, state) {
  class Loader extends ResourceLoader {
    fetch(u, o) {
      if (/jquery[^/]*\.js/.test(u)) return Promise.resolve(fs.readFileSync(require.resolve('jquery/dist/jquery.min.js')));
      if (!u.startsWith(new URL(url).origin)) return Promise.resolve(Buffer.from(''));
      return super.fetch(u, o);
    }
  }
  const dom = await JSDOM.fromURL(url, { runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: new VirtualConsole(), beforeParse(w) {
    w.name = 'easel:' + JSON.stringify({ id: 'snap', state });
  } });
  await sleep(2600);
  const doc = dom.window.document;
  for (const l of [...doc.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = new URL(l.getAttribute('href'), url);
    let css = '';
    if (href.origin === new URL(url).origin) css = await (await fetch(href)).text();
    const s = doc.createElement('style');
    s.textContent = css;
    l.replaceWith(s);
  }
  doc.querySelectorAll('script').forEach((s) => s.remove());
  const out = '<!doctype html>' + doc.documentElement.outerHTML;
  dom.window.close();
  return out;
}
const pages = {};
const instUrl = (wid) => d.workspaces.find((w) => w.id === wid).instance.url;
for (const f of d.boards[0].frames) pages[`${f.workspaceId}|${f.route}|${f.state || 'default'}`] = await snapshot(instUrl(f.workspaceId) + f.route, f.state || 'default');

// Canned API answers for the demo.
const api = {};
const put = (p, v) => (api['GET ' + p] = v);
put('/api/viewports', await j('GET', '/api/viewports'));
put('/api/projects', await j('GET', '/api/projects'));
put('/api/instances', await j('GET', '/api/instances'));
for (const p of api['GET /api/projects']) put(`/api/projects/${p.id}`, await j('GET', `/api/projects/${p.id}`));
put(`/api/projects/${pid}/design`, await j('GET', `/api/projects/${pid}/design`));
put(`/api/projects/${pid}/sync`, await j('GET', `/api/projects/${pid}/sync`));
put('/api/doctor', await j('GET', '/api/doctor'));
for (const w of d.workspaces) {
  put(`/api/workspaces/${w.id}/mocks`, await j('GET', `/api/workspaces/${w.id}/mocks`));
  put(`/api/workspaces/${w.id}/logs`, await j('GET', `/api/workspaces/${w.id}/logs`));
  put(`/api/workspaces/${w.id}/files`, await j('GET', `/api/workspaces/${w.id}/files`));
  put(`/api/workspaces/${w.id}/changes`, await j('GET', `/api/workspaces/${w.id}/changes`));
  api[`TEXT /api/workspaces/${w.id}/export?format=diff`] = await (await fetch(`${B}/api/workspaces/${w.id}/export?format=diff`)).text();
}

const safe = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const css = fs.readFileSync(path.join(ROOT, 'ui/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'ui/app.js'), 'utf8');
const shell = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Easel demo</title>
<style>${css}
.demo-wide #app:not(.is-home) { grid-template-columns: 248px 1fr auto !important; }
.demo-wide #app:not(.is-home) #sidebar { display: flex !important; }
.demo-wide #inspector:not([hidden]) { display: block !important; }
</style>
<script>
window.__EASEL_DEMO__ = { pages: ${safe(pages)} };
const __API = ${safe(api)};
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const p = url.replace(location.origin, '');
  const m = (init.method || 'GET').toUpperCase();
  const json = (v) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
  if (__API['TEXT ' + p] != null) return new Response(__API['TEXT ' + p], { headers: { 'content-type': 'text/plain' } });
  if (m === 'GET' && __API['GET ' + p] !== undefined) return json(__API['GET ' + p]);
  if (m === 'GET' && __API['GET ' + p.split('?')[0]] !== undefined) return json(__API['GET ' + p.split('?')[0]]);
  if (m !== 'GET') return json(init.body ? JSON.parse(init.body) : { ok: true });
  return json({ error: 'demo: not captured' });
};
window.EventSource = class { constructor() {} close() {} };
// Narrow preview panes: render the desktop layout scaled down instead of the mobile one.
if (innerWidth < 1100) {
  const z = innerWidth / 1440;
  document.documentElement.style.zoom = z;
  document.documentElement.classList.add('demo-wide');
  addEventListener('DOMContentLoaded', () => { const a = document.getElementById('app'); a.style.width = '1440px'; a.style.height = Math.round(innerHeight / z) + 'px'; });
}
if (!location.hash) location.hash = '#/p/${pid}';
try { if (!localStorage.getItem('easel.view.${pid}.${board.id}')) localStorage.setItem('easel.view.${pid}.${board.id}', JSON.stringify({ x: 40, y: 90, z: 0.3 })); } catch (e) {}
</script></head>
<body><div id="app"><header id="topbar"></header><aside id="sidebar"></aside><main id="viewport"><div id="world"></div><div id="overlay-layer"></div><div id="toolbar"></div></main><aside id="inspector" hidden></aside></div>
<div id="modal-root"></div><div id="toast-root"></div>
<script type="module">${app.replace(/<\/script/gi, '<\\/script')}
setTimeout(() => { const s = document.querySelectorAll('.frame .shield')[1]; if (s) s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 })); }, 1200);
</script></body></html>`;
fs.mkdirSync(path.join(ROOT, 'demo'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'demo', 'easel-demo.html'), shell);
console.log('wrote demo/easel-demo.html', Math.round(shell.length / 1024) + ' KB', Object.keys(pages).length, 'page snapshots');
const { stopAll } = await import('../src/runner.js');
stopAll();
server.close();
process.exit(0);
