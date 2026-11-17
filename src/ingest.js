// Getting code in: clone a git URL or copy a local folder (read-only to the source),
// make sure it's a git repo (so copies and patches work), and stub env files.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, gitSync, exists, IGNORED_DIRS } from './util.js';

/** "owner/repo" → GitHub URL; URLs and scp-style git remotes pass through. */
export function normalizeSource(src) {
  const s = String(src || '').trim();
  if (/^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/)/.test(s)) return { type: 'git', url: s };
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !exists(s)) return { type: 'git', url: `https://github.com/${s}.git` };
  return { type: 'local', path: path.resolve(s.replace(/^~(?=$|\/)/, process.env.HOME || '~')) };
}

export function repoName(source) {
  if (source.type === 'git') return source.url.replace(/\/+$/, '').split(/[/:]/).pop().replace(/\.git$/, '');
  return path.basename(source.path);
}

const COPY_SKIP = new Set([...IGNORED_DIRS].filter((d) => d !== '.git' && d !== 'bin' && d !== 'storage' && d !== 'log' && d !== 'tmp'));
const SECRET_FILE = /^(\.env(\..+)?|id_rsa.*|.*\.pem|credentials\.json)$/;
const ENV_EXAMPLE = /^\.env\.(example|sample|template|dist|defaults)$|^example\.env$|\.env\.local\.example$/;

/** Copy a local folder, skipping dependency/build dirs and real secrets (examples are kept). */
export async function copyFolder(src, dest) {
  let skippedSecrets = [];
  await fsp.cp(src, dest, {
    recursive: true,
    dereference: false,
    filter: (p) => {
      const rel = path.relative(src, p);
      if (!rel) return true;
      const base = path.basename(p);
      const parts = rel.split(path.sep);
      if (parts.some((x) => COPY_SKIP.has(x))) return false;
      if (SECRET_FILE.test(base) && !ENV_EXAMPLE.test(base)) {
        skippedSecrets.push(rel);
        return false;
      }
      return true;
    },
  });
  return { skippedSecrets };
}

export async function ensureGit(dir) {
  if (!exists(path.join(dir, '.git'))) {
    await git(['init', '-q'], dir);
    await git(['add', '-A'], dir);
    await git(['-c', 'user.name=Easel', '-c', 'user.email=easel@localhost', 'commit', '-q', '-m', 'Easel baseline', '--allow-empty'], dir);
  }
  gitSync(['config', 'user.name', 'Easel'], dir);
  gitSync(['config', 'user.email', 'easel@localhost'], dir);
  // Keep Easel's own files out of `git status` in every checkout of this repo.
  const exclude = path.join(dir, '.git', 'info', 'exclude');
  try {
    const cur = fs.readFileSync(exclude, 'utf8');
    if (!cur.includes('# easel')) fs.appendFileSync(exclude, '\n# easel\n.easel-installed\n.easel-install-state.json\n*.easel-hidden\n.easel-venv/\n');
  } catch {
    /* worktree or unusual layout */
  }
}

/** Clone or copy into dest. Emits progress lines through onLine. */
export async function fetchSource(source, dest, { branch, onLine } = {}) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (source.type === 'git') {
    const args = ['clone', '--depth', '200', '--single-branch'];
    if (branch) args.push('--branch', branch);
    args.push(source.url, dest);
    const r = await git(args, path.dirname(dest), { onLine, env: { GIT_TERMINAL_PROMPT: '0' } });
    if (r.code !== 0) throw new Error('git clone failed: ' + r.out.trim().split('\n').slice(-3).join(' '));
    return { skippedSecrets: [], submodules: await ensureSubmodules(dest, { onLine }) };
  }
  if (!exists(source.path)) throw new Error('Folder not found: ' + source.path);
  const res = await copyFolder(source.path, dest);
  return res;
}

/**
 * Fetch git submodules (themes, shared specs, design tokens often live in one).
 * SSH remotes are rewritten to HTTPS so public submodules work without keys. Never fatal.
 */
export async function ensureSubmodules(dir, { onLine } = {}) {
  if (!exists(path.join(dir, '.gitmodules'))) return null;
  const r = await git(
    ['-c', 'url.https://github.com/.insteadOf=git@github.com:', '-c', 'url.https://gitlab.com/.insteadOf=git@gitlab.com:', '-c', 'protocol.file.allow=always',
      'submodule', 'update', '--init', '--recursive', '--depth', '1'],
    dir,
    { onLine, env: { GIT_TERMINAL_PROMPT: '0' }, timeout: 5 * 60 * 1000 },
  );
  return { ok: r.code === 0, out: r.code === 0 ? '' : r.out.trim().split('\n').slice(-3).join(' ') };
}

