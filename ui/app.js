// Easel canvas UI. Plain JS, no build step.
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = (p = 'f') => p + Math.random().toString(16).slice(2, 10);

/** Tiny DOM builder: h('div', {class, style, onclick, ...attrs}, ...children). null/false children are skipped. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

// ---------------------------------------------------------------- icons (16px grid, 1.5px stroke)
const PATHS = {
  select: '<path d="M4 2.5l8.5 5.1-3.9 1-1.7 3.9z"/>',
  hand: '<path d="M5.5 8.2V4.3a1 1 0 0 1 2 0v3.4M7.5 7.6V3.2a1 1 0 0 1 2 0v4.4M9.5 7.6V4.4a1 1 0 0 1 2 0v3.4M11.5 7.8V6.2a1 1 0 0 1 2 0v3.6a4.4 4.4 0 0 1-4.4 4.4h-.6a4 4 0 0 1-3.2-1.6L3.1 9.9a1 1 0 0 1 1.5-1.3l.9 1"/>',
  note: '<path d="M3 3h10v6.5L9.5 13H3z"/><path d="M9.5 13V9.5H13"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  external: '<path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v4H2.5V4h4"/>',
  chevron: '<path d="M5 6.5l3 3 3-3"/>',
  play: '<path d="M5 3.5v9l7-4.5z"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1"/>',
  inspect: '<circle cx="8" cy="8" r="4.5"/><path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5"/>',
  reload: '<path d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3M13.2 2.5v3.2H10"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3A.5.5 0 0 0 10 2.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h.5"/>',
  branch: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5" r="1.5"/><path d="M4.5 5v6M11.5 6.5c0 2.6-3.4 2.8-6.3 4.6"/>',
  states: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  devices: '<rect x="1.5" y="3" width="9" height="7" rx="1"/><path d="M4 13h4"/><rect x="11.5" y="6" width="3" height="7" rx="1"/>',
  code: '<path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5"/>',
  diff: '<path d="M4 2.5h5.5l3 3v8H4z"/><path d="M6.5 7.5h3M8 6v3M6.5 11h3"/>',
  trash: '<path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 9h6.6l.7-9"/>',
  routes: '<path d="M3 4h10M3 8h10M3 12h6"/>',
  data: '<ellipse cx="8" cy="4" rx="5" ry="1.75"/><path d="M3 4v8c0 1 2.2 1.75 5 1.75S13 13 13 12V4M3 8c0 1 2.2 1.75 5 1.75S13 9 13 8"/>',
  design: '<path d="M8 2a6 6 0 1 0 0 12c.9 0 1.3-.6 1.1-1.3-.3-1 .3-1.7 1.3-1.7H12a2 2 0 0 0 2-2A6 6 0 0 0 8 2z"/><circle cx="5.3" cy="7" r=".6" fill="currentColor"/><circle cx="7.6" cy="4.9" r=".6" fill="currentColor"/><circle cx="10.6" cy="5.7" r=".6" fill="currentColor"/>',
  logs: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M4.8 6.5l1.8 1.5-1.8 1.5M8.2 10H11"/>',
  desktop: '<rect x="1.5" y="2.5" width="13" height="8.5" rx="1"/><path d="M6 13.5h4M8 11v2.5"/>',
  laptop: '<rect x="3" y="3.5" width="10" height="7" rx="1"/><path d="M1.5 12.5h13"/>',
  tablet: '<rect x="3.5" y="1.5" width="9" height="13" rx="1.5"/><path d="M7.3 12.3h1.4"/>',
  mobile: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7.3 12.3h1.4"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  alert: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h.01"/>',
  folder: '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  page: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 5.5h11"/>',
  library: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 6.5h11M6.5 6.5v7"/>',
  arrowRight: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  param: '<path d="M5.5 2.5c-1.4 0-2 .6-2 1.9v1.5c0 .9-.4 1.6-1.5 2.1 1.1.5 1.5 1.2 1.5 2.1v1.5c0 1.3.6 1.9 2 1.9M10.5 2.5c1.4 0 2 .6 2 1.9v1.5c0 .9.4 1.6 1.5 2.1-1.1.5-1.5 1.2-1.5 2.1v1.5c0 1.3-.6 1.9-2 1.9"/>',
  sync: '<path d="M2.8 6.5A5.2 5.2 0 0 1 12.3 5M13.2 9.5A5.2 5.2 0 0 1 3.7 11M12.5 2.5V5h-2.5M3.5 13.5V11H6"/>',
};
function I(name, cls = '') {
  return h('span', { class: 'ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>` });
}
const LOGO = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="5" style="fill:var(--ink)"/><rect x="5" y="5" width="4" height="10" rx="1" style="fill:var(--panel)"/><rect x="11" y="5" width="4" height="6" rx="1" style="fill:var(--panel);opacity:.55"/></svg>';
/** Icon-only button with an accessible name. */
const ibtn = (icon, label, onclick, { cls = '', on = false } = {}) => h('button', { class: `ibtn ${cls}${on ? ' on' : ''}`, 'aria-label': label, title: label, 'aria-pressed': on ? 'true' : null, onclick }, I(icon));

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

function toast(msg, bad = false) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2800);
}
const guard = (fn) => async (...a) => {
  try {
    return await fn(...a);
  } catch (e) {
    toast(e.message, true);
    console.error(e);
  }
};

// ---------------------------------------------------------------- state
const PANELS = [['routes', 'Routes', 'routes'], ['mocks', 'Data', 'data'], ['design', 'Design', 'design'], ['logs', 'Logs', 'logs']];
const savedPanel = localStorage.getItem('easel.panel');
const S = {
  clientId: uid('c'),
  projects: [],
  project: null,
  workspaces: [],
  boards: [],
  board: null,
  instances: {},
  viewports: {},
  view: { x: 80, y: 120, z: 0.35 },
  sel: null, // {type:'frame'|'note', id}
  playing: null,
  inspecting: null,
  picked: null,
  hits: [],
  meta: {}, // frameId -> {path,title,height,errors:[]}
  reload: {}, // frameId -> counter
  panel: PANELS.some((p) => p[0] === savedPanel) ? savedPanel : 'routes',
  tool: 'select',
  design: null,
  mocks: {},
  logsWs: null,
  mocksWs: null,
  sync: null,
  hideSetup: false,
  doctor: null,
  renaming: null,
};

const world = $('#world');
const viewport = $('#viewport');
const frameEls = new Map();
const noteEls = new Map();

// ---------------------------------------------------------------- boot & routing
async function boot() {
  S.viewports = await api('GET', '/api/viewports');
  S.projects = await api('GET', '/api/projects');
  for (const i of await api('GET', '/api/instances')) S.instances[i.id] = i;
  connectEvents();
  window.addEventListener('hashchange', route);
  await route();
}

async function route() {
  const m = location.hash.match(/^#\/p\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return showHome();
  await openProject(m[1], m[2]);
}

async function openProject(pid, bid) {
  let data;
  try {
    data = await api('GET', `/api/projects/${pid}`);
  } catch {
    location.hash = '';
    return;
  }
  const changed = S.project?.id !== pid;
  S.project = data.project;
  S.workspaces = data.workspaces;
  for (const w of data.workspaces) if (w.instance) S.instances[w.id] = w.instance;
  S.boards = data.boards;
  S.board = S.boards.find((b) => b.id === bid) || S.boards[0] || null;
  if (changed) {
    Object.assign(S, { sel: null, playing: null, inspecting: null, picked: null, design: null, meta: {}, hideSetup: false, mocksWs: null, logsWs: null });
    clearCanvas();
    const saved = JSON.parse(localStorage.getItem('easel.view.' + pid + '.' + (S.board?.id || '')) || 'null');
    if (saved) S.view = saved;
    else requestAnimationFrame(() => fitView());
    refreshSync();
  }
  renderAll();
}

function showHome() {
  S.project = null;
  S.board = null;
  clearCanvas();
  renderAll();
}

function clearCanvas() {
  for (const el of frameEls.values()) el.remove();
  for (const el of noteEls.values()) el.remove();
  frameEls.clear();
  noteEls.clear();
}

const wsById = (id) => S.workspaces.find((w) => w.id === id);
const library = () => S.workspaces.find((w) => w.kind === 'library');
const frameById = (id) => S.board?.frames.find((f) => f.id === id);

// ---------------------------------------------------------------- events
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const d = msg.data;
    switch (msg.type) {
      case 'setup':
        if (S.project?.id === d.projectId) {
          const wasSetting = S.project.status === 'setting-up';
          S.project.setup = d.setup;
          S.project.status = d.status;
          renderSetup();
          if (wasSetting && d.status !== 'setting-up') openProject(d.projectId, S.board?.id);
        }
        updateProjectInList(d.projectId, { status: d.status });
        break;
      case 'project':
        updateProjectInList(d.project.id, d.project);
        if (S.project?.id === d.project.id) {
          S.project = d.project;
          renderSidebar();
          renderTopbar();
        }
        break;
      case 'project-removed':
        S.projects = S.projects.filter((p) => p.id !== d.projectId);
        if (!S.project) renderHome();
        break;
      case 'board':
        if (S.project?.id === d.projectId && d.from !== S.clientId) {
          const i = S.boards.findIndex((b) => b.id === d.board.id);
          if (i >= 0) S.boards[i] = d.board;
          else S.boards.push(d.board);
          if (S.board?.id === d.board.id && !drag) S.board = d.board;
          if (!S.board) S.board = d.board;
          syncCanvas();
          renderSidebar();
        }
        break;
      case 'workspace':
        if (S.project?.id === d.projectId && !wsById(d.workspace.id)) S.workspaces.push(d.workspace);
        break;
      case 'instance':
        S.instances[d.id] = d;
        if (S.project && d.projectId === S.project.id) {
          syncCanvas();
          if (S.panel === 'logs' || S.panel === 'routes') renderSidebar();
          if (S.sel) renderInspector();
        }
        break;
      case 'files-changed':
        if (S.project?.stack?.adapter === 'static' || S.project?.stack?.adapter === 'php') reloadFramesOf(d.id);
        break;
      case 'mocks-changed':
        reloadFramesOf(d.id);
        delete S.mocks[d.id];
        if (S.panel === 'mocks') renderSidebar();
        break;
      case 'log':
        if (S.panel === 'logs' && (S.logsWs || library()?.id) === d.id) {
          const box = $('#logbox');
          if (box) {
            const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
            box.append(d.line + '\n');
            if (atBottom) box.scrollTop = box.scrollHeight;
          }
        }
        break;
      default:
    }
  };
  es.onerror = () => {
    /* EventSource reconnects by itself */
  };
}

function updateProjectInList(id, patch) {
  const p = S.projects.find((x) => x.id === id);
  if (p) Object.assign(p, patch);
  else if (patch.id) S.projects.unshift(patch);
  if (!S.project && $('.home')) renderHome();
}

function reloadFramesOf(wid) {
  for (const f of S.board?.frames || []) if (f.workspaceId === wid) S.reload[f.id] = (S.reload[f.id] || 0) + 1;
  syncCanvas();
}

// ---------------------------------------------------------------- render
function renderAll() {
  $('#app').classList.toggle('is-home', !S.project);
  renderTopbar();
  renderSidebar();
  syncCanvas();
  renderToolbar();
  renderInspector();
  renderSetup();
  if (!S.project) renderHome();
  else $('.home')?.remove();
  applyView();
}

