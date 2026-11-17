// JavaScript / TypeScript stacks.
import path from 'node:path';
import { which, exists } from '../util.js';
import { HOME } from '../config.js';

const TOOLS_DIR = path.join(HOME, 'tools');
import {
  nextAppRoutes, nextPagesRoutes, svelteKitRoutes, nuxtRoutes, astroRoutes, gatsbyRoutes,
  remixFlatRoutes, reactRouterConfigRoutes, tanstackRoutes, grepRoutes, pagesDirRoutes,
} from '../routes.js';

const SRC_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.vue', '.svelte'];

/**
 * What Node version the app asks for (engines.node, devEngines.runtime, .nvmrc, .node-version),
 * and whether the Node running Easel satisfies it. Handles the common forms: ^24, >=20.11, 20.x, 18 || 20.
 */
export function nodeRequirement(ctx, version = process.versions.node) {
  const wanted = ctx.pkg?.devEngines?.runtime?.version || ctx.pkg?.engines?.node || ctx.read('.nvmrc').trim() || ctx.read('.node-version').trim() || null;
  if (!wanted || /^(lts|node|stable)/i.test(wanted)) return { wanted, ok: true };
  const cur = String(version).replace(/^v/, '').split('.').map(Number);
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    return 0;
  };
  const parse = (v) => v.replace(/^v/, '').split('.').map((x) => (x === 'x' || x === '*' ? 0 : Number(x) || 0));
  const one = (clause) => {
    const c = clause.trim();
    if (!c) return true;
    return c.split(/\s+/).every((part) => {
      const m = part.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+(?:\.(?:\d+|x|\*))*)/);
      if (!m) return true;
      const v = parse(m[2]);
      const op = m[1] || (m[2].split('.').length < 3 || /x|\*/.test(m[2]) ? 'major' : '=');
      if (op === '^' || op === 'major') return cur[0] === v[0] && cmp(cur, v) >= 0;
      if (op === '~') return cur[0] === v[0] && cur[1] === (v[1] || 0) && cmp(cur, v) >= 0;
      if (op === '>=') return cmp(cur, v) >= 0;
      if (op === '>') return cmp(cur, v) > 0;
      if (op === '<=') return cmp(cur, v) <= 0;
      if (op === '<') return cmp(cur, v) < 0;
      return cmp(cur, v) === 0;
    });
  };
  return { wanted, ok: wanted.split('||').some(one) };
}