// ---------- env bootstrap ----------

function placeholderFor(key, example) {
  if (example) return example;
  const k = key.toUpperCase();
  const rand = crypto.randomBytes(8).toString('hex');
  if (/DATABASE_URL|DB_URL/.test(k)) return 'postgresql://easel:easel@127.0.0.1:5432/easel_placeholder';
  if (/REDIS_URL/.test(k)) return 'redis://127.0.0.1:6379';
  if (/(_URL|_URI|_ENDPOINT|_HOST|BASE_PATH|ORIGIN)$/.test(k)) return 'http://127.0.0.1:9/easel-placeholder';
  if (/PUBLISHABLE/.test(k)) return 'pk_test_easelplaceholder' + rand;
  if (/STRIPE.*SECRET|SECRET.*STRIPE/.test(k)) return 'sk_test_easelplaceholder' + rand;
  if (/(KEY|SECRET|TOKEN|PASSWORD|PASS|SALT|DSN|CREDENTIAL)/.test(k)) return 'easel_placeholder_' + rand;
  if (/(ENABLED?|DEBUG|_ON|FLAG|USE_)/.test(k)) return 'false';
  if (/EMAIL/.test(k)) return 'dev@example.com';
  if (/PORT$/.test(k)) return '';
  if (/(REGION)/.test(k)) return 'us-east-1';
  return 'easel-placeholder';
}

/**
 * If the app has .env.example (or similar) but no .env, write one with
 * placeholder values so it can boot. Real services won't work, which is fine:
 * the mock layer answers requests. Returns the keys that were stubbed.
 */
export function bootstrapEnv(appDir) {
  const files = fs.readdirSync(appDir);
  const example = files.find((f) => ENV_EXAMPLE.test(f));
  if (!example) return { created: null, keys: [] };
  const target = /local/.test(example) ? '.env.local' : '.env';
  if (exists(path.join(appDir, target)) || exists(path.join(appDir, '.env'))) return { created: null, keys: [] };
  const lines = fs.readFileSync(path.join(appDir, example), 'utf8').split(/\r?\n/);
  const stubbed = [];
  const out = lines.map((line) => {
    const m = line.match(/^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return line;
    let val = m[3].trim().replace(/^['"]|['"]$/g, '');
    const looksFake = !val || /^(your|xxx|changeme|<|replace|todo|\.\.\.)/i.test(val);
    if (looksFake) {
      val = placeholderFor(m[2], '');
      stubbed.push(m[2]);
    }
    return `${m[1] || ''}${m[2]}=${/\s/.test(val) ? JSON.stringify(val) : val}`;
  });
  fs.writeFileSync(path.join(appDir, target), `# Written by Easel from ${example}. Placeholder values; real services are mocked.\n` + out.join('\n'));
  return { created: target, from: example, keys: stubbed };
}

/** git status relative to upstream: {branch, head, behind, ahead, remote} */
export async function syncStatus(repoDir) {
  const head = gitSync(['rev-parse', '--short', 'HEAD'], repoDir).stdout.trim();
  const branch = gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir).stdout.trim();
  const remote = gitSync(['remote', 'get-url', 'origin'], repoDir).stdout.trim() || null;
  if (!remote) return { branch, head, remote, behind: 0, ahead: 0, upToDate: true };
  const f = await git(['fetch', '-q', 'origin', branch], repoDir, { timeout: 60000, env: { GIT_TERMINAL_PROMPT: '0' } });
  const counts = gitSync(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`], repoDir).stdout.trim().split(/\s+/);
  const ahead = Number(counts[0] || 0);
  const behind = Number(counts[1] || 0);
  return { branch, head, remote, ahead, behind, upToDate: behind === 0, fetchError: f.code !== 0 ? f.out.trim().slice(-200) : null };
}

export async function pullLatest(repoDir) {
  const branch = gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir).stdout.trim();
  const r = await git(['pull', '--ff-only', '-q', 'origin', branch], repoDir, { timeout: 120000, env: { GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.code === 0, out: r.out.trim() };
}