// ---- menus
let openMenuEl = null;
function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
}
function openMenu(anchor, items) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'menu', role: 'menu' }, items.map((it) => (it === '-' ? h('div', { class: 'menu-sep', role: 'separator' }) : h('button', {
    class: 'menu-item',
    role: 'menuitem',
    onclick: () => {
      closeMenu();
      it.onClick();
    },
  }, h('span', { class: 'check' }, it.checked ? I('check') : it.icon ? I(it.icon) : null), h('span', { class: 'trunc' }, it.label), it.sub ? h('span', { class: 'sub' }, it.sub) : null))));
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  menu.style.left = r.left / zoom + 'px';
  menu.style.top = (r.bottom + 4) / zoom + 'px';
  document.body.append(menu);
  openMenuEl = menu;
  menu.querySelector('.menu-item')?.focus();
}
document.addEventListener('pointerdown', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
}, true);

function renderTopbar() {
  const bar = $('#topbar');
  bar.replaceChildren();
  bar.append(h('a', { class: 'logo', href: '#', 'aria-label': 'Easel: all projects', title: 'Easel', html: LOGO }));
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { class: 'crumb' + (S.project ? '' : ' current'), href: '#' }, 'Projects'));
  if (S.project) {
    const btn = h('button', { class: 'crumb current', 'aria-haspopup': 'menu', title: 'Switch project' }, h('span', { class: 'trunc' }, S.project.name), I('chevron'));
    btn.addEventListener('click', () => openMenu(btn, [
      ...S.projects.map((p) => ({ label: p.name, sub: p.stack?.label || '', checked: p.id === S.project?.id, onClick: () => (location.hash = `#/p/${p.id}`) })),
      '-',
      { label: 'Add project…', icon: 'plus', onClick: () => {
        location.hash = '';
        setTimeout(() => $('.connect .input')?.focus(), 60);
      } },
    ]));
    crumbs.append(h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'), btn);
  }
  bar.append(crumbs, h('div', { class: 'spacer' }));
  if (S.project) {
    const st = S.project.stack;
    if (st) bar.append(h('span', { class: 'bar-meta', title: `Detected by the ${st.adapter} adapter` }, st.label + (S.project.subdir ? ` · ${S.project.subdir}/` : '')));
    const sy = S.sync;
    if (sy) {
      bar.append(h('span', { class: 'bar-div' }));
      if (!sy.remote) bar.append(h('span', { class: 'sync' }, h('span', { class: 'dot' }), 'Local folder'));
      else if (sy.upToDate) bar.append(h('span', { class: 'sync', title: `${sy.branch} @ ${sy.head}` }, h('span', { class: 'dot ok' }), `Up to date with ${sy.branch}`));
      else bar.append(h('button', { class: 'sync', onclick: guard(pullLatest), title: 'Pull the latest commits and recompile' }, h('span', { class: 'dot warn' }), `${sy.behind} behind ${sy.branch}`, h('span', { class: 'link' }, 'Update')));
    }
  }
}

async function refreshSync() {
  if (!S.project || !S.project.stack) return;
  try {
    S.sync = await api('GET', `/api/projects/${S.project.id}/sync`);
    renderTopbar();
  } catch {
    /* offline */
  }
}
async function pullLatest() {
  toast('Pulling latest and recompiling…');
  S.sync = await api('POST', `/api/projects/${S.project.id}/sync`);
  await openProject(S.project.id, S.board?.id);
  toast('Library updated');
}

function switchBoard(bid) {
  saveView();
  location.hash = `#/p/${S.project.id}/${bid}`;
  S.board = S.boards.find((b) => b.id === bid);
  S.sel = null;
  clearCanvas();
  const saved = JSON.parse(localStorage.getItem('easel.view.' + S.project.id + '.' + bid) || 'null');
  if (saved) S.view = saved;
  else requestAnimationFrame(() => fitView());
  renderAll();
}

async function newBoard() {
  const name = `Page ${S.boards.length}`;
  const b = await api('POST', `/api/projects/${S.project.id}/boards`, { name, frames: [] });
  S.boards.push(b);
  S.renaming = b.id;
  switchBoard(b.id);
}
async function renameBoard(b, name) {
  S.renaming = null;
  name = (name || '').trim();
  if (!name || name === b.name) return renderSidebar();
  b.name = name;
  renderSidebar();
  await api('PUT', `/api/projects/${S.project.id}/boards/${b.id}`, { name, clientId: S.clientId });
}

// ---------------------------------------------------------------- home
function sourceText(p) {
  if (p.source?.type === 'git') return p.source.url.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '');
  return p.source?.path || '';
}
function statusDot(status) {
  return status === 'ready' ? 'ok' : status === 'error' || status === 'unsupported' ? 'bad' : status === 'setting-up' ? 'busy' : '';
}
const STATUS_TEXT = { ready: 'Ready', error: 'Needs attention', unsupported: 'Not supported', 'setting-up': 'Setting up' };

function renderHome() {
  $('.home')?.remove();
  if (S.project) return;
  const input = h('input', { class: 'input', placeholder: 'GitHub URL, owner/repo, or a folder path', 'aria-label': 'Repository URL or folder path', autocomplete: 'off', spellcheck: 'false' });
  const add = guard(async () => {
    const source = input.value.trim();
    if (!source) return input.focus();
    const p = await api('POST', '/api/projects', { source });
    S.projects.unshift(p);
    location.hash = `#/p/${p.id}`;
  });
  const list = S.projects.length
    ? h('div', { class: 'plist' },
      h('div', { class: 'plist-h' }, h('span', {}, 'Name'), h('span', {}, 'Status'), h('span', {}, 'Source')),
      S.projects.map((p) => h('button', { class: 'prow', onclick: () => (location.hash = `#/p/${p.id}`) },
        h('span', { class: 'trunc' }, h('div', { class: 'pn trunc' }, p.name), h('div', { class: 'ps trunc' }, p.stack ? p.stack.label + (p.subdir ? ` · ${p.subdir}/` : '') : 'Detecting…')),
        h('span', { class: 'pstat' }, h('span', { class: 'dot ' + statusDot(p.status) }), STATUS_TEXT[p.status] || p.status),
        h('span', { class: 'psrc trunc', title: sourceText(p) }, sourceText(p)))))
    : h('div', { class: 'plist' }, h('div', { class: 'empty', style: { padding: '14px 8px' } }, 'No projects yet. Add a repository or a folder above.'));
  const home = h('div', { class: 'home' },
    h('div', { class: 'home-inner' },
      h('h1', { class: 'home-title' }, 'Projects'),
      h('form', { class: 'connect', onsubmit: (e) => {
        e.preventDefault();
        add();
      } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Add')),
      h('p', { class: 'hint' }, 'Easel clones or copies the code into its own folder and runs it on this machine. It never pushes.'),
      list,
      h('p', { class: 'toolchains', id: 'doctor' })));
  viewport.append(home);
  renderDoctor();
}
async function renderDoctor() {
  try {
    S.doctor ||= await api('GET', '/api/doctor');
  } catch {
    return;
  }
  const el = $('#doctor');
  if (!el) return;
  const have = Object.entries(S.doctor.tools).filter(([, v]) => v).map(([k]) => k);
  const ready = S.doctor.adapters.filter((a) => a.ready).length;
  el.textContent = `Toolchains on this machine: ${have.join(', ') || 'none'}. ${ready} of ${S.doctor.adapters.length} stacks can run; anything else works with an easel.json.`;
}

// ---------------------------------------------------------------- setup checklist
let setupTimer = null;
const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function renderSetup() {
  const layer = $('#overlay-layer');
  layer.querySelector('.setup')?.remove();
  clearInterval(setupTimer);
  const p = S.project;
  if (!p || !p.setup || S.hideSetup) return;
  const busy = p.status === 'setting-up';
  const failed = p.status === 'error' || p.status === 'unsupported';
  if (!busy && !failed) return;
  const elapsed = h('span', { class: 'muted num' }, fmtElapsed(Date.now() - (p.createdAt || Date.now())));
  const icon = (s) => {
    if (s.status === 'done') return I('check');
    if (s.status === 'running') return h('span', { class: 'spin' });
    if (s.status === 'error' || s.status === 'warn') return I('alert');
    return h('span', { class: 'ring' });
  };
  const card = h('section', { class: 'setup', 'aria-label': 'Setup progress' },
    h('div', { class: 'setup-h' }, h('span', { class: 't grow trunc' }, busy ? `Setting up ${p.name}` : `${p.name} needs attention`), busy ? elapsed : null, ibtn('close', 'Hide setup progress', () => ((S.hideSetup = true), renderSetup()), { cls: 'sm' })),
    !busy ? h('p', { class: 'setup-msg' }, p.error || 'Setup stopped. The logs say why.') : null,
    p.setup.steps.map((s) => h('div', { class: 'step ' + s.status }, h('span', { class: 'si' }, icon(s)), h('div', {}, h('div', { class: 'st' }, s.label), s.detail ? h('div', { class: 'sd' }, s.detail) : null))),
    failed ? h('div', { class: 'btn-row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm', onclick: () => setPanel('logs') }, 'Open logs'),
      library() ? h('button', { class: 'btn sm', onclick: guard(() => api('POST', `/api/workspaces/${library().id}/restart`)) }, 'Retry') : null) : null);
  layer.append(card);
  if (busy) setupTimer = setInterval(() => (elapsed.textContent = fmtElapsed(Date.now() - (p.createdAt || Date.now()))), 1000);
}

// ---------------------------------------------------------------- sidebar
function setPanel(p) {
  S.panel = p;
  localStorage.setItem('easel.panel', p);
  renderSidebar();
}

function renderSidebar() {
  const side = $('#sidebar');
  side.replaceChildren();
  if (!S.project) return;
  // Pages (boards)
  const pages = h('section', { class: 'sec sec-pages', 'aria-label': 'Pages' },
    h('div', { class: 'sec-h' }, h('span', {}, 'Pages'), h('span', { class: 'spacer' }), ibtn('plus', 'New page', guard(newBoard), { cls: 'sm' })),
    S.boards.map((b) => {
      const on = S.board?.id === b.id;
      if (S.renaming === b.id) {
        const inp = h('input', { class: 'input rename', value: b.name, 'aria-label': 'Page name' });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') renameBoard(b, inp.value);
          if (e.key === 'Escape') {
            e.stopPropagation();
            S.renaming = null;
            renderSidebar();
          }
        });
        inp.addEventListener('blur', () => S.renaming === b.id && renameBoard(b, inp.value));
        setTimeout(() => {
          inp.focus();
          inp.select();
        }, 0);
        return h('div', { class: 'row on' }, I(b.kind === 'library' ? 'library' : 'page'), inp);
      }
      return h('div', {
        class: 'row click' + (on ? ' on' : ''),
        role: 'button',
        tabindex: '0',
        title: b.kind === 'library' ? 'Your app as it is today' : 'Double-click to rename',
        onclick: () => !on && switchBoard(b.id),
        onkeydown: (e) => e.key === 'Enter' && switchBoard(b.id),
        ondblclick: () => {
          if (b.kind === 'library') return;
          S.renaming = b.id;
          renderSidebar();
        },
      }, I(b.kind === 'library' ? 'library' : 'page'), h('span', { class: 'grow trunc' }, b.name), h('span', { class: 'muted num' }, String(b.frames.length)));
    }));
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, PANELS.map(([k, l, ic]) => h('button', { class: 'tab', role: 'tab', 'aria-selected': S.panel === k ? 'true' : 'false', onclick: () => setPanel(k), title: l }, I(ic), h('span', {}, l))));
  const body = h('div', { class: 'side-body', role: 'tabpanel' });
  side.append(pages, tabs, body);
  if (S.panel === 'routes') renderRoutes(body);
  else if (S.panel === 'design') renderDesign(body);
  else if (S.panel === 'mocks') renderMocks(body);
  else renderLogs(body);
}

