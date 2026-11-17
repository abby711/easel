// Python stacks: Django, Flask, FastAPI, Streamlit, plain scripts.
import path from 'node:path';
import { readText, lineOf, which, exists } from '../util.js';
import { grepRoutes } from '../routes.js';

/** The Python the app asks for: .python-version, runtime.txt, pyproject requires-python, Pipfile. */
export function pythonWanted(ctx) {
  const pv = ctx.read('.python-version').trim().split('\n')[0];
  if (pv) return pv.replace(/^python-?/, '');
  const rt = ctx.read('runtime.txt').match(/python-(\d+\.\d+)/);
  if (rt) return rt[1];
  const rp = ctx.read('pyproject.toml').match(/requires-python\s*=\s*["']\s*>=?\s*(\d+\.\d+)/);
  if (rp) return rp[1];
  const pf = ctx.read('Pipfile').match(/python_version\s*=\s*["'](\d+\.\d+)/);
  return pf ? pf[1] : null;
}

function pyInstall(ctx, extra = []) {
  const steps = [];
  const sysPy = which('python3') || which('python') || 'python3';
  if (ctx.venv && !exists(ctx.python)) steps.push({ label: 'create virtualenv', cmd: sysPy, args: ['-m', 'venv', ctx.venv] });
  const pip = (args, label) => ({ label, cmd: ctx.python, args: ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...args] });
  const reqs = ['requirements.txt', 'requirements/dev.txt', 'requirements/local.txt', 'requirements/base.txt', 'requirements-dev.txt'].filter((f) => ctx.has(f));
  // Fallback when the app needs a newer (or specific) Python than this machine has:
  // fetch one with uv (installed into Easel's tool folder), rebuild the virtualenv on it, retry.
  const withUv = (pipArgs) => {
    if (!ctx.venv) return null;
    const ver = (pythonWanted(ctx) || '3.12').match(/\d+\.\d+/)?.[0] || '3.12';
    const tools = path.join(path.dirname(ctx.venv), '..', 'tools', 'uv');
    const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
    const uv = path.join(tools, 'bin', 'uv');
    return {
      label: `Python ${ver} via uv, then pip install`,
      cmd: 'sh',
      args: ['-c', [
        `[ -x ${q(uv)} ] || { ${q(sysPy)} -m venv ${q(tools)} && ${q(path.join(tools, 'bin', 'pip'))} install -q uv; } || exit 1`,
        `${q(uv)} python install ${ver} || exit 1`,
        `rm -rf ${q(ctx.venv)} && ${q(uv)} venv --seed --python ${ver} ${q(ctx.venv)} || exit 1`,
        `${q(path.join(ctx.venv, 'bin', 'python'))} -m pip install --disable-pip-version-check -q ${pipArgs.map(q).join(' ')}`,
      ].join('; ')],
    };
  };
  if (reqs.length) steps.push({ ...pip(['-r', reqs[0]], `pip install -r ${reqs[0]}`), fallbacks: [withUv(['-r', reqs[0]])].filter(Boolean) });
  else if (ctx.has('pyproject.toml') || ctx.has('setup.py')) steps.push({ ...pip(['-e', '.'], 'pip install -e .'), optional: true, fallbacks: [withUv(['-e', '.'])].filter(Boolean) });
  for (const pkgName of extra) {
    if (!ctx.pyDeps.includes(pkgName.toLowerCase())) steps.push(pip([pkgName], `pip install ${pkgName}`));
  }
  return steps;
}

const pyEnv = (port) => ({ PORT: String(port), PYTHONUNBUFFERED: '1', FLASK_DEBUG: '1', DEBUG: 'True' });

/** Turn a Django route string into Easel's :param form. */
function djangoPath(p) {
  let s = p.replace(/^\^/, '').replace(/\$$/, '');
  s = s.replace(/\(\?P<(\w+)>[^)]*\)/g, ':$1'); // regex named groups (before converters!)
  s = s.replace(/<(?:\w+:)?(\w+)>/g, ':$1'); // path converters
  s = s.replace(/\\/g, '');
  return s;
}

/** Resolve Django's URLconf tree starting at ROOT_URLCONF. */
export function djangoRoutes(dir) {
  const settingsFile = (() => {
    const manage = readText(path.join(dir, 'manage.py'), '');
    const m = manage.match(/DJANGO_SETTINGS_MODULE['"]\s*,\s*['"]([\w.]+)['"]/);
    if (m) return m[1].replace(/\./g, '/') + '.py';
    return null;
  })();
  let rootConf = null;
  const candidates = [settingsFile, settingsFile && settingsFile.replace(/\.py$/, '/base.py'), settingsFile && settingsFile.replace(/\.py$/, '/__init__.py')].filter(Boolean);
  for (const f of candidates) {
    const t = readText(path.join(dir, f), '');
    const m = t.match(/ROOT_URLCONF\s*=\s*['"]([\w.]+)['"]/);
    if (m) {
      rootConf = m[1];
      break;
    }
  }
  const out = [];
  const visited = new Set();
  const modFile = (mod) => {
    const base = mod.replace(/\./g, '/');
    for (const f of [base + '.py', base + '/__init__.py', 'src/' + base + '.py']) if (exists(path.join(dir, f))) return f;
    return null;
  };
  const visit = (mod, prefix, depth) => {
    if (depth > 6 || visited.has(mod + '|' + prefix)) return;
    visited.add(mod + '|' + prefix);
    const f = modFile(mod);
    if (!f) return;
    const text = readText(path.join(dir, f), '');
    const re = /\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*([^\n]*)/g;
    for (const m of text.matchAll(re)) {
      const route = prefix + djangoPath(m[1]);
      const rest = m[2];
      const inc = rest.match(/include\(\s*\(?\s*['"]([\w.]+)['"]/);
      if (inc) visit(inc[1], route, depth + 1);
      else if (/admin\.site\.urls/.test(rest)) out.push({ path: '/' + route, file: f, line: lineOf(text, m.index), source: 'code', note: 'Django admin' });
      else out.push({ path: '/' + route, file: f, line: lineOf(text, m.index), source: 'code' });
    }
  };
  if (rootConf) visit(rootConf, '', 0);
  else {
    // No settings found: scan every urls.py
    return grepRoutes(dir, { exts: ['.py'], patterns: [/\bpath\(\s*r?['"]([^'"]*)['"]/g] }).map((r) => ({ ...r, path: djangoPath(r.path) }));
  }
  if (!out.some((r) => r.path === '/')) out.unshift({ path: '/', source: 'default' });
  return out;
}

/**
 * Flask routes with blueprint prefixes. Handles Blueprint(..., url_prefix=) and
 * register_blueprint(x, url_prefix=), where x is imported from the blueprint's package.
 * Skips POST/PUT/DELETE-only views (nothing to look at in a frame).
 */
export function flaskRoutes(ctx) {
  const py = ctx.files().filter((f) => f.endsWith('.py') && !/(^|\/)(tests?|migrations)\//.test(f)).slice(0, 1500);
  const texts = new Map(py.map((f) => [f, readText(path.join(ctx.dir, f), '')]));
  const modDir = (mod) => mod.replace(/^\./, '').replace(/\./g, '/');
  // 1. prefixes declared on the Blueprint itself, per file
  const filePrefix = new Map();
  // 2. prefixes given at registration, per package directory
  const dirPrefix = [];
  for (const [f, t] of texts) {
    for (const m of t.matchAll(/^(\w+)\s*=\s*Blueprint\(([^)]*)\)/gm)) {
      const pre = m[2].match(/url_prefix\s*=\s*['"]([^'"]*)['"]/);
      if (pre) filePrefix.set(f + '#' + m[1], pre[1]);
    }
    for (const m of t.matchAll(/register_blueprint\(\s*([\w.]+)[^)]*?url_prefix\s*=\s*['"]([^'"]*)['"]/g)) {
      const name = m[1].split('.')[0];
      const imp = t.match(new RegExp(`from\\s+([\\w.]+)\\s+import\\s+[^\\n]*\\b(\\w+\\s+as\\s+)?${name}\\b`));
      if (imp) dirPrefix.push({ dir: modDir(imp[1]), prefix: m[2] });
    }
  }
  const out = [];
  for (const [f, t] of texts) {
    for (const m of t.matchAll(/@(\w+)\.(route|get)\(\s*['"]([^'"]+)['"]([^)]*)\)/g)) {
      const [, bp, kind, p, rest] = m;
      if (kind === 'route') {
        const methods = rest.match(/methods\s*=\s*[[(]([^\])]*)[\])]/);
        if (methods && !/['"]GET['"]/i.test(methods[1])) continue;
      }
      let prefix = filePrefix.get(f + '#' + bp) || '';
      if (!prefix) {
        // the blueprint is imported: "from .auth import bp" / "from app.auth import bp as x"
        const imp = t.match(new RegExp(`from\\s+(\\.*[\\w.]*)\\s+import\\s+[^\\n]*?\\b(\\w+)\\s+as\\s+${bp}\\b|from\\s+(\\.*[\\w.]*)\\s+import\\s+[^\\n]*?\\b${bp}\\b`));
        const mod = imp && (imp[1] || imp[3]);
        if (mod) {
          const name = imp[2] || bp;
          const dots = (mod.match(/^\.+/) || [''])[0].length;
          let base = dots ? path.dirname(f) : '';
          for (let k = 1; k < dots; k++) base = path.dirname(base);
          const rel = path.posix.join(base === '.' ? '' : base, modDir(mod));
          for (const cand of [rel + '.py', rel + '/__init__.py']) if (filePrefix.has(cand + '#' + name)) prefix = filePrefix.get(cand + '#' + name);
        }
      }
      if (!prefix) {
        const d = dirPrefix.filter((x) => f === x.dir + '.py' || f.startsWith(x.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0];
        if (d) prefix = d.prefix;
      }
      const full = (prefix.replace(/\/$/, '') + (p.startsWith('/') ? p : '/' + p)).replace(/<(?:\w+:)?(\w+)>/g, ':$1') || '/';
      out.push({ path: full, file: f, line: lineOf(t, m.index), source: 'code' });
    }
  }
  return out;
}

/** Find the Flask app: module path and attribute or factory. */
export function findFlaskApp(ctx) {
  const pyFiles = ctx.files().filter((f) => f.endsWith('.py')).slice(0, 600);
  let best = null;
  for (const f of pyFiles) {
    const t = readText(path.join(ctx.dir, f), '');
    let m = t.match(/^(\w+)\s*=\s*Flask\(/m);
    if (m) {
      best = { file: f, target: m[1] };
      if (/^(app|wsgi|main|run|server|application)\.py$/.test(path.basename(f))) break;
      continue;
    }
    m = t.match(/^def\s+(create_app|make_app|build_app)\s*\(/m);
    if (m && /Flask\(/.test(t) && !best) best = { file: f, target: m[1] + '()' };
  }
  if (!best) return null;
  const mod = best.file.replace(/\.py$/, '').replace(/\/__init__$/, '').replace(/\//g, '.');
  return { module: mod, spec: `${mod}:${best.target}`, file: best.file };
}

function findAsgiApp(ctx, ctor = 'FastAPI') {
  for (const f of ctx.files().filter((x) => x.endsWith('.py')).slice(0, 600)) {
    const t = readText(path.join(ctx.dir, f), '');
    const m = t.match(new RegExp(`^(\\w+)\\s*=\\s*${ctor}\\(`, 'm'));
    if (m) return `${f.replace(/\.py$/, '').replace(/\//g, '.')}:${m[1]}`;
  }
  return null;
}

export const pythonAdapters = [
  {
    id: 'django',
    label: 'Django',
    lang: 'Python',
    detect: (c) => (c.has('manage.py') && /django/i.test(c.read('manage.py') + c.pyDeps) ? 92 : 0),
    install: (c) => pyInstall(c, ['django']),
    prepare: (c) => [{ label: 'migrate (sqlite)', cmd: c.python, args: ['manage.py', 'migrate', '--noinput'], optional: true }],
    start: (c, { port }) => ({ cmd: c.python, args: ['manage.py', 'runserver', `127.0.0.1:${port}`], env: pyEnv(port) }),
    routes: (c) => djangoRoutes(c.dir),
  },
  {
    id: 'flask',
    label: 'Flask',
    lang: 'Python',
    detect: (c) => (c.pyDeps.includes('flask') || c.grep(/=\s*Flask\(/, ['.py'], 200) ? 82 : 0),
    install: (c) => pyInstall(c, ['flask']),
    // Create the database the way the app documents it: Flask-Migrate, or an init-db style CLI command.
    prepare: (c) => {
      const app = findFlaskApp(c);
      const base = [c.python, ['-m', 'flask', ...(app ? ['--app', app.spec] : [])]];
      const steps = [];
      if ((c.has('migrations/env.py') || c.has('migrations/alembic.ini')) && /flask[-_]migrate/.test(c.pyDeps)) steps.push({ label: 'flask db upgrade', cmd: base[0], args: [...base[1], 'db', 'upgrade'], optional: true });
      const cmd = c.grep(/@(?:click|\w+\.cli)\.command\(\s*['"]((?:init|create|setup)[-_]?db|seed)['"]/, ['.py'], 400);
      if (cmd) steps.push({ label: `flask ${cmd.match[1]}`, cmd: base[0], args: [...base[1], cmd.match[1]], optional: true });
      return steps;
    },
    start: (c, { port }) => {
      const app = findFlaskApp(c);
      const args = ['-m', 'flask'];
      if (app) args.push('--app', app.spec);
      args.push('run', '--host', '127.0.0.1', '--port', String(port), '--debug');
      return { cmd: c.python, args, env: pyEnv(port) };
    },
    routes: (c) => {
      const r = flaskRoutes(c);
      return r.length ? r : [{ path: '/', source: 'default' }];
    },
  },
  {
    id: 'fastapi',
    label: 'FastAPI',
    lang: 'Python',
    detect: (c) => (c.pyDeps.includes('fastapi') || c.grep(/=\s*FastAPI\(/, ['.py'], 200) ? 80 : 0),
    install: (c) => pyInstall(c, ['fastapi', 'uvicorn']),
    start: (c, { port }) => ({ cmd: c.python, args: ['-m', 'uvicorn', findAsgiApp(c) || 'main:app', '--host', '127.0.0.1', '--port', String(port), '--reload'], env: pyEnv(port) }),
    routes: (c) => [
      ...grepRoutes(c.dir, { exts: ['.py'], patterns: [/@\w+\.get\(\s*['"]([^'"]+)['"]/g] }).map((x) => ({ ...x, path: x.path.replace(/\{(\w+)\}/g, ':$1') })),
      { path: '/docs', source: 'framework', note: 'OpenAPI docs' },
    ],
  },
  {
    id: 'streamlit',
    label: 'Streamlit',
    lang: 'Python',
    detect: (c) => (c.pyDeps.includes('streamlit') ? 78 : 0),
    install: (c) => pyInstall(c, ['streamlit']),
    start: (c, { port }) => {
      const entry = c.find(/^(streamlit_app|app|main|Home)\.py$/) || c.find(/\.py$/);
      return { cmd: c.python, args: ['-m', 'streamlit', 'run', entry, '--server.port', String(port), '--server.address', '127.0.0.1', '--server.headless', 'true', '--server.enableCORS', 'false', '--server.enableXsrfProtection', 'false'], env: pyEnv(port) };
    },
    routes: () => [{ path: '/', source: 'default' }],
  },
  {
    id: 'python-script',
    label: 'Python app',
    lang: 'Python',
    detect: (c) => (['app.py', 'main.py', 'server.py', 'run.py', 'wsgi.py'].some(c.has) ? 25 : 0),
    install: (c) => pyInstall(c),
    start: (c, { port }) => ({ cmd: c.python, args: [['app.py', 'main.py', 'server.py', 'run.py', 'wsgi.py'].find(c.has)], env: pyEnv(port) }),
    routes: () => [{ path: '/', source: 'default' }],
  },
];
