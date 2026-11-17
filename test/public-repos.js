// Run real, recently-maintained public repos through Easel and record what happens.
//   node test/public-repos.js --only angular        one repo (results merge into the report)
//   node test/public-repos.js --list                 show the repo list
//   node test/public-repos.js --report               rebuild test/public-repos-report.md from saved results
// Each run: add the repo → wait for setup → record detection, install/start, routes, page statuses → remove it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOS = [
  { name: 'angular', repo: 'gothinkster/angular-realworld-example-app', stack: 'Angular' },
  { name: 'sveltekit', repo: 'sveltejs/realworld', stack: 'SvelteKit' },
  { name: 'vue-realworld', repo: 'mutoe/vue3-realworld-example-app', stack: 'Vue 3 + Vite' },
  { name: 'vitesse', repo: 'antfu-collective/vitesse', stack: 'Vue 3 + Vite (file routes)' },
  { name: 'bulletproof-vite', repo: 'alan2207/bulletproof-react', subdir: 'apps/react-vite', stack: 'React + Vite (monorepo)' },
  { name: 'bulletproof-next', repo: 'alan2207/bulletproof-react', subdir: 'apps/nextjs-app', stack: 'Next.js (monorepo)' },
  { name: 'fastapi-frontend', repo: 'fastapi/full-stack-fastapi-template', subdir: 'frontend', stack: 'React + Vite + TanStack Router' },
  { name: 'next-saas', repo: 'leerob/next-saas-starter', stack: 'Next.js (Postgres + Stripe)' },
  { name: 'commerce', repo: 'vercel/commerce', stack: 'Next.js (Shopify)' },
  { name: 'nuxt-movies', repo: 'nuxt/movies', stack: 'Nuxt' },
  { name: 'astro-paper', repo: 'satnaing/astro-paper', stack: 'Astro' },
  { name: 'react-router', repo: 'remix-run/react-router-templates', stack: 'React Router 7' },
  { name: 'flask-tutorial', repo: 'pallets/flask', subdir: 'examples/tutorial', stack: 'Flask' },
  { name: 'microblog', repo: 'miguelgrinberg/microblog', stack: 'Flask (SQLAlchemy)' },
  { name: 'django-library', repo: 'mdn/django-locallibrary-tutorial', stack: 'Django' },
  { name: 'bakerydemo', repo: 'wagtail/bakerydemo', stack: 'Django + Wagtail' },
  { name: 'laravel', repo: 'laravel/laravel', stack: 'Laravel' },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = path.join(ROOT, 'test', 'public-repos-results.json');
const REPORT = path.join(ROOT, 'test', 'public-repos-report.md');
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);