const sec = (title, opts, ...kids) => {
  const { count, actions, label } = opts || {};
  return h('section', { class: 'sec', 'aria-label': label || title }, h('div', { class: 'sec-h' }, h('span', {}, title), count != null ? h('span', { class: 'count num' }, String(count)) : null, h('span', { class: 'spacer' }), actions || null), ...kids);
};

function statusCode(st) {
  if (!st) return h('span', { class: 'code' }, '—');
  if (st.status === 0) return h('span', { class: 'code bad', title: st.error }, 'err');
  const cls = st.expected || st.status < 300 ? 'ok' : st.status < 400 ? 'warn' : 'bad';
  return h('span', { class: 'code ' + cls, title: `${st.ms ?? '?'} ms${st.redirect ? ' → ' + st.redirect : ''}` }, String(st.status));
}

function renderRoutes(body) {
  const p = S.project;
  const routes = p.routes || [];
  const onBoard = new Set((S.board?.frames || []).map((f) => f.pattern || f.route));
  const params = [...new Set(routes.filter((r) => r.dynamic).flatMap((r) => [...r.path.matchAll(/:([A-Za-z0-9_-]+)/g)].map((m) => m[1])))];
  body.append(sec('Routes', {
    count: routes.length,
    actions: [
      ibtn('sync', 'Find routes again (code, crawl, links seen in frames)', guard(async () => {
        await api('POST', `/api/projects/${p.id}/rediscover`);
        toast('Routes refreshed');
      }), { cls: 'sm' }),
      ibtn('check', 'Check every page and record status codes', guard(async () => {
        toast('Checking pages…');
        await api('POST', `/api/projects/${p.id}/check`);
      }), { cls: 'sm' }),
    ],
  },
  routes.length ? routes.map((r) => h('div', {
    class: 'row click',
    role: 'button',
    tabindex: '0',
    title: (r.file ? `${r.file}${r.line ? ':' + r.line : ''} · ` : '') + (onBoard.has(r.path) ? 'On this page — click to focus' : 'Click to add to this page'),
    onclick: () => focusOrAddRoute(r),
    onkeydown: (e) => e.key === 'Enter' && focusOrAddRoute(r),
  },
  r.dynamic ? h('span', { class: 'code', title: 'Needs a value' }, I('param', 'sm')) : statusCode(p.routeStatus?.[r.path]),
  h('span', { class: 'grow mono trunc' }, r.path),
  onBoard.has(r.path) ? h('span', { class: 'onboard', 'aria-label': 'On this page' }) : null)) : h('div', { class: 'empty' }, 'No routes found yet.')));

  const add = h('input', { class: 'input mono', placeholder: '/some/page', 'aria-label': 'Add a route' });
  add.addEventListener('keydown', guard(async (e) => {
    if (e.key !== 'Enter' || !add.value.trim()) return;
    await api('POST', `/api/projects/${p.id}/routes`, { path: add.value.trim() });
    add.value = '';
    await openProject(p.id, S.board?.id);
  }));
  body.append(sec('Add a route', {}, add));

  if (params.length) {
    const inputs = params.map((k) => {
      const i = h('input', { class: 'input mono', value: p.samples?.[k] || '', placeholder: 'e.g. 1', id: 'sample-' + k });
      i.dataset.k = k;
      return h('div', { class: 'field' }, h('label', { for: 'sample-' + k }, ':' + k), i);
    });
    body.append(sec('Sample values', {}, h('p', { class: 'sec-note' }, 'Fill these to put dynamic routes on the Library.'), inputs,
      h('button', { class: 'btn sm', onclick: guard(async () => {
        const samples = {};
        body.querySelectorAll('input[data-k]').forEach((i) => (samples[i.dataset.k] = i.value.trim()));
        await api('POST', `/api/projects/${p.id}/samples`, { samples });
        await openProject(p.id, S.board?.id);
      }) }, 'Save values')));
  }

  body.append(sec('Workspaces', { count: S.workspaces.length }, S.workspaces.map((w) => {
    const inst = S.instances[w.id];
    return h('div', { class: 'row' },
      h('span', { class: 'dot ' + instDot(inst), title: inst ? inst.status : 'not running' }),
      h('span', { class: 'grow trunc', title: w.dir }, w.name),
      h('span', { class: 'muted' }, w.kind === 'copy' ? 'copy' : 'base'),
      inst?.url ? h('a', { class: 'ibtn sm', href: inst.url + '/', target: '_blank', rel: 'noopener', 'aria-label': `Open ${w.name} in a new tab`, title: 'Open in a new tab' }, I('external')) : null,
      ibtn('diff', `Changes in ${w.name}`, () => openChanges(w.id), { cls: 'sm' }),
      w.kind === 'copy' ? ibtn('trash', `Delete ${w.name}`, guard(async () => {
        if (!(await confirmDialog(`Delete “${w.name}”?`, 'The copy and every change in it will be removed. The Library is not affected.', { ok: 'Delete copy', danger: true }))) return;
        await api('DELETE', `/api/workspaces/${w.id}`);
        S.workspaces = S.workspaces.filter((x) => x.id !== w.id);
        S.board.frames = S.board.frames.filter((f) => f.workspaceId !== w.id);
        saveBoard();
        renderAll();
      }), { cls: 'sm danger' }) : null);
  })));

  if (p.candidates?.length > 1) {
    body.append(sec('Apps in this repo', {}, p.candidates.map((c) => h('div', {
      class: 'row click' + (c.subdir === p.subdir ? ' on' : ''),
      role: 'button',
      tabindex: '0',
      onclick: guard(async () => {
        if (c.subdir === p.subdir) return;
        toast(`Switching to ${c.subdir || 'the repo root'}…`);
        await api('POST', `/api/projects/${p.id}/subdir`, { subdir: c.subdir });
        await openProject(p.id);
      }),
    }, I('folder'), h('span', { class: 'grow mono trunc' }, c.subdir || '.'), h('span', { class: 'muted trunc' }, c.label)))));
  }
  body.append(h('section', { class: 'sec' }, h('button', { class: 'text-btn danger', onclick: guard(async () => {
    if (!(await confirmDialog(`Remove ${p.name}?`, 'Easel deletes its own checkout, copies and boards. Your original repository is untouched.', { ok: 'Remove project', danger: true }))) return;
    await api('DELETE', `/api/projects/${p.id}`);
    S.projects = S.projects.filter((x) => x.id !== p.id);
    location.hash = '';
  }) }, 'Remove project…')));
}

function instDot(inst) {
  if (!inst) return 'off';
  if (inst.status === 'running') return 'ok';
  if (['error', 'crashed'].includes(inst.status)) return 'bad';
  if (inst.status === 'stopped') return 'off';
  return 'busy';
}

const focusOrAddRoute = guard(async (r) => {
  const f = S.board?.frames.find((x) => x.route === r.path || x.pattern === r.path);
  if (f) return focusFrame(f.id);
  let routePath = r.path;
  if (r.dynamic) {
    routePath = await ask('Open a dynamic route', { label: r.path, value: r.path.replace(/:([A-Za-z0-9_-]+)\*?\??/g, (_, k) => S.project.samples?.[k] || '1'), ok: 'Add frame', mono: true });
    if (!routePath) return;
  }
  const f2 = addFrame({ workspaceId: library().id, route: routePath, pattern: r.dynamic ? r.path : null });
  focusFrame(f2.id);
});

async function renderDesign(body) {
  if (!S.design) {
    body.append(h('div', { class: 'sec' }, h('div', { class: 'empty' }, 'Reading the design system…')));
    try {
      S.design = await api('GET', `/api/projects/${S.project.id}/design`);
    } catch (e) {
      body.replaceChildren(h('div', { class: 'sec' }, h('div', { class: 'empty' }, e.message)));
      return;
    }
    if (S.panel === 'design') renderSidebar();
    return;
  }
  const { tokens: t, components, rendered, pagesMeasured } = S.design;
  const swatch = (value, label, title) => h('div', { class: 'sw', title: title || value }, h('div', { class: 'chip', style: { background: value } }), h('div', { class: 'lbl' }, label || value));
  const refresh = ibtn('sync', 'Re-measure the design system', () => {
    S.design = null;
    for (const f of S.board?.frames || []) postToFrame(f.id, { type: 'census' });
    setTimeout(renderSidebar, 600);
  }, { cls: 'sm' });
  const colorVars = t.vars.filter((v) => v.kind === 'color');
  let first = true;
  const head = () => {
    const a = first ? refresh : null;
    first = false;
    return a;
  };
  if (colorVars.length) body.append(sec('Colour tokens', { count: colorVars.length, actions: head() }, h('div', { class: 'swatches' }, colorVars.slice(0, 48).map((v) => swatch(v.value.startsWith('var(') ? 'transparent' : v.value, v.name.replace(/^--/, ''), `${v.name}: ${v.value}\n${v.file}:${v.line} · used ${v.uses}×`)))));
  if (t.colors.length) body.append(sec('Colours in code', { count: t.colors.length, actions: head() }, h('div', { class: 'swatches' }, t.colors.slice(0, 36).map((c) => swatch(c.value, c.value, `${c.value} · ${c.count}× · first at ${c.where}`)))));
  if (rendered?.colors?.length || rendered?.backgrounds?.length) {
    body.append(sec('On rendered pages', { count: pagesMeasured, actions: head() },
      h('div', { class: 'label', style: { margin: '0 0 6px' } }, 'Text'), h('div', { class: 'swatches' }, (rendered.colors || []).slice(0, 12).map((c) => swatch(c.value, `${c.count}×`, c.value))),
      h('div', { class: 'label', style: { margin: '10px 0 6px' } }, 'Backgrounds'), h('div', { class: 'swatches' }, (rendered.backgrounds || []).slice(0, 12).map((c) => swatch(c.value, `${c.count}×`, c.value)))));
  }
  const list = (title, items, fmt) => {
    if (!items?.length) return;
    body.append(sec(title, { count: items.length, actions: head() }, items.slice(0, 14).map((x) => h('div', { class: 'row' }, h('span', { class: 'grow trunc' }, fmt ? fmt(x) : x.value), h('span', { class: 'muted num' }, x.count + '×')))));
  };
  list('Fonts', t.fonts, (x) => h('span', { style: { fontFamily: x.value } }, x.value));
  if (rendered?.fonts?.length) list('Fonts on pages', rendered.fonts, (x) => h('span', { style: { fontFamily: x.value } }, x.value));
  list('Type sizes', t.fontSizes.length ? t.fontSizes : rendered?.sizes, (x) => h('span', { class: 'mono' }, x.value));
  list('Radii', t.radii.length ? t.radii : rendered?.radii, (x) => h('span', { class: 'mono' }, x.value));
  list('Spacing', t.spacing.length ? t.spacing : rendered?.spacing, (x) => h('span', { class: 'mono' }, x.value));
  const other = t.vars.filter((v) => v.kind !== 'color');
  if (other.length) body.append(sec('Other tokens', { count: other.length, actions: head() }, other.slice(0, 30).map((v) => h('div', { class: 'row', title: `${v.file}:${v.line}` }, h('span', { class: 'grow mono trunc' }, v.name), h('span', { class: 'mono muted trunc', style: { maxWidth: '45%' } }, v.value)))));
  if (t.tailwind.classes.length) list('Tailwind classes', t.tailwind.classes, (x) => h('span', { class: 'mono' }, x.value));
  body.append(sec('Components', { count: components.length, actions: head() },
    components.length ? components.slice(0, 60).map((c) => h('div', {
      class: 'row click',
      role: 'button',
      tabindex: '0',
      title: (c.props?.length ? 'props: ' + c.props.join(', ') + '\n' : '') + (c.usedIn?.length ? 'used in: ' + c.usedIn.join(', ') : ''),
      onclick: () => openEditor(library().id, c.file, c.line),
    }, h('span', { class: 'grow trunc' }, h('span', { style: { fontWeight: 600 } }, c.name), '  ', h('span', { class: 'mono muted' }, `${c.file}:${c.line}`)), h('span', { class: 'muted num' }, `${c.uses}×`))) : h('div', { class: 'empty' }, 'No components found.')));
}

