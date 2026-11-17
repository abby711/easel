#!/usr/bin/env node
// Easel CLI
//   easel [start] [--port 4800] [--no-autostart]   start the canvas server
//   easel add <git-url | owner/repo | folder> [--name x] [--branch b] [--subdir apps/web]
//   easel ls                                        list projects
//   easel detect <folder>                           what stack + routes Easel sees (no server needed)
//   easel doctor                                    which language toolchains are installed
//   easel mcp                                       stdio MCP server for coding agents
const [, , cmd = 'start', ...rest] = process.argv;

function flag(name, def) {
  const i = rest.indexOf('--' + name);
  if (i === -1) return def;
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v;
}
const has = (name) => {
  const i = rest.indexOf('--' + name);
  if (i === -1) return false;
  rest.splice(i, 1);
  return true;
};

const BASE = () => process.env.EASEL_URL || `http://127.0.0.1:${process.env.EASEL_PORT || 4800}`;
async function api(method, path, body) {
  const res = await fetch(BASE() + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  if (!res) {
    console.error(`Easel isn't running at ${BASE()}. Start it with:  easel start`);
    process.exit(1);
  }
  const data = await res.json();
  if (!res.ok) {
    console.error('Error:', data.error);
    process.exit(1);
  }
  return data;
}

if (cmd === 'start' || cmd === 'serve') {
  const port = flag('port');
  if (port) process.env.EASEL_PORT = port;
  const autostart = !has('no-autostart');
  const { startServer } = await import('../src/server.js');
  const { PORT, HOST, HOME } = await import('../src/config.js');
  await startServer({ autostart });
  console.log(`\n  Easel is running →  http://${HOST}:${PORT}\n  data: ${HOME}\n  stop: Ctrl+C\n`);
} else if (cmd === 'add') {
  const source = rest.find((x) => !x.startsWith('--'));
  if (!source) {
    console.error('usage: easel add <git-url | owner/repo | folder> [--name x] [--branch b] [--subdir dir]');
    process.exit(1);
  }
  const name = flag('name');
  const branch = flag('branch');
  const subdir = flag('subdir');
  const p = await api('POST', '/api/projects', { source, name, branch, subdir });
  console.log(`Added ${p.name} (${p.id}). Setting up… open ${BASE()}/#/p/${p.id}`);
} else if (cmd === 'ls' || cmd === 'list') {
  const list = await api('GET', '/api/projects');
  if (!list.length) console.log('No projects yet. Try: easel add owner/repo');
  for (const p of list) console.log(`${p.id.padEnd(28)} ${String(p.status).padEnd(12)} ${(p.stack?.label || '?').padEnd(22)} ${p.name}`);
} else if (cmd === 'detect') {
  process.env.EASEL_QUIET = '1';
  const dir = rest[0] || '.';
  const { detectRepo, discoverRoutes } = await import('../src/adapters/index.js');
  const path = await import('node:path');
  const cands = detectRepo(path.resolve(dir));
  if (!cands.length) {
    console.log('No supported app found. Add an easel.json with {"start": "your command --port $PORT"}.');
    process.exit(0);
  }
  for (const c of cands) console.log(`${(c.subdir || '.').padEnd(24)} ${c.label.padEnd(24)} score ${c.score}`);
  const best = cands[0];
  const routes = discoverRoutes(path.join(path.resolve(dir), best.subdir), best.adapter);
  console.log(`\nRoutes (${best.label}):`);
  for (const r of routes) console.log(`  ${r.path.padEnd(40)} ${r.dynamic ? 'needs value  ' : '             '}${r.file ? r.file + (r.line ? ':' + r.line : '') : r.source}`);
} else if (cmd === 'doctor') {
  const { which } = await import('../src/util.js');
  const { ADAPTERS, missingToolchain } = await import('../src/adapters/index.js');
  const tools = ['node', 'npm', 'pnpm', 'yarn', 'bun', 'python3', 'ruby', 'bundle', 'php', 'composer', 'go', 'java', 'dotnet', 'mix', 'hugo', 'git'];
  console.log('Toolchains:');
  for (const t of tools) console.log(`  ${which(t) ? '✓' : '·'} ${t}`);
  console.log('\nStacks:');
  for (const a of ADAPTERS) {
    const miss = missingToolchain(a.id);
    console.log(`  ${miss.length ? '·' : '✓'} ${a.label.padEnd(26)} ${miss.length ? 'needs ' + miss.join(', ') : ''}`);
  }
} else if (cmd === 'mcp') {
  const { startMcp } = await import('../src/mcp.js');
  startMcp();
} else {
  console.log('usage: easel [start|add|ls|detect|doctor|mcp]');
  process.exit(1);
}
