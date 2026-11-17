// The context object every adapter receives: cheap, cached views of one app folder.
import path from 'node:path';
import { readJSON, readText, exists, walk, which } from '../util.js';

export function makeCtx(dir, { venv = null, projectId = null } = {}) {
  const pkg = readJSON(path.join(dir, 'package.json'), null);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.peerDependencies || {}) };
  let fileCache = null;
  const ctx = {
    dir,
    projectId,
    pkg,
    deps,
    venv,
    dep: (name) => Object.prototype.hasOwnProperty.call(deps, name),
    has: (rel) => exists(path.join(dir, rel)),
    read: (rel) => readText(path.join(dir, rel), ''),
    json: (rel) => readJSON(path.join(dir, rel), null),
    files: () => (fileCache ||= walk(dir, { max: 15000 })),
    /** First file (relative) matching a regex. */
    find: (re) => ctx.files().find((f) => re.test(f)) || null,
    findAll: (re) => ctx.files().filter((f) => re.test(f)),
    /** Does any file with these extensions contain this pattern? */
    grep(re, exts, limit = 400) {
      const files = ctx.files().filter((f) => !exts || exts.includes(path.extname(f).toLowerCase())).slice(0, limit);
      for (const f of files) {
        const t = readText(path.join(dir, f), '');
        const m = t && t.match(re);
        if (m) return { file: f, match: m };
      }
      return null;
    },
    /** node_modules/.bin/<name>, looking upward too (workspaces hoist binaries to the repo root). */
    bin: (name) => {
      const file = process.platform === 'win32' ? name + '.cmd' : name;
      let d = dir;
      for (let n = 0; n < 6; n++) {
        const p = path.join(d, 'node_modules', '.bin', file);
        if (exists(p)) return p;
        const up = path.dirname(d);
        if (up === d) break;
        d = up;
      }
      return path.join(dir, 'node_modules', '.bin', file);
    },
    get pm() {
      if (exists(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
      if (exists(path.join(dir, 'yarn.lock'))) return 'yarn';
      if (exists(path.join(dir, 'bun.lockb')) || exists(path.join(dir, 'bun.lock'))) return 'bun';
      return 'npm';
    },
    get python() {
      if (venv) return path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      return which('python3') || which('python') || 'python3';
    },
    /** Lower-cased text of all Python dependency manifests. */
    get pyDeps() {
      const parts = ['requirements.txt', 'requirements-dev.txt', 'requirements/base.txt', 'requirements/dev.txt', 'requirements/local.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg']
        .map((f) => readText(path.join(dir, f), ''))
        .join('\n');
      return parts.toLowerCase();
    },
    get gemfile() {
      return readText(path.join(dir, 'Gemfile'), '');
    },
    get composer() {
      return readJSON(path.join(dir, 'composer.json'), null);
    },
  };
  return ctx;
}