async function renderMocks(body) {
  const wid = S.mocksWs || (S.sel?.type === 'frame' && frameById(S.sel.id)?.workspaceId) || library()?.id;
  if (!wid) return;
  const pick = h('select', { class: 'select', id: 'mocks-ws', onchange: (e) => ((S.mocksWs = e.target.value), renderSidebar()) }, S.workspaces.map((w) => h('option', { value: w.id, selected: w.id === wid }, w.name)));
  let m = S.mocks[wid];
  if (!m) {
    body.append(sec('Workspace', {}, pick));
    try {
      m = S.mocks[wid] = await api('GET', `/api/workspaces/${wid}/mocks`);
    } catch (e) {
      body.append(h('div', { class: 'sec' }, h('div', { class: 'empty' }, e.message)));
      return;
    }
    if (S.panel === 'mocks') renderSidebar();
    return;
  }
  const modes = { auto: 'Rules, then recordings, then live (records new calls)', live: 'Rules, then live. Nothing is recorded', replay: 'Rules and recordings only. Fully offline', off: 'No mocks. Every call goes live' };
  const modeSel = h('select', { class: 'select', id: 'mocks-mode', disabled: m.stopped, onchange: guard(async (e) => {
    S.mocks[wid] = await api('POST', `/api/workspaces/${wid}/mocks/mode`, { mode: e.target.value });
    renderSidebar();
  }) }, Object.keys(modes).map((k) => h('option', { value: k, selected: m.mode === k }, k[0].toUpperCase() + k.slice(1))));
  body.append(sec('Workspace', {}, h('div', { class: 'field' }, pick), h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', { for: 'mocks-mode' }, 'Mode'), modeSel), h('p', { class: 'sec-note', style: { margin: '6px 0 0' } }, modes[m.mode] || '')));
  body.append(sec('Rules', { count: m.rules.length, actions: ibtn('plus', 'New mock rule', () => openMockEditor(wid), { cls: 'sm' }) },
    m.rules.length ? m.rules.map((r) => h('div', { class: 'row click', role: 'button', tabindex: '0', onclick: () => openMockEditor(wid, r.file.split('#')[0]), title: r.note || r.file },
      h('span', { class: 'method' }, r.ws ? 'WS' : r.method === '*' ? 'ANY' : r.method), h('span', { class: 'grow mono trunc' }, (r.url || r.path || '').replace(/^https?:\/\//, '')), h('span', { class: 'muted trunc', style: { maxWidth: '40%' } }, r.states.join(', ')))) : h('p', { class: 'sec-note', style: { margin: 0 } }, 'No rules yet. Calls the app makes appear below; record them or write a rule to control the data.'),
    h('p', { class: 'sec-note', style: { margin: '8px 0 0' } }, `Every rule also answers ${m.states.filter((s) => ['empty', 'error', 'slow', 'loading', 'offline'].includes(s)).join(', ')}. Pick a state per frame in the inspector.`)));
  if (m.recorded.length) body.append(sec('Recorded', { count: m.recorded.length },
    m.recorded.map((r) => h('div', { class: 'row' }, h('span', { class: 'method' }, r.method), h('span', { class: 'grow mono trunc', title: r.url }, r.url.replace(/^https?:\/\//, '')),
      h('button', { class: 'text-btn', title: 'Copy into an editable rule file', onclick: guard(async () => {
        const f = await api('GET', `/api/workspaces/${wid}/mocks/file?name=${encodeURIComponent(r.file)}`);
        const doc = JSON.parse(f.content);
        const name = r.file.replace(/^recorded\//, '');
        await api('PUT', `/api/workspaces/${wid}/mocks/file`, { name, content: { rules: [{ ...doc, id: doc.id.replace(/^rec-/, 'rule-') }] } });
        delete S.mocks[wid];
        openMockEditor(wid, name);
      }) }, 'Edit')))));
  body.append(sec('Recent requests', { count: m.log.length, actions: ibtn('reload', 'Refresh the request log', () => ((S.mocks[wid] = null), renderSidebar()), { cls: 'sm' }) },
    m.log.length ? m.log.slice().reverse().slice(0, 60).map((l) => h('div', { class: 'row', title: `${l.method} ${l.url}\n${l.outcome}${l.rule ? ' · ' + l.rule : ''}${l.error ? ' · ' + l.error : ''}` },
      h('span', { class: 'outcome ' + l.outcome }, l.outcome),
      h('span', { class: 'grow mono trunc' }, l.url.replace(/^https?:\/\//, '')),
      h('span', { class: 'muted num' }, l.status || '—'))) : h('div', { class: 'empty' }, 'No requests yet.')));
}

async function renderLogs(body) {
  const wid = S.logsWs || library()?.id;
  if (!wid) return;
  const inst = S.instances[wid];
  const running = inst && inst.status !== 'stopped';
  const statusText = inst ? inst.status[0].toUpperCase() + inst.status.slice(1) + (inst.step ? ` · ${inst.step}` : '') : 'Not running';
  body.append(sec('Workspace', {},
    h('div', { class: 'field' }, h('select', { class: 'select', 'aria-label': 'Workspace', onchange: (e) => ((S.logsWs = e.target.value), renderSidebar()) }, S.workspaces.map((w) => h('option', { value: w.id, selected: w.id === wid }, w.name)))),
    h('div', { class: 'status-line' }, h('span', { class: 'dot ' + instDot(inst) }), h('span', { class: 'grow trunc' }, statusText)),
    inst?.error ? h('p', { class: 'err-text' }, inst.error) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn sm', onclick: guard(() => api('POST', `/api/workspaces/${wid}/${running ? 'restart' : 'start'}`)) }, I(running ? 'reload' : 'play'), running ? 'Restart' : 'Start'),
      running ? h('button', { class: 'btn sm', onclick: guard(() => api('POST', `/api/workspaces/${wid}/stop`)) }, I('stop'), 'Stop') : null,
      inst?.url ? h('a', { class: 'btn sm', href: inst.url + '/', target: '_blank', rel: 'noopener' }, I('external'), 'Open') : null)));
  const box = h('pre', { class: 'log', id: 'logbox', 'aria-label': 'Dev server output' }, '…');
  body.append(h('section', { class: 'sec' }, h('div', { class: 'sec-h' }, 'Output'), box));
  try {
    const lines = await api('GET', `/api/workspaces/${wid}/logs`);
    box.textContent = lines.length ? lines.join('\n') + '\n' : 'No output yet.';
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    box.textContent = e.message;
  }
}

// ---------------------------------------------------------------- canvas
function applyView() {
  const { x, y, z } = S.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  world.style.setProperty('--inv', String(1 / z));
  for (const el of frameEls.values()) sizeHead(el.querySelector('.frame-label'), parseFloat(el.style.width) || 1280);
  const zl = $('#zoom-label');
  if (zl) zl.textContent = Math.round(z * 100) + '%';
}
let viewSaveT;
function saveView() {
  if (!S.project || !S.board) return;
  localStorage.setItem('easel.view.' + S.project.id + '.' + S.board.id, JSON.stringify(S.view));
}
function viewChanged() {
  applyView();
  clearTimeout(viewSaveT);
  viewSaveT = setTimeout(saveView, 300);
}

function bounds(items) {
  if (!items.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    x0 = Math.min(x0, it.x);
    y0 = Math.min(y0, it.y - 40);
    x1 = Math.max(x1, it.x + it.w);
    y1 = Math.max(y1, it.y + it.h);
  }
  return { x0, y0, x1, y1 };
}
function fitView(items) {
  const list = Array.isArray(items) ? items : [...(S.board?.frames || []), ...(S.board?.notes || [])];
  const b = bounds(list);
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  if (!b) {
    S.view = { x: 80, y: 120, z: 0.5 };
    return viewChanged();
  }
  const pad = 72;
  const z = clamp(Math.min((vw - pad * 2) / (b.x1 - b.x0), (vh - pad * 2) / (b.y1 - b.y0)), 0.04, 1);
  S.view = { z, x: (vw - (b.x1 - b.x0) * z) / 2 - b.x0 * z, y: (vh - (b.y1 - b.y0) * z) / 2 - b.y0 * z };
  viewChanged();
}
function focusFrame(id) {
  const f = frameById(id);
  if (!f) return;
  S.sel = { type: 'frame', id };
  fitView([f]);
  syncCanvas();
  renderInspector();
}
function zoomAt(factor, cx, cy) {
  const { x, y, z } = S.view;
  const nz = clamp(z * factor, 0.04, 2);
  S.view = { z: nz, x: cx - (cx - x) * (nz / z), y: cy - (cy - y) * (nz / z) };
  viewChanged();
}

/** Frame labels stay a constant on-screen size, clipped to the frame's on-screen width. */
function sizeHead(head, frameW) {
  if (!head) return;
  head.style.transform = `scale(${1 / S.view.z})`;
  head.style.maxWidth = Math.max(40, frameW * S.view.z) + 'px';
}

function frameSrc(f) {
  const inst = S.instances[f.workspaceId];
  if (!inst?.url) return null;
  return inst.url + (f.route.startsWith('/') ? f.route : '/' + f.route);
}

function makeFrameEl(f) {
  const el = h('div', { class: 'frame' });
  el.dataset.id = f.id;
  const head = h('div', { class: 'frame-label' });
  const body = h('div', { class: 'frame-body' });
  const status = h('div', { class: 'frame-status', hidden: true });
  const shield = h('div', { class: 'shield' });
  body.append(status, shield);
  el.append(head, body);
  shield.addEventListener('pointerdown', (e) => startDrag(e, 'frame', f.id));
  shield.addEventListener('dblclick', () => setPlaying(f.id));
  head.addEventListener('pointerdown', (e) => startDrag(e, 'frame', f.id));
  head.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    S.sel = { type: 'frame', id: f.id };
    syncCanvas();
    renderInspector();
    const n = $('#insp-name');
    n?.focus();
    n?.select();
  });
  return el;
}

function updateFrameEl(el, f) {
  el.style.left = f.x + 'px';
  el.style.top = f.y + 'px';
  el.style.width = f.w + 'px';
  el.style.height = f.h + 'px';
  el.classList.toggle('selected', S.sel?.type === 'frame' && S.sel.id === f.id);
  el.classList.toggle('playing', S.playing === f.id || S.inspecting === f.id);
  const ws = wsById(f.workspaceId);
  const meta = S.meta[f.id] || {};
  const inst = S.instances[f.workspaceId];
  const head = el.querySelector('.frame-label');
  const name = f.label || f.route;
  const showing = meta.path && meta.path !== f.route ? meta.path : null;
  const busy = inst && ['installing', 'preparing', 'starting'].includes(inst.status);
  const down = !inst || ['error', 'crashed', 'stopped'].includes(inst.status);
  const parts = [];
  if (busy || down) parts.push(h('span', { class: 'dot ' + (busy ? 'busy' : inst && inst.status !== 'stopped' ? 'bad' : 'off'), title: inst ? inst.status : 'not running' }));
  if (ws?.kind === 'copy') parts.push(h('span', { title: `Runs on its own copy: ${ws.name}` }, I('branch', 'sm')));
  parts.push(h('span', { class: 'fl-name' }, name));
  if (ws?.kind === 'copy' && ws.name !== f.label) parts.push(h('span', { class: 'trunc' }, ws.name));
  if (f.state && f.state !== 'default') parts.push(h('span', {}, '· ' + f.state));
  // The route is only worth showing when it adds something: not "/", not a repeat of the name.
  const routeText = showing ? `${f.route} → ${showing}` : name !== f.route && f.route !== '/' ? f.route : '';
  if (routeText) parts.push(h('span', { class: 'fl-route' }, routeText));
  if (meta.errors?.length) parts.push(h('span', { class: 'fl-err', title: meta.errors.map((x) => x.message).join('\n') }, `${meta.errors.length} error${meta.errors.length === 1 ? '' : 's'}`));
  head.replaceChildren(...parts);
  sizeHead(head, f.w);

  // status overlay
  const status = el.querySelector('.frame-status');
  let overlay = null;
  const btn = (label, onclick, primary = false) => h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick }, label);
  if (!inst || inst.status === 'stopped') overlay = h('div', { class: 'fs-in' }, h('div', { class: 'fs-title' }, 'Not running'), h('div', { class: 'fs-btns' }, btn('Start', guard(() => api('POST', `/api/workspaces/${f.workspaceId}/start`)), true)));
  else if (inst.status === 'error' || inst.status === 'crashed') {
    overlay = h('div', { class: 'fs-in' }, h('div', { class: 'fs-title' }, inst.status === 'crashed' ? 'The dev server stopped' : 'Couldn’t start the app'), inst.error ? h('pre', {}, inst.error) : null,
      h('div', { class: 'fs-btns' }, btn('Logs', () => ((S.logsWs = f.workspaceId), setPanel('logs'))), btn('Retry', guard(() => api('POST', `/api/workspaces/${f.workspaceId}/restart`)), true)));
  } else if (inst.status === 'installing' || inst.status === 'preparing') {
    overlay = h('div', { class: 'fs-in' }, h('div', { class: 'fs-title' }, h('span', { class: 'spin' }), inst.status === 'installing' ? 'Installing dependencies' : 'Preparing'), inst.step ? h('div', { class: 'muted' }, inst.step) : null);
  }
  status.hidden = !overlay;
  status.style.pointerEvents = overlay ? 'auto' : 'none';
  if (overlay) status.replaceChildren(overlay);
  // iframe (recreated only when what it shows changes)
  const src = frameSrc(f);
  const key = `${src}|${f.state || 'default'}|${S.reload[f.id] || 0}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.querySelector('iframe')?.remove();
    if (src && !(inst && ['installing', 'preparing'].includes(inst.status) && !inst.url)) {
      const ifr = h('iframe', { name: 'easel:' + JSON.stringify({ id: f.id, state: f.state || 'default' }), src, title: name, allow: 'clipboard-read; clipboard-write', loading: 'eager' });
      // Static demo/export mode: frames show captured snapshots instead of live servers.
      const demo = window.__EASEL_DEMO__;
      if (demo) {
        ifr.removeAttribute('src');
        ifr.srcdoc = demo.pages[`${f.workspaceId}|${f.route}|${f.state || 'default'}`] || demo.pages[`${f.workspaceId}|${f.route}|default`] || '<p style="font:13px system-ui;padding:20px;color:#888">No snapshot</p>';
      }
      el.querySelector('.frame-body').prepend(ifr);
      S.meta[f.id] = { ...(S.meta[f.id] || {}), errors: [] };
    }
  }
}

function makeNoteEl(n) {
  const el = h('div', { class: 'note', contenteditable: 'true', spellcheck: 'false', role: 'textbox', 'aria-label': 'Note', 'aria-multiline': 'true' });
  el.dataset.id = n.id;
  el.textContent = n.text || '';
  const grip = h('div', { class: 'note-grip', contenteditable: 'false' });
  el.append(grip);
  grip.addEventListener('pointerdown', (e) => startDrag(e, 'note', n.id));
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (S.sel?.id !== n.id) {
      S.sel = { type: 'note', id: n.id };
      syncCanvas();
      renderInspector();
    }
  });
  el.addEventListener('input', () => {
    const note = S.board.notes.find((x) => x.id === n.id);
    if (note) {
      note.text = el.innerText;
      saveBoard();
    }
  });
  return el;
}

function syncCanvas() {
  if (!S.board) {
    clearCanvas();
    return;
  }
  const ids = new Set(S.board.frames.map((f) => f.id));
  for (const [id, el] of frameEls) if (!ids.has(id)) {
    el.remove();
    frameEls.delete(id);
  }
  for (const f of S.board.frames) {
    let el = frameEls.get(f.id);
    if (!el) {
      el = makeFrameEl(f);
      world.append(el);
      frameEls.set(f.id, el);
    }
    updateFrameEl(el, f);
  }
  const nids = new Set((S.board.notes || []).map((n) => n.id));
  for (const [id, el] of noteEls) if (!nids.has(id)) {
    el.remove();
    noteEls.delete(id);
  }
  for (const n of S.board.notes || []) {
    let el = noteEls.get(n.id);
    if (!el) {
      el = makeNoteEl(n);
      world.append(el);
      noteEls.set(n.id, el);
    }
    Object.assign(el.style, { left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px' });
    el.classList.toggle('selected', S.sel?.id === n.id);
  }
  $('#overlay-layer .play-chip')?.remove();
  if (S.playing || S.inspecting) {
    $('#overlay-layer').append(h('button', { class: 'play-chip', onclick: () => (S.inspecting ? setInspecting(null) : setPlaying(null)), title: 'Stop' },
      S.inspecting ? 'Inspecting — click an element in the frame' : 'Playing — the frame is live', h('kbd', {}, 'Esc')));
  }
}

let saveT;
function saveBoard() {
  clearTimeout(saveT);
  const b = S.board;
  const pid = S.project?.id;
  if (!b || !pid) return;
  saveT = setTimeout(guard(() => api('PUT', `/api/projects/${pid}/boards/${b.id}`, { frames: b.frames, notes: b.notes || [], clientId: S.clientId })), 350);
}

function nextSpot(w, h0, near) {
  const frames = S.board.frames;
  if (near) {
    let x = near.x + near.w + 160;
    const y = near.y;
    while (frames.some((f) => f.x < x + w && f.x + f.w > x && f.y < y + h0 && f.y + f.h > y)) x += w + 160;
    return { x, y };
  }
  if (!frames.length) return { x: 0, y: 0 };
  const b = bounds(frames);
  return { x: b.x0, y: b.y1 + 220 };
}

function addFrame({ workspaceId, route, state = 'default', viewport: vpName = 'desktop', label, pattern = null, near = null, x, y }) {
  const vp = S.viewports[vpName] || { w: 1280, h: 800 };
  const spot = x != null ? { x, y } : nextSpot(vp.w, vp.h, near);
  const f = { id: uid('f'), workspaceId, route, pattern, state, viewport: vpName, w: vp.w, h: vp.h, label: label || route, ...spot };
  S.board.frames.push(f);
  saveBoard();
  syncCanvas();
  return f;
}

// interactions -------------------------------------------------
let drag = null;
let spaceDown = false;
function startDrag(e, kind, id) {
  if (e.button !== 0 && e.button !== 1) return;
  e.stopPropagation();
  e.preventDefault();
  if (kind === 'frame' || kind === 'note') {
    if (S.sel?.id !== id) {
      S.sel = { type: kind, id };
      if (S.playing && S.playing !== id) S.playing = null;
      syncCanvas();
      renderInspector();
      if (S.panel === 'mocks') renderSidebar();
    }
  }
  const item = kind === 'frame' ? frameById(id) : kind === 'note' ? S.board.notes.find((n) => n.id === id) : null;
  drag = { kind: spaceDown || S.tool === 'hand' || e.button === 1 ? 'pan' : kind, id, sx: e.clientX, sy: e.clientY, ox: item?.x, oy: item?.y, vx: S.view.x, vy: S.view.y, moved: false };
  try {
    viewport.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic events */
  }
}
viewport.addEventListener('pointerdown', (e) => {
  if (e.target !== viewport && e.target !== world) return;
  if (S.tool === 'note') {
    const r = viewport.getBoundingClientRect();
    const wx = (e.clientX - r.left - S.view.x) / S.view.z;
    const wy = (e.clientY - r.top - S.view.y) / S.view.z;
    const n = { id: uid('n'), x: wx, y: wy, w: 360, h: 220, text: '' };
    S.board.notes ||= [];
    S.board.notes.push(n);
    S.tool = 'select';
    S.sel = { type: 'note', id: n.id };
    saveBoard();
    syncCanvas();
    renderToolbar();
    renderInspector();
    setTimeout(() => noteEls.get(n.id)?.focus(), 30);
    return;
  }
  if (S.playing || S.inspecting) {
    setInspecting(null);
    setPlaying(null);
  }
  if (S.sel) {
    S.sel = null;
    syncCanvas();
    renderInspector();
  }
  drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y };
  viewport.classList.add('panning');
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  if (drag.kind === 'pan') {
    S.view.x = drag.vx + dx;
    S.view.y = drag.vy + dy;
    viewChanged();
    return;
  }
  const item = drag.kind === 'frame' ? frameById(drag.id) : S.board.notes.find((n) => n.id === drag.id);
  if (!item) return;
  item.x = Math.round(drag.ox + dx / S.view.z);
  item.y = Math.round(drag.oy + dy / S.view.z);
  const el = (drag.kind === 'frame' ? frameEls : noteEls).get(drag.id);
  if (el) {
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
  }
});
const endDrag = () => {
  if (drag && drag.moved && drag.kind !== 'pan') saveBoard();
  drag = null;
  viewport.classList.remove('panning');
};
viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);
viewport.addEventListener('wheel', (e) => {
  if (!S.project) return;
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.008), e.clientX - r.left, e.clientY - r.top);
  else {
    S.view.x -= e.deltaX;
    S.view.y -= e.deltaY;
    viewChanged();
  }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === 'Escape') {
    if (openMenuEl) return closeMenu();
    if ($('.modal-back')) return closeModal();
    if (S.inspecting) return setInspecting(null);
    if (S.playing) return setPlaying(null);
    if (S.sel) {
      S.sel = null;
      syncCanvas();
      renderInspector();
    }
    return;
  }
  if (typing || $('.modal-back')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === 'Space' && !spaceDown) {
    spaceDown = true;
    viewport.classList.add('hand');
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
    e.preventDefault();
    deleteSelection();
  }
  if (e.key === '!' || (e.key === '1' && e.shiftKey)) fitView();
  if (e.key === '0' && mod) {
    e.preventDefault();
    zoomAt(1 / S.view.z, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }
  if ((e.key === '=' || e.key === '+') && mod) {
    e.preventDefault();
    zoomAt(1.25, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }
  if (e.key === '-' && mod) {
    e.preventDefault();
    zoomAt(0.8, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }
  if (!mod && S.project) {
    if (e.key === 'n') setTool('note');
    if (e.key === 'h') setTool('hand');
    if (e.key === 'v') setTool('select');
  }
  if (e.key === 'Enter' && S.sel?.type === 'frame') setPlaying(S.sel.id);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceDown = false;
    viewport.classList.remove('hand');
  }
});

function setTool(t) {
  S.tool = t;
  renderToolbar();
}

function deleteSelection() {
  if (!S.sel || !S.board) return;
  if (S.sel.type === 'frame') S.board.frames = S.board.frames.filter((f) => f.id !== S.sel.id);
  else S.board.notes = (S.board.notes || []).filter((n) => n.id !== S.sel.id);
  S.sel = null;
  saveBoard();
  syncCanvas();
  renderInspector();
}

function setPlaying(id) {
  S.playing = id;
  if (id) S.sel = { type: 'frame', id };
  syncCanvas();
  renderInspector();
}
function setInspecting(id) {
  if (S.inspecting && S.inspecting !== id) postToFrame(S.inspecting, { type: 'inspect', on: false });
  S.inspecting = id;
  if (id) {
    S.sel = { type: 'frame', id };
    S.playing = null;
    postToFrame(id, { type: 'inspect', on: true });
  }
  syncCanvas();
  renderInspector();
}
function postToFrame(id, msg) {
  const ifr = frameEls.get(id)?.querySelector('iframe');
  try {
    ifr?.contentWindow?.postMessage({ __easelCmd: true, ...msg }, '*');
  } catch {
    /* ignore */
  }
}

function renderToolbar() {
  const tb = $('#toolbar');
  tb.hidden = !S.project;
  tb.setAttribute('role', 'toolbar');
  tb.setAttribute('aria-label', 'Canvas tools');
  tb.replaceChildren(
    ibtn('select', 'Select (V)', () => setTool('select'), { on: S.tool === 'select' }),
    ibtn('hand', 'Hand (H, or hold Space)', () => setTool('hand'), { on: S.tool === 'hand' }),
    ibtn('note', 'Note (N), then click the canvas', () => setTool('note'), { on: S.tool === 'note' }),
    h('span', { class: 'tb-sep', 'aria-hidden': 'true' }),
    ibtn('fit', 'Zoom to fit (Shift+1)', () => fitView()),
    h('button', { class: 'zoom num', id: 'zoom-label', title: 'Reset to 100% (Ctrl/⌘ 0)', 'aria-label': 'Zoom level, click to reset to 100%', onclick: () => zoomAt(1 / S.view.z, viewport.clientWidth / 2, viewport.clientHeight / 2) }, Math.round(S.view.z * 100) + '%'));
  viewport.classList.toggle('hand', S.tool === 'hand');
}

// ---------------------------------------------------------------- inspector
const VP_ICONS = { desktop: 'desktop', laptop: 'laptop', tablet: 'tablet', mobile: 'mobile' };

function renderInspector() {
  const el = $('#inspector');
  el.replaceChildren();
  if (!S.project) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (S.sel?.type === 'note') {
    el.append(h('div', { class: 'insp-head' }, h('div', { style: { fontWeight: 600, fontSize: '13px' } }, 'Note'), h('div', { class: 'insp-sub' }, 'Click the text to edit. Drag the top edge to move.')),
      sec('Actions', {}, h('div', { class: 'acts' }, h('button', { class: 'act danger', onclick: deleteSelection }, I('trash'), h('span', { class: 'grow' }, 'Remove note'), h('kbd', {}, 'Del')))));
    return;
  }
  const f = S.sel?.type === 'frame' ? frameById(S.sel.id) : null;
  if (!f) return renderBoardInspector(el);
  const ws = wsById(f.workspaceId);
  const inst = S.instances[f.workspaceId];
  const meta = S.meta[f.id] || {};
  const vp = S.viewports[f.viewport];

  const nameIn = h('input', { class: 'title-input', id: 'insp-name', value: f.label || '', 'aria-label': 'Frame name', spellcheck: 'false' });
  nameIn.addEventListener('change', () => {
    f.label = nameIn.value.trim() || f.route;
    saveBoard();
    syncCanvas();
  });
  nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && nameIn.blur());
  el.append(h('div', { class: 'insp-head' }, nameIn, h('div', { class: 'insp-sub num' }, `${vp?.label || f.viewport} · ${f.w} × ${Math.round(f.h)}`)));

  const routeIn = h('input', { class: 'input mono', id: 'insp-route', value: f.route, spellcheck: 'false' });
  const go = () => {
    let r = routeIn.value.trim() || '/';
    if (!r.startsWith('/')) r = '/' + r;
    f.route = r;
    saveBoard();
    syncCanvas();
  };
  routeIn.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  el.append(sec('Frame', {},
    h('div', { class: 'field' }, h('label', { for: 'insp-route' }, 'Route'), h('div', { class: 'input-wrap' }, routeIn, ibtn('arrowRight', 'Go to route', go, { cls: 'sm' }))),
    meta.path && meta.path !== f.route ? h('div', { class: 'showing' }, 'Now showing', h('span', { class: 'mono' }, meta.path), h('button', { class: 'text-btn', onclick: () => ((f.route = meta.path), saveBoard(), syncCanvas(), renderInspector()) }, 'Keep')) : null,
    h('div', { class: 'ws-row' }, h('span', { class: 'dot ' + instDot(inst), title: inst ? inst.status : 'not running' }), ws?.kind === 'copy' ? I('branch', 'sm') : null, h('span', { class: 'grow trunc' }, ws ? ws.name : 'Unknown workspace'), h('span', { class: 'kind' }, ws?.kind === 'copy' ? 'copy' : 'base'),
      inst?.url ? h('a', { class: 'ibtn sm', href: frameSrc(f), target: '_blank', rel: 'noopener', 'aria-label': 'Open this page in a new tab', title: 'Open in a new tab' }, I('external')) : null)));

  const states = S.mocks[f.workspaceId]?.states || ['default', 'empty', 'error', 'slow', 'loading', 'offline'];
  if (!S.mocks[f.workspaceId]) api('GET', `/api/workspaces/${f.workspaceId}/mocks`).then((m) => {
    S.mocks[f.workspaceId] = m;
    if (S.sel?.id === f.id) renderInspector();
  }).catch(() => {});
  el.append(sec('Data state', {},
    h('select', { class: 'select', 'aria-label': 'Data state', onchange: (e) => ((f.state = e.target.value), saveBoard(), syncCanvas(), renderInspector()) }, states.map((s) => h('option', { value: s, selected: (f.state || 'default') === s }, s[0].toUpperCase() + s.slice(1))))));

  const fit = h('input', { type: 'checkbox', checked: !!f.fit, onchange: (e) => {
    f.fit = e.target.checked;
    if (!f.fit) f.h = (S.viewports[f.viewport] || { h: 800 }).h;
    else if (meta.height) f.h = clamp(meta.height, 200, 4000);
    saveBoard();
    syncCanvas();
    renderInspector();
  } });
  el.append(sec('Viewport', {},
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Viewport', style: { marginBottom: '10px' } }, Object.entries(S.viewports).map(([k, v]) => h('button', {
      'aria-pressed': f.viewport === k ? 'true' : 'false',
      'aria-label': `${v.label} ${v.w}×${v.h}`,
      title: `${v.label} · ${v.w}×${v.h}`,
      onclick: () => {
        Object.assign(f, { viewport: k, w: v.w, h: f.fit && meta.height ? clamp(meta.height, 200, 4000) : v.h });
        saveBoard();
        syncCanvas();
        renderInspector();
      },
    }, I(VP_ICONS[k] || 'desktop')))),
    h('label', { class: 'toggle' }, fit, h('span', { class: 'track' }), 'Fit content height')));

  const act = (icon, label, onclick, { hint, on, danger, title } = {}) => h('button', { class: 'act' + (on ? ' on' : '') + (danger ? ' danger' : ''), onclick, title }, I(icon), h('span', { class: 'grow trunc' }, label), hint ? h('kbd', {}, hint) : null);
  el.append(sec('Actions', {}, h('div', { class: 'acts' },
    act(S.playing === f.id ? 'stop' : 'play', S.playing === f.id ? 'Stop playing' : 'Play', () => setPlaying(S.playing === f.id ? null : f.id), { hint: '↵', on: S.playing === f.id, title: 'Use the live app inside the frame' }),
    act('inspect', S.inspecting === f.id ? 'Stop inspecting' : 'Inspect', () => setInspecting(S.inspecting === f.id ? null : f.id), { on: S.inspecting === f.id, title: 'Click an element to find it in the code' }),
    act('reload', 'Reload', () => ((S.reload[f.id] = (S.reload[f.id] || 0) + 1), syncCanvas())),
    act('copy', 'Copy frame', guard(() => copyFrame(f)), { title: 'A separate copy of the code with its own server, placed beside this frame' }),
    act('states', 'States side by side', () => statesSideBySide(f), { title: 'Add this page in its other data states' }),
    act('devices', 'All viewports', () => viewportsSideBySide(f)),
    act('code', 'Code', () => openEditor(f.workspaceId)),
    act('diff', 'Changes', () => openChanges(f.workspaceId)),
    act('trash', 'Remove frame', deleteSelection, { danger: true, hint: 'Del' }))));

  if (S.picked && S.picked.frameId === f.id) {
    const p = S.picked.data;
    const colorRow = (k, v) => [h('span', { class: 'k' }, k), h('span', { class: 'v' }, /^rgb|^#/.test(v) ? h('span', { class: 'swatch', style: { background: v } }) : null, h('span', { class: 'mono trunc' }, v))];
    el.append(sec('Picked element', {},
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, 'Element'), h('span', { class: 'v mono trunc', title: p.path }, `<${p.tag}>${p.id ? '#' + p.id : ''}`),
        h('span', { class: 'k' }, 'Size'), h('span', { class: 'v num' }, `${p.rect.w} × ${p.rect.h}`),
        p.text ? [h('span', { class: 'k' }, 'Text'), h('span', { class: 'v trunc', title: p.text }, p.text.slice(0, 80))] : null,
        colorRow('Color', p.styles.color), colorRow('Background', p.styles.background),
        h('span', { class: 'k' }, 'Font'), h('span', { class: 'v mono trunc' }, `${p.styles.fontSize} / ${p.styles.fontWeight} ${p.styles.font.split(',')[0].replace(/"/g, '')}`),
        h('span', { class: 'k' }, 'Padding'), h('span', { class: 'v mono trunc' }, p.styles.padding),
        h('span', { class: 'k' }, 'Radius'), h('span', { class: 'v mono trunc' }, p.styles.radius),
        p.source ? [h('span', { class: 'k' }, 'Source'), h('span', { class: 'v trunc' }, `${p.source.component || p.source.framework}`)] : null),
      p.source?.file ? h('button', { class: 'hit', style: { marginTop: '6px' }, onclick: () => openEditor(f.workspaceId, relFile(p.source.file, ws), p.source.line) }, h('div', { class: 'f' }, `${relFile(p.source.file, ws)}${p.source.line ? ':' + p.source.line : ''}`), h('div', { class: 'pv' }, `${p.source.framework} source`)) : null,
      h('div', { class: 'label', style: { margin: '10px 0 2px' } }, 'Found in code'),
      S.hits.length ? S.hits.slice(0, 12).map((x) => h('button', { class: 'hit', onclick: () => openEditor(f.workspaceId, x.file, x.line) }, h('div', { class: 'f' }, `${x.file}:${x.line}`), h('div', { class: 'pv' }, x.preview))) : h('div', { class: 'empty' }, 'No matches for its text, id or classes.')));
  }
  if (meta.errors?.length) {
    el.append(sec('Errors', { count: meta.errors.length }, h('div', { class: 'err-list' }, meta.errors.slice(-10).map((x) => h('div', {}, x.message)))));
  }
}

function relFile(file, ws) {
  if (!file) return file;
  if (ws && file.startsWith(ws.appDir)) return file.slice(ws.appDir.length + 1);
  const m = file.match(/\/(src|app|pages|components|lib)\/.*/);
  return m ? m[0].slice(1) : file;
}

function renderBoardInspector(el) {
  const frames = S.board?.frames || [];
  const notes = S.board?.notes || [];
  const wsSel = h('select', { class: 'select', id: 'add-ws' }, S.workspaces.map((w) => h('option', { value: w.id }, w.name)));
  const routes = S.project.routes || [];
  const routeIn = h('input', { class: 'input mono', id: 'add-route', placeholder: '/', list: 'easel-routes', spellcheck: 'false' });
  const dl = h('datalist', { id: 'easel-routes' }, routes.map((r) => h('option', { value: r.path })));
  const vpSel = h('select', { class: 'select', id: 'add-vp' }, Object.entries(S.viewports).map(([k, v]) => h('option', { value: k }, `${v.label} · ${v.w}×${v.h}`)));
  el.append(h('div', { class: 'insp-head' },
    h('div', { style: { fontWeight: 600, fontSize: '13px' } }, S.board?.name || 'Page'),
    h('div', { class: 'insp-sub num' }, `${frames.length} frame${frames.length === 1 ? '' : 's'} · ${notes.length} note${notes.length === 1 ? '' : 's'}`)));
  el.append(sec('Canvas', {}, h('div', { class: 'kv' },
    h('span', { class: 'k' }, 'Select'), h('span', { class: 'v' }, 'Click a frame'),
    h('span', { class: 'k' }, 'Play'), h('span', { class: 'v' }, 'Double-click, or ', h('kbd', {}, '↵')),
    h('span', { class: 'k' }, 'Pan'), h('span', { class: 'v' }, 'Drag, scroll, or ', h('kbd', {}, 'Space')),
    h('span', { class: 'k' }, 'Zoom'), h('span', { class: 'v' }, h('kbd', {}, 'Ctrl/⌘'), ' + scroll'),
    h('span', { class: 'k' }, 'Fit'), h('span', { class: 'v' }, h('kbd', {}, 'Shift 1')))));
  el.append(sec('Add a frame', {},
    h('div', { class: 'field' }, h('label', { for: 'add-ws' }, 'Workspace'), wsSel),
    h('div', { class: 'field' }, h('label', { for: 'add-route' }, 'Route'), routeIn, dl),
    h('div', { class: 'field' }, h('label', { for: 'add-vp' }, 'Viewport'), vpSel),
    h('button', { class: 'btn primary', style: { width: '100%', justifyContent: 'center', marginTop: '4px' }, onclick: () => {
      const r = routeIn.value.trim() || '/';
      const f = addFrame({ workspaceId: wsSel.value, route: r.startsWith('/') ? r : '/' + r, viewport: vpSel.value });
      focusFrame(f.id);
    } }, 'Add frame')));
}

async function copyFrame(f) {
  const src = wsById(f.workspaceId);
  const name = await ask('Copy frame', { label: 'Name for the copy', value: `${f.label || f.route} idea`, ok: 'Create copy', note: 'Easel makes a separate checkout of the code with its own dev server. The Library stays untouched.' });
  if (!name) return;
  toast('Copying the code and starting it…');
  const ws = await api('POST', `/api/projects/${S.project.id}/workspaces`, { from: src.id, name });
  S.workspaces.push(ws);
  if (ws.instance) S.instances[ws.id] = ws.instance;
  const nf = addFrame({ workspaceId: ws.id, route: f.route, state: f.state, viewport: f.viewport, label: name, near: f });
  S.sel = { type: 'frame', id: nf.id };
  syncCanvas();
  renderInspector();
  renderSidebar();
}

function statesSideBySide(f) {
  const all = S.mocks[f.workspaceId]?.states || ['default', 'empty', 'error', 'loading'];
  // Built-in states that read well side by side, plus any custom states your rules define.
  const pick = all.filter((s) => s !== (f.state || 'default') && s !== 'slow' && s !== 'offline').slice(0, 5);
  let x = f.x;
  const y = f.y + f.h + 220;
  for (const s of pick) {
    addFrame({ workspaceId: f.workspaceId, route: f.route, state: s, viewport: f.viewport, label: `${f.label || f.route}`, x, y });
    x += f.w + 160;
  }
  fitView([f, ...S.board.frames.slice(-pick.length)]);
}

function viewportsSideBySide(f) {
  let x = f.x + f.w + 160;
  let n = 0;
  for (const [k, vp] of Object.entries(S.viewports)) {
    if (k === f.viewport || k === 'laptop') continue;
    addFrame({ workspaceId: f.workspaceId, route: f.route, state: f.state, viewport: k, label: `${f.label || f.route} · ${vp.label}`, x, y: f.y });
    x += vp.w + 160;
    n++;
  }
  fitView([f, ...S.board.frames.slice(-n)]);
}

// ---------------------------------------------------------------- messages from frames
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || !m.__easel) return;
  let id = m.frameId;
  if (!id || !frameEls.has(id)) {
    for (const [fid, el] of frameEls) if (el.querySelector('iframe')?.contentWindow === e.source) id = fid;
  }
  if (!id) return;
  const meta = (S.meta[id] ||= { errors: [] });
  const f = frameById(id);
  switch (m.type) {
    case 'ready':
      Object.assign(meta, { path: m.data.path, title: m.data.title, height: m.data.height, loaded: true });
      if (f?.fit && m.data.height && Math.abs(f.h - clamp(m.data.height, 200, 4000)) > 8) {
        f.h = clamp(m.data.height, 200, 4000);
        saveBoard();
      }
      syncCanvas();
      break;
    case 'route':
      meta.path = m.data.path;
      syncCanvas();
      if (S.sel?.id === id) renderInspector();
      break;
    case 'size':
      meta.height = m.data.height;
      if (f?.fit && Math.abs(f.h - clamp(m.data.height, 200, 4000)) > 8) {
        f.h = clamp(m.data.height, 200, 4000);
        saveBoard();
        syncCanvas();
      }
      break;
    case 'error':
      meta.errors = [...(meta.errors || []), m.data].slice(-30);
      syncCanvas();
      if (S.sel?.id === id) renderInspector();
      break;
    case 'picked':
      S.picked = { frameId: id, data: m.data };
      S.hits = [];
      renderInspector();
      findForPicked(f, m.data);
      break;
    default:
  }
});

async function findForPicked(f, p) {
  const terms = [];
  if (p.id) terms.push(p.id);
  if (p.text && p.text.length <= 60) terms.push(p.text.slice(0, 40));
  for (const c of p.classes.slice(0, 3)) if (!/^(css|sc|jsx|svelte|emotion|tw)-/.test(c) && c.length > 2) terms.push(c);
  if (!terms.length) return;
  try {
    S.hits = await api('GET', `/api/workspaces/${f.workspaceId}/find?` + terms.map((t) => 'q=' + encodeURIComponent(t)).join('&'));
  } catch {
    S.hits = [];
  }
  renderInspector();
}

// ---------------------------------------------------------------- modals
function openModal(title, bodyEl, { size = '', flush = false, foot = null, onClose = null, sub = null } = {}) {
  closeModal();
  const back = h('div', { class: 'modal-back', onpointerdown: (e) => e.target === back && closeModal() },
    h('div', { class: 'modal' + (size ? ' ' + size : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', { class: 'trunc' }, title, sub ? h('span', { class: 'sub' }, '  ' + sub) : null), ibtn('close', 'Close (Esc)', () => closeModal())),
      h('div', { class: 'modal-body' + (flush ? ' flush' : '') }, bodyEl),
      foot ? h('div', { class: 'modal-foot' }, foot) : null));
  back._onClose = onClose;
  $('#modal-root').append(back);
  setTimeout(() => back.querySelector('[autofocus], .modal-body input, .modal-body textarea, .modal-foot .primary')?.focus(), 0);
}
function closeModal() {
  const b = $('.modal-back');
  if (!b) return;
  if (b._onClose && b._onClose() === false) return;
  b.remove();
}

/** A small text-input dialog. Resolves to the value, or null when cancelled. */
function ask(title, { label = '', value = '', ok = 'OK', note = '', mono = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const inp = h('input', { class: 'input' + (mono ? ' mono' : ''), id: 'ask-input', value, autofocus: true, spellcheck: 'false' });
    const submit = () => {
      const v = inp.value.trim();
      if (!v) return inp.focus();
      finish(v);
      const b = $('.modal-back');
      if (b) b._onClose = null;
      closeModal();
    };
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    openModal(title, h('div', {}, note ? h('p', {}, note) : null, h('div', { class: 'field', style: { marginBottom: 0 } }, label ? h('label', { for: 'ask-input' }, label) : null, inp)), {
      size: 'sm',
      foot: [h('button', { class: 'btn', onclick: () => closeModal() }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, ok)],
      onClose: () => finish(null),
    });
    setTimeout(() => {
      inp.focus();
      inp.select();
    }, 0);
  });
}

/** Confirmation dialog. Resolves true/false. */
function confirmDialog(title, message, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const yes = () => {
      finish(true);
      const b = $('.modal-back');
      if (b) b._onClose = null;
      closeModal();
    };
    openModal(title, h('p', { style: { margin: 0 } }, message), {
      size: 'sm',
      foot: [h('button', { class: 'btn', onclick: () => closeModal() }, 'Cancel'), h('button', { class: 'btn primary' + (danger ? ' danger-fill' : ''), style: danger ? { background: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff' } : null, onclick: yes }, ok)],
      onClose: () => finish(false),
    });
  });
}

function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.split('/');
    let node = root;
    for (const p of parts.slice(0, -1)) {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [] });
      node = node.dirs.get(p);
    }
    node.files.push(f);
  }
  return root;
}