function writeReport() {
  const res = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : {};
  const rows = REPOS.map((r) => {
    const x = res[r.name];
    if (!x) return `| ${r.name} | \`${r.repo}${r.subdir ? '/' + r.subdir : ''}\` | ${r.stack} | — | not run | | | |`;
    const pages = x.pages ? `${x.pages.ok}/${x.pages.total} ok${x.pages.redirect ? `, ${x.pages.redirect} redirect` : ''}${x.pages.bad ? `, ${x.pages.bad} error` : ''}` : '—';
    const verdict = x.verdict === 'pass' ? '✅ runs' : x.verdict === 'partial' ? '🟡 partly' : x.verdict === 'routes-only' ? '⚪ routes only' : '❌ ' + (x.reason || 'fails');
    return `| ${r.name} | \`${r.repo}${r.subdir ? '/' + r.subdir : ''}\` | ${x.detected || '?'} | ${x.secs}s | ${verdict} | ${x.routes} (${x.dynamic} dynamic) | ${pages} | ${(x.note || '').replace(/\|/g, '/')} |`;
  });
  const md = `# Public repos through Easel\n\nLast updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Sandbox has no internet except GitHub + npm/PyPI registries, and no PHP.\n\n| Name | Repo | Detected as | Setup | Result | Routes | Pages | Notes |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
  fs.writeFileSync(REPORT, md);
  return md;
}

if (args.includes('--list')) {
  for (const r of REPOS) console.log(r.name.padEnd(18), r.repo + (r.subdir ? ' :: ' + r.subdir : ''));
  process.exit(0);
}
if (args.includes('--report')) {
  console.log(writeReport());
  process.exit(0);
}

const only = arg('--only');
const targets = REPOS.filter((r) => !only || only.split(',').includes(r.name));
process.env.EASEL_HOME ||= path.join(os.homedir(), '.easel-public-test');
process.env.EASEL_QUIET = '1';
const PORT = Number(process.env.EASEL_PORT || 4930);
process.env.EASEL_APP_PORT_START ||= '5300';
// Time budget for this invocation. Setup is resumable, so a slow repo can take several runs.
const LIMIT = Number(arg('--budget') || 150) * 1000;

const { startServer } = await import('../src/server.js');
const server = await startServer({ port: PORT, autostart: false });
const B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || r.status);
  return d;
};

const results = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : {};
for (const t of targets) {
  console.log(`\n▸ ${t.name}  (${t.repo}${t.subdir ? ' :: ' + t.subdir : ''})`);
  const t0 = Date.now();
  const source = `https://github.com/${t.repo}`;
  const same = (await j('GET', '/api/projects')).filter((x) => x.source?.url === source && (!t.subdir || x.subdir === t.subdir));
  const existing = same[0] || null; // newest first
  for (const extra of same.slice(1)) await j('DELETE', `/api/projects/${extra.id}`).catch(() => {});
  let p;
  if (existing && !args.includes('--fresh')) {
    p = existing;
    console.log(`  resuming (${existing.status}, ${Math.round((Date.now() - existing.createdAt) / 1000)}s since added)`);
    if (existing.status === 'setting-up' || args.includes('--rerun')) await j('POST', `/api/projects/${p.id}/resume`);
  } else {
    if (existing) await j('DELETE', `/api/projects/${existing.id}`).catch(() => {});
    p = await j('POST', '/api/projects', { source, subdir: t.subdir });
  }
  let d;
  for (;;) {
    d = await j('GET', `/api/projects/${p.id}`);
    if (d.project.status !== 'setting-up' || Date.now() - t0 > LIMIT) break;
    await sleep(2000);
  }
  if (d.project.status === 'setting-up') {
    const lib0 = d.workspaces.find((w) => w.kind === 'library');
    console.log(`  still setting up: ${d.project.setup.steps.filter((s) => s.status !== 'pending').map((s) => `${s.status}:${s.label}`).join(' | ')}`);
    console.log(`  step: ${lib0?.instance?.step || ''}`);
    console.log('  → in progress; run again to continue');
    continue;
  }
  const totalSecs = Math.round((Date.now() - p.createdAt) / 1000);
  const lib = d.workspaces.find((w) => w.kind === 'library');
  const inst = lib?.instance;
  const logs = lib ? await j('GET', `/api/workspaces/${lib.id}/logs`).catch(() => []) : [];
  const st = Object.values(d.project.routeStatus || {});
  const okS = (s) => s.expected || (s.status >= 200 && s.status < 300);
  const pages = st.length ? { total: st.length, ok: st.filter(okS).length, redirect: st.filter((s) => !s.expected && ((s.status >= 300 && s.status < 400) || s.auth)).length, bad: st.filter((s) => !s.expected && !s.auth && (s.status >= 400 || s.status === 0)).length } : null;
  const running = inst?.status === 'running';
  let verdict = 'fail';
  if (running && pages && pages.ok + pages.redirect === pages.total) verdict = 'pass';
  else if (running && pages && pages.ok > 0) verdict = 'partial';
  else if (!running && d.project.routes?.length && /needs (php|ruby|go)/.test(inst?.error || '')) verdict = 'routes-only';
  const timedOut = d.project.status === 'setting-up';
  const r = {
    when: new Date().toISOString(),
    detected: d.project.stack ? `${d.project.stack.label}${d.project.subdir ? ' @ ' + d.project.subdir : ''}` : 'none',
    candidates: (d.project.candidates || []).map((c) => `${c.subdir || '.'}:${c.adapter}`),
    status: d.project.status,
    instance: inst?.status || null,
    error: inst?.error || d.project.error || null,
    secs: totalSecs,
    routes: d.project.routes?.length || 0,
    dynamic: d.project.routes?.filter((x) => x.dynamic).length || 0,
    routeList: (d.project.routes || []).map((x) => x.path).slice(0, 40),
    routeStatus: d.project.routeStatus,
    pages,
    steps: d.project.setup.steps.map((s) => `${s.status}:${s.label}${s.detail ? ' (' + s.detail + ')' : ''}`),
    logTail: logs.slice(-25),
    verdict: timedOut ? 'fail' : verdict,
    reason: timedOut ? 'setup timed out' : running ? null : inst?.error?.slice(0, 120) || d.project.status,
    note: arg('--note') || '',
  };
  results[t.name] = r;
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  console.log(`  detected: ${r.detected}   candidates: ${r.candidates.join(', ')}`);
  console.log(`  steps: ${r.steps.join(' | ')}`);
  console.log(`  instance: ${r.instance}  ${r.error ? 'error: ' + r.error.slice(0, 300) : ''}`);
  console.log(`  routes (${r.routes}): ${r.routeList.join(' ')}`);
  console.log(`  pages: ${JSON.stringify(r.routeStatus)}`);
  if (r.verdict !== 'pass') console.log('  log tail:\n    ' + r.logTail.slice(-15).join('\n    '));
  console.log(`  → ${r.verdict}  (${r.secs}s)`);
  if (!args.includes('--keep')) await j('DELETE', `/api/projects/${p.id}`).catch(() => {});
}
writeReport();
const { stopAll } = await import('../src/runner.js');
stopAll();
server.close();
process.exit(0);