/** Install steps for any package.json project. */
export function nodeInstall(ctx) {
  if (!ctx.pkg) return [];
  const pm = ctx.pm;
  const quiet = ['--no-audit', '--no-fund', '--loglevel=error'];
  // Last resort: the lockfile pins a registry or versions we can't reach (a private mirror, a yanked
  // tarball). Resolve fresh from the default registry, then put the lockfiles back untouched.
  const LOCKS = 'yarn.lock pnpm-lock.yaml bun.lock bun.lockb npm-shrinkwrap.json';
  const ignoreLocks = {
    label: 'npm install (ignoring lockfiles)',
    cmd: 'sh',
    args: ['-c', `for f in ${LOCKS}; do [ -f "$f.easel-hidden" ] && mv "$f.easel-hidden" "$f"; done; for f in ${LOCKS}; do [ -f "$f" ] && mv "$f" "$f.easel-hidden"; done; npm install --package-lock=false --legacy-peer-deps ${quiet.join(' ')}; code=$?; for f in ${LOCKS}; do [ -f "$f.easel-hidden" ] && mv "$f.easel-hidden" "$f"; done; exit $code`],
  };
  const npmFallbacks = [
    { label: 'npm install', cmd: 'npm', args: ['install', ...quiet] },
    { label: 'npm install --legacy-peer-deps', cmd: 'npm', args: ['install', '--legacy-peer-deps', ...quiet] },
    ignoreLocks,
  ];
  // pnpm / yarn: the binary on PATH, else the exact version the repo asks for installed into
  // Easel's tool cache (plain npm, so proxies and mirrors behave), else corepack, else npm.
  const viaCorepack = (tool, args) => ({ label: `${tool} ${args.join(' ')} (via corepack)`, cmd: 'corepack', args: [tool, ...args], env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', COREPACK_ENABLE_STRICT: '0' } });
  const declared = (tool) => {
    const pmField = String(ctx.pkg.packageManager || '');
    if (pmField.startsWith(tool + '@')) return pmField.slice(tool.length + 1).split('+')[0];
    const dev = ctx.pkg.devEngines?.packageManager;
    const d = [].concat(dev || []).find((x) => x && x.name === tool);
    return d?.version || null;
  };
  const viaToolCache = (tool, version, args) => {
    const v = version || (tool === 'yarn' ? '1' : 'latest');
    const dir = path.join(TOOLS_DIR, `${tool}@${v}`);
    const bin = path.join(dir, 'node_modules', '.bin', tool);
    const q = (s) => `'${s.replace(/'/g, "'\\''")}'`;
    return {
      label: `${tool}@${v} ${args.join(' ')}`,
      cmd: 'sh',
      args: ['-c', `[ -x ${q(bin)} ] || npm install --prefix ${q(dir)} ${tool}@${v} --no-audit --no-fund --loglevel=error || exit 1; exec ${q(bin)} ${args.join(' ')}`],
      env: { COREPACK_ENABLE_STRICT: '0', npm_config_manage_package_manager_versions: 'false' },
    };
  };
  const chain = (first, ...rest) => [{ ...first, fallbacks: [...rest, ...npmFallbacks] }];
  if (pm === 'pnpm') {
    // No declared version: pick the pnpm major that writes this lockfile format (newer majors may refuse it).
    const lockVer = (ctx.read('pnpm-lock.yaml').match(/lockfileVersion:\s*['"]?([\d.]+)/) || [])[1];
    const byLock = !lockVer ? '10' : Number(lockVer) >= 9 ? '10' : Number(lockVer) >= 6 ? '8' : '7';
    const v = declared('pnpm') || byLock;
    // Behave like npm: don't fail the install because a dependency has a build script.
    const args = ['install', '--config.strict-dep-builds=false'];
    if (which('pnpm')) return chain({ label: 'pnpm install', cmd: 'pnpm', args }, viaToolCache('pnpm', v, args));
    return chain(viaToolCache('pnpm', v, args), ...(which('corepack') ? [viaCorepack('pnpm', args)] : []));
  }
  if (pm === 'yarn') {
    const v = declared('yarn');
    if (which('yarn')) return chain({ label: 'yarn install', cmd: 'yarn', args: ['install'] });
    // Yarn 2+ ("berry") is only distributed through corepack; Yarn 1 installs from npm.
    if (v && !/^1\./.test(v) && which('corepack')) return chain(viaCorepack('yarn', ['install']), viaToolCache('yarn', '1', ['install']));
    return chain(viaToolCache('yarn', v || '1', ['install']), ...(which('corepack') ? [viaCorepack('yarn', ['install'])] : []));
  }
  if (pm === 'bun' && which('bun')) return [{ label: 'bun install', cmd: 'bun', args: ['install'], fallbacks: npmFallbacks }];
  const hasLock = ctx.has('package-lock.json');
  return [
    {
      label: hasLock ? 'npm ci' : 'npm install',
      cmd: 'npm',
      args: hasLock ? ['ci', ...quiet] : ['install', ...quiet],
      fallbacks: hasLock ? npmFallbacks : npmFallbacks.slice(1),
    },
  ];
}

const devEnv = (port) => ({ PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', NODE_ENV: 'development', FORCE_COLOR: '0' });

/** Run a binary from node_modules/.bin. */
const binCmd = (ctx, name, args, port, env = {}) => ({ cmd: ctx.bin(name), args, env: { ...devEnv(port), ...env } });

/** Run a package.json script with the detected package manager. */
function scriptCmd(ctx, script, port, env = {}) {
  const pm = ctx.pm === 'npm' || !which(ctx.pm) ? 'npm' : ctx.pm;
  return { cmd: pm, args: ['run', script], env: { ...devEnv(port), ...env } };
}

function reactRouterGrep(dir) {
  return grepRoutes(dir, {
    exts: ['.js', '.jsx', '.ts', '.tsx'],
    mustInclude: /react-router|@solidjs\/router|wouter|@reach\/router/,
    patterns: [/<Route\b[^>]*?\bpath\s*=\s*\{?\s*["'`]([^"'`]+)["'`]/g, /\bpath\s*:\s*["'`]([^"'`]+)["'`]/g],
  }).filter((r) => r.path !== '/*' && r.path !== '/**');
}

function vueRouterGrep(dir) {
  return grepRoutes(dir, {
    exts: ['.js', '.ts', '.vue'],
    mustInclude: /vue-router|createRouter|new VueRouter/,
    patterns: [/\bpath\s*:\s*["'`]([^"'`]+)["'`]/g],
  }).filter((r) => !r.path.includes('(.*)') && !r.path.includes('pathMatch'));
}

function spaRoutes(ctx) {
  const dir = ctx.dir;
  let routes = [];
  const viteCfg = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts'].map((f) => ctx.read(f)).join('\n');
  if (/vue-router\/vite|unplugin-vue-router|vite-plugin-pages|@generouted\/|generouted/.test(viteCfg) || ctx.dep('unplugin-vue-router') || ctx.dep('vite-plugin-pages') || ctx.dep('@generouted/react-router')) {
    routes = routes.concat(pagesDirRoutes(dir));
  }
  if (ctx.dep('@tanstack/react-router') || ctx.dep('@tanstack/solid-router')) {
    routes = routes.concat(tanstackRoutes(dir));
    routes = routes.concat(
      grepRoutes(dir, { exts: SRC_EXTS, patterns: [/createFileRoute\(\s*["'`]([^"'`]+)["'`]/g, /createRoute\([^)]*?\bpath\s*:\s*["'`]([^"'`]+)["'`]/g] }).map((r) => ({
        ...r,
        // pathless layouts (_layout), groups ((auth)) and $params → Easel form
        path: '/' + r.path.split('/').filter((s) => s && !s.startsWith('_') && !/^\(.*\)$/.test(s)).map((s) => (s === '$' ? '*' : s.replace(/^\$/, ':'))).join('/'),
      })),
    );
  }
  if (ctx.dep('vue-router')) routes = routes.concat(vueRouterGrep(dir));
  if (ctx.dep('react-router') || ctx.dep('react-router-dom') || ctx.dep('@solidjs/router') || ctx.dep('wouter')) {
    routes = routes.concat(reactRouterGrep(dir));
    // Many apps keep paths in a config module (e.g. paths.ts: { app: { path: '/app' } }) that never imports the router.
    routes = routes.concat(
      grepRoutes(dir, { roots: ['src', 'app'], exts: ['.js', '.jsx', '.ts', '.tsx'], patterns: [/\bpath\s*:\s*["'`](\/[^"'`]*)["'`]/g] })
        .filter((r) => !/^\/(api|_|static|assets)\b/.test(r.path) && r.path.length < 80),
    );
  }
  if (ctx.dep('svelte-spa-router')) routes = routes.concat(grepRoutes(dir, { exts: ['.js', '.ts', '.svelte'], patterns: [/["'`](\/[^"'`]*)["'`]\s*:\s*\w+/g], mustInclude: /svelte-spa-router/ }));
  if (!routes.some((r) => r.path === '/')) routes.unshift({ path: '/', source: 'default' });
  return routes;
}

/** Fill with every adapter in priority order. Each: detect(ctx) -> score (0 = no). */
export const nodeAdapters = [
  {
    id: 'next',
    label: 'Next.js',
    lang: 'JavaScript',
    detect: (c) => (c.dep('next') ? 92 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'next', ['dev', '-p', String(port), '-H', '127.0.0.1'], port, { NEXT_TELEMETRY_DISABLED: '1' }),
    routes: (c) => [...nextAppRoutes(c.dir), ...nextPagesRoutes(c.dir)],
    hmr: 'websocket',
  },
  {
    id: 'nuxt',
    label: 'Nuxt',
    lang: 'JavaScript',
    detect: (c) => (c.dep('nuxt') || c.dep('nuxt3') ? 90 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, exists(c.bin('nuxi')) ? 'nuxi' : 'nuxt', ['dev', '--port', String(port), '--host', '127.0.0.1'], port, { NUXT_TELEMETRY_DISABLED: '1' }),
    routes: (c) => {
      const r = nuxtRoutes(c.dir);
      return r.length ? r : [{ path: '/', source: 'default' }];
    },
  },
  {
    id: 'sveltekit',
    label: 'SvelteKit',
    lang: 'JavaScript',
    detect: (c) => (c.dep('@sveltejs/kit') ? 90 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'vite', ['dev', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], port),
    routes: (c) => svelteKitRoutes(c.dir),
  },
  {
    id: 'astro',
    label: 'Astro',
    lang: 'JavaScript',
    detect: (c) => (c.dep('astro') ? 90 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'astro', ['dev', '--port', String(port), '--host', '127.0.0.1'], port, { ASTRO_TELEMETRY_DISABLED: '1' }),
    routes: (c) => astroRoutes(c.dir),
  },
  {
    id: 'remix',
    label: 'Remix / React Router',
    lang: 'JavaScript',
    detect: (c) => (c.dep('@remix-run/dev') || c.dep('@react-router/dev') ? 89 : 0),
    install: nodeInstall,
    start: (c, { port }) => {
      if (c.dep('@react-router/dev')) return binCmd(c, 'react-router', ['dev', '--port', String(port), '--host', '127.0.0.1'], port);
      const viteRemix = /remix\s*\(/.test(c.read('vite.config.ts') + c.read('vite.config.js') + c.read('vite.config.mjs'));
      if (viteRemix) return binCmd(c, 'remix', ['vite:dev', '--port', String(port), '--host', '127.0.0.1'], port);
      return binCmd(c, 'remix', ['dev'], port);
    },
    routes: (c) => {
      const cfg = reactRouterConfigRoutes(c.dir);
      return cfg.length ? cfg : remixFlatRoutes(c.dir);
    },
  },
  {
    id: 'gatsby',
    label: 'Gatsby',
    lang: 'JavaScript',
    detect: (c) => (c.dep('gatsby') ? 88 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'gatsby', ['develop', '-p', String(port), '-H', '127.0.0.1'], port, { GATSBY_TELEMETRY_DISABLED: '1' }),
    routes: (c) => gatsbyRoutes(c.dir),
  },
  {
    id: 'angular',
    label: 'Angular',
    lang: 'TypeScript',
    detect: (c) => (c.dep('@angular/core') && (c.has('angular.json') || c.has('.angular-cli.json')) ? 88 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'ng', ['serve', '--port', String(port), '--host', '127.0.0.1'], port, { NG_CLI_ANALYTICS: 'false' }),
    routes: (c) => {
      const r = grepRoutes(c.dir, {
        exts: ['.ts'],
        mustInclude: /@angular\/router|\bRoutes\b/,
        patterns: [/\bpath\s*:\s*["'`]([^"'`]*)["'`]/g],
      }).filter((x) => !x.path.includes('**'));
      if (!r.some((x) => x.path === '/')) r.unshift({ path: '/', source: 'default' });
      return r;
    },
  },
  {
    id: 'cra',
    label: 'Create React App',
    lang: 'JavaScript',
    detect: (c) => (c.dep('react-scripts') ? 86 : 0),
    install: nodeInstall,
    // WDS_SOCKET_PORT=0 makes the HMR socket use the page's own port, i.e. Easel's proxy.
    start: (c, { port }) => binCmd(c, 'react-scripts', ['start'], port, { WDS_SOCKET_PORT: '0', DANGEROUSLY_DISABLE_HOST_CHECK: 'true' }),
    routes: spaRoutes,
  },
  {
    id: 'vue-cli',
    label: 'Vue CLI',
    lang: 'JavaScript',
    detect: (c) => (c.dep('@vue/cli-service') ? 84 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'vue-cli-service', ['serve', '--port', String(port), '--host', '127.0.0.1'], port),
    routes: spaRoutes,
  },
  {
    id: 'vite',
    label: 'Vite',
    lang: 'JavaScript',
    detect: (c) => (c.dep('vite') ? 75 : 0),
    describe: (c) => {
      const fw = c.dep('react') ? 'React' : c.dep('vue') ? 'Vue' : c.dep('svelte') ? 'Svelte' : c.dep('solid-js') ? 'Solid' : c.dep('preact') ? 'Preact' : c.dep('lit') ? 'Lit' : 'vanilla';
      return `Vite + ${fw}`;
    },
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], port),
    routes: spaRoutes,
  },
  {
    id: 'parcel',
    label: 'Parcel',
    lang: 'JavaScript',
    detect: (c) => (c.dep('parcel') || c.dep('parcel-bundler') ? 65 : 0),
    install: nodeInstall,
    start: (c, { port }) => {
      const entry = c.pkg?.source || (c.has('src/index.html') ? 'src/index.html' : 'index.html');
      return binCmd(c, 'parcel', [].concat(entry, ['--port', String(port), '--host', '127.0.0.1', '--no-autoinstall']), port);
    },
    routes: spaRoutes,
  },
  {
    id: 'webpack',
    label: 'webpack dev server',
    lang: 'JavaScript',
    detect: (c) => (c.dep('webpack-dev-server') ? 60 : 0),
    install: nodeInstall,
    start: (c, { port }) => binCmd(c, 'webpack', ['serve', '--port', String(port), '--host', '127.0.0.1'], port),
    routes: spaRoutes,
  },
  {
    id: 'node-server',
    label: 'Node server',
    lang: 'JavaScript',
    detect: (c) => (['express', 'fastify', 'koa', '@hapi/hapi', 'hono', '@nestjs/core', 'restify', 'polka'].some(c.dep) && c.pkg?.scripts && (c.pkg.scripts.dev || c.pkg.scripts.start) ? 55 : 0),
    describe: (c) => {
      const fw = ['@nestjs/core', 'express', 'fastify', 'koa', 'hono', '@hapi/hapi'].find(c.dep) || 'node';
      return `Node (${fw.replace('@nestjs/core', 'NestJS').replace('@hapi/hapi', 'hapi')})`;
    },
    install: nodeInstall,
    start: (c, { port }) => scriptCmd(c, c.pkg.scripts.dev ? 'dev' : 'start', port),
    routes: (c) => {
      const r = grepRoutes(c.dir, {
        exts: ['.js', '.ts', '.mjs', '.cjs'],
        patterns: [/\b(?:app|router|server|route)\.get\(\s*["'`]([^"'`]+)["'`]/g, /@Get\(\s*["'`]([^"'`]*)["'`]/g],
      });
      if (!r.some((x) => x.path === '/')) r.unshift({ path: '/', source: 'default' });
      return r;
    },
  },
  {
    id: 'node-script',
    label: 'Node (package.json script)',
    lang: 'JavaScript',
    detect: (c) => (c.pkg?.scripts && (c.pkg.scripts.dev || c.pkg.scripts.start || c.pkg.scripts.serve) ? 30 : 0),
    install: nodeInstall,
    start: (c, { port }) => scriptCmd(c, c.pkg.scripts.dev ? 'dev' : c.pkg.scripts.start ? 'start' : 'serve', port),
    routes: () => [{ path: '/', source: 'default' }],
  },
];

export const isNodeProject = (c) => !!c.pkg;
export { path };