async function openEditor(wid, file, line) {
  const ws = wsById(wid);
  let files = [];
  try {
    files = await api('GET', `/api/workspaces/${wid}/files`);
  } catch (e) {
    return toast(e.message, true);
  }
  let current = null;
  let dirty = false;
  const tree = buildTree(files);
  const collapsed = new Set();
  if (files.length > 120) {
    const walk = (node, prefix, depth) => {
      for (const [n, child] of node.dirs) {
        if (depth >= 1) collapsed.add(prefix + n);
        walk(child, prefix + n + '/', depth + 1);
      }
    };
    walk(tree, '', 0);
  }
  const openAncestors = (f) => {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) collapsed.delete(parts.slice(0, i).join('/'));
  };

  const ta = h('textarea', { class: 'code-area', spellcheck: 'false', 'aria-label': 'File contents', wrap: 'off' });
  const gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
  const fileName = h('span', { class: 'trunc' }, '');
  const dirtyDot = h('span', { class: 'dirty', hidden: true, title: 'Unsaved changes' });
  const codeHead = h('div', { class: 'code-head' }, I('file'), fileName, dirtyDot);
  const codeBody = h('div', { class: 'code-body' }, gutter, ta);
  const emptyPane = h('div', { class: 'code-empty' }, 'Pick a file');
  const pane = h('div', { class: 'code-pane' }, codeHead, emptyPane);
  let lines = 0;
  const updateGutter = () => {
    const n = ta.value.split('\n').length;
    if (n !== lines) {
      lines = n;
      gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n') + '\n\n';
    }
    gutter.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('scroll', () => (gutter.scrollTop = ta.scrollTop));
  const setDirty = (v) => {
    dirty = v;
    dirtyDot.hidden = !v;
  };
  const save = guard(async () => {
    if (!current) return;
    await api('PUT', `/api/workspaces/${wid}/file`, { path: current, content: ta.value });
    setDirty(false);
    toast(`Saved ${current}`);
  });
  ta.addEventListener('input', () => {
    setDirty(true);
    updateGutter();
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      setDirty(true);
    }
  });
  const filter = h('input', { class: 'input', placeholder: 'Filter files', 'aria-label': 'Filter files', spellcheck: 'false' });
  const list = h('div', { role: 'tree' });
  const fileRow = (f, depth, label) => h('button', { class: 'tree-row' + (f === current ? ' on' : ''), role: 'treeitem', style: { paddingLeft: 6 + depth * 12 + 'px' }, title: f, onclick: () => load(f) }, h('span', { class: 'tw' }), I('file'), h('span', { class: 'nm' }, label));
  const drawList = () => {
    const q = filter.value.toLowerCase().trim();
    const rows = [];
    if (q) {
      for (const f of files.filter((x) => x.toLowerCase().includes(q)).slice(0, 400)) rows.push(fileRow(f, 0, f));
    } else {
      const walk = (node, prefix, depth) => {
        for (const [n, child] of [...node.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
          const key = prefix + n;
          const closed = collapsed.has(key);
          rows.push(h('button', { class: 'tree-row' + (closed ? ' closed' : ''), role: 'treeitem', 'aria-expanded': closed ? 'false' : 'true', style: { paddingLeft: 6 + depth * 12 + 'px' }, onclick: () => {
            if (collapsed.has(key)) collapsed.delete(key);
            else collapsed.add(key);
            drawList();
          } }, h('span', { class: 'tw', html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS.chevron}</svg>` }), I('folder'), h('span', { class: 'nm' }, n)));
          if (!closed) walk(child, key + '/', depth + 1);
        }
        for (const f of node.files.sort()) rows.push(fileRow(f, depth, f.split('/').pop()));
      };
      walk(tree, '', 0);
    }
    list.replaceChildren(...rows);
  };
  filter.addEventListener('input', drawList);
  const load = guard(async (f, ln) => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const r = await api('GET', `/api/workspaces/${wid}/file?path=${encodeURIComponent(f)}`);
    current = f;
    ta.value = r.content;
    lines = 0;
    setDirty(false);
    fileName.textContent = f;
    if (emptyPane.isConnected) emptyPane.replaceWith(codeBody);
    openAncestors(f);
    drawList();
    updateGutter();
    if (ln) {
      const all = r.content.split('\n');
      const pos = all.slice(0, ln - 1).join('\n').length + (ln > 1 ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(pos, pos + (all[ln - 1] || '').length);
      ta.scrollTop = Math.max(0, (ln - 6) * 19);
      gutter.scrollTop = ta.scrollTop;
    }
  });
  const banner = ws.kind === 'library' ? h('div', { class: 'banner' },
    h('span', { class: 'grow' }, 'This is the Library, the base checkout. To explore without touching it, copy the frame first.'),
    S.sel?.type === 'frame' ? h('button', { class: 'btn sm', onclick: guard(async () => {
      const f = frameById(S.sel.id);
      closeModal();
      if (f) await copyFrame(f);
    }) }, 'Copy frame instead') : null) : null;
  const bodyEl = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } }, banner,
    h('div', { class: 'editor' }, h('div', { class: 'tree' }, filter, list), pane));
  openModal('Code', bodyEl, {
    size: 'wide',
    flush: true,
    sub: ws.name,
    foot: [h('span', { class: 'muted left' }, 'Saving updates the frames through the app’s own hot reload.'), h('button', { class: 'btn', onclick: () => openChanges(wid) }, 'Changes'), h('button', { class: 'btn primary', onclick: save }, 'Save', h('kbd', { style: { background: 'transparent', color: 'inherit', borderColor: 'currentColor', opacity: 0.6 } }, '⌘S'))],
    onClose: () => !dirty || confirm('Discard unsaved changes?'),
  });
  drawList();
  if (file) load(file, line);
}

/** Parse a unified git diff into files with numbered lines. */
function parseDiff(text) {
  const files = [];
  let cur = null;
  let o = 0;
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git')) {
      cur = { path: line.replace(/^diff --git a\/.* b\//, ''), lines: [], add: 0, del: 0, status: 'M', binary: false };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (cur.binary) continue;
    if (line.startsWith('new file')) cur.status = 'A';
    else if (line.startsWith('deleted file')) cur.status = 'D';
    else if (line === 'GIT binary patch' || line.startsWith('Binary files')) {
      cur.binary = true;
      cur.lines.push({ t: 'meta', s: 'Binary file changed' });
    } else if (/^(index |--- |\+\+\+ |similarity|rename |old mode|new mode)/.test(line)) continue;
    else {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (m) {
        o = +m[1];
        n = +m[2];
        cur.lines.push({ t: 'hunk', s: line });
      } else if (line.startsWith('+')) {
        cur.lines.push({ t: 'add', b: n++, s: line.slice(1) });
        cur.add++;
      } else if (line.startsWith('-')) {
        cur.lines.push({ t: 'del', a: o++, s: line.slice(1) });
        cur.del++;
      } else if (line.startsWith(' ')) cur.lines.push({ t: 'ctx', a: o++, b: n++, s: line.slice(1) });
      else if (line.startsWith('\\')) cur.lines.push({ t: 'meta', s: line });
    }
  }
  return files;
}

async function openChanges(wid) {
  const ws = wsById(wid);
  let changes = [];
  let diffText = '';
  try {
    changes = await api('GET', `/api/workspaces/${wid}/changes`);
    diffText = await (await fetch(`/api/workspaces/${wid}/export?format=diff`)).text();
  } catch (e) {
    return toast(e.message, true);
  }
  const files = parseDiff(diffText);
  const adds = files.reduce((s, f) => s + f.add, 0);
  const dels = files.reduce((s, f) => s + f.del, 0);
  const STATUS = { A: 'Added', D: 'Deleted', M: 'Modified' };
  const bodyEl = h('div', {},
    h('div', { class: 'diff-sum' },
      h('span', {}, `${changes.length} file${changes.length === 1 ? '' : 's'} changed since ${ws.baseCommit?.slice(0, 7) || 'the start'}`),
      changes.length ? h('span', { class: 'num' }, h('span', { class: 'plus' }, `+${adds}`), ' ', h('span', { class: 'minus' }, `−${dels}`)) : null,
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted' }, 'Mock files and .env never leave Easel.')),
    !changes.length ? h('div', { class: 'empty', style: { padding: '24px 0', textAlign: 'center' } }, 'No changes in this workspace yet.') : null,
    files.map((f) => h('div', { class: 'df' },
      h('div', { class: 'df-h' }, h('span', { class: 'st', title: STATUS[f.status] }, f.status), h('span', { class: 'p', title: f.path }, f.path), h('span', { class: 'num' }, h('span', { class: 'plus' }, `+${f.add}`), ' ', h('span', { class: 'minus' }, `−${f.del}`))),
      h('div', { class: 'df-lines' }, f.lines.map((l) => (l.t === 'hunk' || l.t === 'meta'
        ? h('div', { class: 'dl ' + l.t }, h('span', { class: 'n' }), h('span', { class: 'n' }), h('span', { class: 's' }), h('span', {}, l.s))
        : h('div', { class: 'dl ' + l.t }, h('span', { class: 'n num' }, l.a ?? ''), h('span', { class: 'n num' }, l.b ?? ''), h('span', { class: 's' }, l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''), h('span', {}, l.s))))))),
    changes.length ? h('div', { class: 'take-home' }, 'Take it home: ', h('code', {}, 'git apply change.diff'), ' · ', h('code', {}, 'git am change.patch'), ' · ', h('code', {}, 'git fetch change.bundle refs/heads/easel/*:refs/heads/easel/*')) : null);
  const dl = (fmt, label, primary = false) => h('a', { class: 'btn' + (primary ? ' primary' : ''), href: `/api/workspaces/${wid}/export?format=${fmt}`, download: '' }, label);
  openModal('Changes', bodyEl, {
    size: changes.length ? 'wide fit' : '',
    sub: ws.name,
    foot: changes.length ? [
      h('button', { class: 'btn quiet danger left', onclick: guard(async () => {
        if (!(await confirmDialog('Revert all changes?', `Every change in “${ws.name}” will be thrown away.`, { ok: 'Revert all', danger: true }))) return;
        await api('POST', `/api/workspaces/${wid}/revert`);
        reloadFramesOf(wid);
        toast('Changes reverted');
      }) }, 'Revert all…'),
      dl('diff', 'Download .diff'), dl('bundle', 'Download .bundle'), dl('patch', 'Download .patch', true)] : [h('button', { class: 'btn', onclick: () => closeModal() }, 'Close')],
  });
}

function openMockEditor(wid, fileName) {
  const tpl = {
    rules: [{
      id: 'users',
      note: 'Answer GET calls to this URL. "url" can use * wildcards; use "path" for the app\'s own API (e.g. "/api/users/:id").',
      match: { method: 'GET', url: 'https://api.example.com/users*' },
      states: {
        default: { status: 200, json: [{ id: 1, name: 'Ada Lovelace' }, { id: 2, name: 'Grace Hopper' }] },
        long: { status: 200, json: [{ id: 1, name: 'Maximiliana Wolfeschlegelsteinhausenberger-Dorff' }] },
        error: { status: 503, json: { error: 'Service unavailable' } },
      },
    }],
  };
  const nameIn = h('input', { class: 'input mono', id: 'mock-name', value: fileName || 'my-mocks.json', spellcheck: 'false' });
  const ta = h('textarea', { class: 'textarea', id: 'mock-json', style: { height: '52vh', whiteSpace: 'pre' }, spellcheck: 'false', wrap: 'off' });
  ta.value = JSON.stringify(tpl, null, 2);
  if (fileName) api('GET', `/api/workspaces/${wid}/mocks/file?name=${encodeURIComponent(fileName)}`).then((r) => (ta.value = r.content)).catch(() => {});
  const save = guard(async () => {
    await api('PUT', `/api/workspaces/${wid}/mocks/file`, { name: nameIn.value.trim(), content: ta.value });
    delete S.mocks[wid];
    closeModal();
    toast('Mocks saved. Frames reload.');
    renderSidebar();
  });
  openModal(fileName ? 'Edit mock rules' : 'New mock rules', h('div', {},
    h('div', { class: 'field' }, h('label', { for: 'mock-name' }, 'File in easel.mocks/'), nameIn),
    h('div', { class: 'field' }, h('label', { for: 'mock-json' }, 'Rules (JSON)'), ta),
    h('p', { class: 'sec-note', style: { margin: 0 } }, 'States you add here, like “long”, appear in each frame’s Data state menu. Empty, error, slow, loading and offline work for every rule automatically.')),
  { size: 'wide fit', foot: [h('button', { class: 'btn', onclick: () => closeModal() }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save rules')] });
}

window.addEventListener('resize', () => applyView());
boot().catch((e) => toast(e.message, true));
