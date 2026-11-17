// Static sites, PHP, Ruby, Go, Java, .NET, Elixir, site generators, and the
// two escape hatches that make any language work: easel.json and Procfile.
import path from 'node:path';
import { readText, lineOf, which, exists } from '../util.js';
import { grepRoutes, pageFileRoutes } from '../routes.js';

/** Where a static site's index.html lives. */
export function staticRoot(ctx) {
  for (const d of ['', 'public', 'docs', 'site', 'www', 'web', 'html', 'src', 'static']) {
    if (ctx.has(path.join(d, 'index.html')) || ctx.has(path.join(d, 'index.htm'))) return d;
  }
  if (ctx.find(/^[^/]+\.html?$/)) return '';
  return null;
}

const portEnv = (port) => ({ PORT: String(port), HOST: '127.0.0.1' });

/** Rails config/routes.rb → paths (handles resources, namespace, scope, root, get/post/...). */
export function railsRoutes(dir) {
  const file = 'config/routes.rb';
  const text = readText(path.join(dir, file), '');
  if (!text) return [];
  const out = [];
  const stack = []; // prefixes
  const prefix = () => stack.filter(Boolean).join('');
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const push = (p, note) => out.push({ path: (prefix() + '/' + p).replace(/\/+/g, '/'), file, line: i + 1, source: 'code', note });
    let m;
    if ((m = line.match(/^root\b/))) push('');
    else if ((m = line.match(/^(?:get|match)\s+['"]([^'"]+)['"]/))) push(m[1].replace(/\(.*?\)/g, ''));
    else if ((m = line.match(/^resources?\s+:(\w+)(.*)$/))) {
      const name = m[1];
      const rest = m[2] || '';
      const singular = line.startsWith('resource ');
      const only = rest.match(/only:\s*\[([^\]]*)\]/);
      const except = rest.match(/except:\s*\[([^\]]*)\]/);
      const allowed = (a) => (!only || only[1].includes(a)) && (!except || !except[1].includes(a));
      if (singular) {
        if (allowed('show')) push(name);
        if (allowed('new')) push(`${name}/new`);
        if (allowed('edit')) push(`${name}/edit`);
      } else {
        if (allowed('index')) push(name);
        if (allowed('new')) push(`${name}/new`);
        if (allowed('show')) push(`${name}/:id`);
        if (allowed('edit')) push(`${name}/:id/edit`);
      }
      if (/\bdo\s*(\|.*\|)?$/.test(line)) stack.push(singular ? `/${name}` : `/${name}/:${name.replace(/s$/, '')}_id`);
      return;
    } else if ((m = line.match(/^(?:namespace)\s+:(\w+)/))) {
      stack.push('/' + m[1]);
      return;
    } else if ((m = line.match(/^scope\s+(?:path:\s*)?['"]([^'"]+)['"]/))) {
      stack.push(m[1].startsWith('/') ? m[1] : '/' + m[1]);
      return;
    }
    if (/\bdo\s*(\|.*\|)?$/.test(line)) stack.push('');
    else if (/^end\b/.test(line)) stack.pop();
  });
  return out;
}

export function laravelRoutes(dir) {
  const out = [];
  for (const file of ['routes/web.php']) {
    const text = readText(path.join(dir, file), '');
    for (const m of text.matchAll(/Route::(?:get|view|match\([^)]*\)\s*,)\s*\(\s*['"]([^'"]*)['"]/g)) {
      out.push({ path: '/' + m[1].replace(/\{(\w+)\??\}/g, ':$1').replace(/^\//, ''), file, line: lineOf(text, m.index), source: 'code' });
    }
    for (const m of text.matchAll(/Route::resource\(\s*['"]([^'"]+)['"]/g)) {
      const n = m[1];
      for (const p of [n, `${n}/create`, `${n}/:id`, `${n}/:id/edit`]) out.push({ path: '/' + p, file, line: lineOf(text, m.index), source: 'code' });
    }
  }
  if (!out.some((r) => r.path === '/')) out.unshift({ path: '/', source: 'default' });
  return out;
}

/** easel.json: the universal override. Any language, any command. */
function easelJson(ctx) {
  return ctx.json('easel.json');
}

export const otherAdapters = [
  {
    id: 'custom',
    label: 'Custom (easel.json)',
    lang: 'Any',
    detect: (c) => (easelJson(c) && (easelJson(c).start || easelJson(c).static != null) ? 1000 : 0),
    describe: (c) => easelJson(c).label || 'Custom (easel.json)',
    install: (c) => [].concat(easelJson(c).install || []).map((cmd) => ({ label: cmd, cmd: 'sh', args: ['-c', cmd] })),
    prepare: (c) => [].concat(easelJson(c).prepare || []).map((cmd) => ({ label: cmd, cmd: 'sh', args: ['-c', cmd], optional: true })),
    start: (c, { port }) => {
      const cfg = easelJson(c);
      if (cfg.static != null) return { static: true, root: cfg.static };
      return { cmd: 'sh', args: ['-c', String(cfg.start).replace(/\$PORT|\{port\}/g, String(port))], env: { ...portEnv(port), ...(cfg.env || {}) } };
    },
    routes: (c) => (easelJson(c).routes || ['/']).map((p) => (typeof p === 'string' ? { path: p, source: 'config' } : { ...p, source: 'config' })),
  },
  {
    id: 'laravel',
    label: 'Laravel',
    lang: 'PHP',
    detect: (c) => (c.has('artisan') && c.composer?.require?.['laravel/framework'] ? 92 : 0),
    install: (c) => (c.has('vendor') ? [] : [{ label: 'composer install', cmd: 'composer', args: ['install', '--no-interaction', '--prefer-dist'] }]),
    prepare: (c) => [
      ...(/^APP_KEY=\s*$/m.test(c.read('.env')) ? [{ label: 'php artisan key:generate', cmd: 'php', args: ['artisan', 'key:generate', '--force'], optional: true }] : []),
      ...(/DB_CONNECTION=sqlite/.test(c.read('.env')) ? [{ label: 'create sqlite db', cmd: 'sh', args: ['-c', 'mkdir -p database && touch database/database.sqlite && php artisan migrate --force'], optional: true }] : []),
    ],
    start: (c, { port }) => ({ cmd: 'php', args: ['artisan', 'serve', '--host=127.0.0.1', `--port=${port}`], env: portEnv(port) }),
    routes: (c) => laravelRoutes(c.dir),
  },
  {
    id: 'symfony',
    label: 'Symfony',
    lang: 'PHP',
    detect: (c) => (c.composer?.require?.['symfony/framework-bundle'] ? 85 : 0),
    install: (c) => (c.has('vendor') ? [] : [{ label: 'composer install', cmd: 'composer', args: ['install', '--no-interaction'] }]),
    start: (c, { port }) => ({ cmd: 'php', args: ['-S', `127.0.0.1:${port}`, '-t', 'public'], env: portEnv(port) }),
    routes: (c) => {
      const r = grepRoutes(c.dir, { roots: ['src'], exts: ['.php'], patterns: [/#\[Route\(\s*['"]([^'"]+)['"]/g, /@Route\(\s*["']([^"']+)["']/g] }).map((x) => ({ ...x, path: x.path.replace(/\{(\w+)\}/g, ':$1') }));
      return r.length ? r : [{ path: '/', source: 'default' }];
    },
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    lang: 'PHP',
    detect: (c) => (c.has('wp-config-sample.php') || c.has('wp-includes') ? 75 : 0),
    install: () => [],
    start: (c, { port }) => ({ cmd: 'php', args: ['-S', `127.0.0.1:${port}`], env: portEnv(port) }),
    routes: () => [{ path: '/', source: 'default', note: 'WordPress needs a MySQL database; pages are crawled after start' }],
    crawl: true,
  },
  {
    id: 'php',
    label: 'PHP',
    lang: 'PHP',
    detect: (c) => (c.find(/^(public\/)?[^/]+\.php$/) ? 45 : 0),
    install: (c) => (c.composer && !c.has('vendor') ? [{ label: 'composer install', cmd: 'composer', args: ['install', '--no-interaction'], optional: true }] : []),
    start: (c, { port }) => {
      const root = c.has('public/index.php') ? 'public' : '';
      return { cmd: 'php', args: ['-S', `127.0.0.1:${port}`, ...(root ? ['-t', root] : [])], env: portEnv(port) };
    },
    routes: (c) => {
      const root = c.has('public/index.php') ? 'public' : '';
      return pageFileRoutes(c.dir, root, ['.php', '.html']).filter((r) => !/\/(config|db|connect|conn|functions?|header|footer|nav|init)\.php$/i.test(r.path));
    },
    crawl: true,
  },
  {
    id: 'rails',
    label: 'Ruby on Rails',
    lang: 'Ruby',
    detect: (c) => (c.has('config/routes.rb') && /['"]rails['"]/.test(c.gemfile) ? 92 : 0),
    install: () => [{ label: 'bundle install', cmd: 'bundle', args: ['install'] }],
    prepare: (c) => [{ label: 'rails db:prepare', cmd: c.has('bin/rails') ? 'bin/rails' : 'bundle', args: c.has('bin/rails') ? ['db:prepare'] : ['exec', 'rails', 'db:prepare'], optional: true }],
    start: (c, { port }) =>
      c.has('bin/rails')
        ? { cmd: 'bin/rails', args: ['server', '-p', String(port), '-b', '127.0.0.1'], env: { ...portEnv(port), RAILS_ENV: 'development' } }
        : { cmd: 'bundle', args: ['exec', 'rails', 'server', '-p', String(port), '-b', '127.0.0.1'], env: portEnv(port) },
    routes: (c) => railsRoutes(c.dir),
  },
  {
    id: 'sinatra',
    label: 'Sinatra',
    lang: 'Ruby',
    detect: (c) => (/['"]sinatra['"]/.test(c.gemfile) ? 75 : 0),
    install: () => [{ label: 'bundle install', cmd: 'bundle', args: ['install'] }],
    start: (c, { port }) => {
      if (c.has('config.ru')) return { cmd: 'bundle', args: ['exec', 'rackup', '-p', String(port), '-o', '127.0.0.1'], env: portEnv(port) };
      const main = c.find(/^(app|main|server)\.rb$/) || c.find(/^[^/]+\.rb$/);
      return { cmd: 'bundle', args: ['exec', 'ruby', main, '-p', String(port), '-o', '127.0.0.1'], env: portEnv(port) };
    },
    routes: (c) => grepRoutes(c.dir, { exts: ['.rb'], patterns: [/^\s*get\s+['"]([^'"]+)['"]/gm] }),
  },
  {
    id: 'jekyll',
    label: 'Jekyll',
    lang: 'Ruby',
    detect: (c) => (c.has('_config.yml') && (/jekyll|github-pages/.test(c.gemfile) || c.has('_posts') || c.has('_layouts')) ? 78 : 0),
    install: (c) => (c.has('Gemfile') ? [{ label: 'bundle install', cmd: 'bundle', args: ['install'] }] : []),
    start: (c, { port }) => ({ cmd: c.has('Gemfile') ? 'bundle' : 'jekyll', args: [...(c.has('Gemfile') ? ['exec', 'jekyll'] : []), 'serve', '--port', String(port), '--host', '127.0.0.1', '--baseurl', ''], env: portEnv(port) }),
    routes: () => [{ path: '/', source: 'default' }],
    crawl: true,
  },
  {
    id: 'hugo',
    label: 'Hugo',
    lang: 'Go',
    detect: (c) => (c.has('hugo.toml') || c.has('hugo.yaml') || (c.has('config.toml') && c.has('content') && (c.has('layouts') || c.has('themes'))) ? 80 : 0),
    install: () => [],
    start: (c, { port }) => ({ cmd: 'hugo', args: ['server', '-p', String(port), '--bind', '127.0.0.1', '--baseURL', '/', '--appendPort=false', '-D'], env: portEnv(port) }),
    routes: () => [{ path: '/', source: 'default' }],
    crawl: true,
  },
  {
    id: 'go',
    label: 'Go',
    lang: 'Go',
    detect: (c) => (c.has('go.mod') ? 60 : 0),
    install: () => [{ label: 'go mod download', cmd: 'go', args: ['mod', 'download'], optional: true }],
    start: (c, { port }) => ({ cmd: 'go', args: ['run', '.'], env: { ...portEnv(port), ADDR: `127.0.0.1:${port}` } }),
    routes: (c) => {
      const r = grepRoutes(c.dir, {
        exts: ['.go'],
        patterns: [/\.(?:HandleFunc|Handle|GET|Get)\(\s*"(?:GET\s+)?([^"]+)"/g],
      }).map((x) => ({ ...x, path: x.path.replace(/\{(\w+)\}|:(\w+)/g, (_, a, b) => ':' + (a || b)) }));
      return r.length ? r : [{ path: '/', source: 'default' }];
    },
    crawl: true,
  },
  {
    id: 'spring',
    label: 'Spring Boot',
    lang: 'Java/Kotlin',
    detect: (c) => (/spring-boot/.test(c.read('pom.xml') + c.read('build.gradle') + c.read('build.gradle.kts')) ? 80 : 0),
    install: () => [],
    start: (c, { port }) => {
      if (c.has('pom.xml')) {
        const mvn = c.has('mvnw') ? './mvnw' : 'mvn';
        return { cmd: mvn, args: ['-q', 'spring-boot:run', `-Dspring-boot.run.arguments=--server.port=${port} --server.address=127.0.0.1`], env: { ...portEnv(port), SERVER_PORT: String(port) } };
      }
      const gradle = c.has('gradlew') ? './gradlew' : 'gradle';
      return { cmd: gradle, args: ['bootRun', `--args=--server.port=${port} --server.address=127.0.0.1`], env: { ...portEnv(port), SERVER_PORT: String(port) } };
    },
    routes: (c) => {
      const r = grepRoutes(c.dir, { roots: ['src'], exts: ['.java', '.kt'], patterns: [/@(?:GetMapping|RequestMapping)\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]*)"/g] }).map((x) => ({ ...x, path: x.path.replace(/\{(\w+)\}/g, ':$1') }));
      return r.length ? r : [{ path: '/', source: 'default' }];
    },
    crawl: true,
  },
  {
    id: 'dotnet',
    label: 'ASP.NET Core',
    lang: 'C#',
    detect: (c) => {
      const proj = c.find(/\.csproj$/);
      return proj && /Microsoft\.NET\.Sdk\.Web/.test(c.read(proj)) ? 80 : 0;
    },
    install: () => [{ label: 'dotnet restore', cmd: 'dotnet', args: ['restore'], optional: true }],
    start: (c, { port }) => ({ cmd: 'dotnet', args: ['watch', 'run', '--non-interactive', '--urls', `http://127.0.0.1:${port}`], env: { ...portEnv(port), ASPNETCORE_ENVIRONMENT: 'Development', DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: '1' } }),
    routes: (c) => {
      const pages = c
        .findAll(/(^|\/)Pages\/.+\.cshtml$/)
        .filter((f) => !/\/_/.test(f) && !/\/Shared\//.test(f))
        .map((f) => {
          const t = c.read(f);
          const m = t.match(/@page\s+"([^"]+)"/);
          const p = m ? m[1] : '/' + f.replace(/^.*?Pages\//, '').replace(/\.cshtml$/, '').replace(/(^|\/)Index$/, '');
          return { path: p.replace(/\{(\w+)(:\w+)?\??\}/g, ':$1'), file: f, source: 'files' };
        });
      const minimal = grepRoutes(c.dir, { exts: ['.cs'], patterns: [/\.MapGet\(\s*"([^"]+)"/g, /\[Route\(\s*"([^"]+)"\)\]/g] }).map((x) => ({ ...x, path: x.path.replace(/\{(\w+)(:\w+)?\??\}/g, ':$1') }));
      const all = [...pages, ...minimal];
      return all.length ? all : [{ path: '/', source: 'default' }];
    },
    crawl: true,
  },
  {
    id: 'phoenix',
    label: 'Phoenix',
    lang: 'Elixir',
    detect: (c) => (/:phoenix\b/.test(c.read('mix.exs')) ? 85 : 0),
    install: () => [{ label: 'mix deps.get', cmd: 'mix', args: ['deps.get'] }],
    start: (c, { port }) => ({ cmd: 'mix', args: ['phx.server'], env: { ...portEnv(port), MIX_ENV: 'dev' } }),
    routes: (c) => grepRoutes(c.dir, { roots: ['lib'], exts: ['.ex'], patterns: [/^\s*(?:get|live)\s+"([^"]+)"/gm] }).map((x) => ({ ...x, path: x.path })),
    crawl: true,
  },
  {
    id: 'static',
    label: 'Static site',
    lang: 'HTML',
    detect: (c) => {
      const root = staticRoot(c);
      if (root == null) return 0;
      return c.pkg ? 35 : 50;
    },
    install: () => [],
    start: (c) => ({ static: true, root: staticRoot(c) || '' }),
    routes: (c) => pageFileRoutes(c.dir, staticRoot(c) || ''),
  },
  {
    id: 'procfile',
    label: 'Procfile app',
    lang: 'Any',
    detect: (c) => (/^web:/m.test(c.read('Procfile')) ? 15 : 0),
    install: () => [],
    start: (c, { port }) => {
      const line = c.read('Procfile').match(/^web:\s*(.+)$/m)[1];
      return { cmd: 'sh', args: ['-c', line.replace(/\$PORT|\$\{PORT\}/g, String(port))], env: portEnv(port) };
    },
    routes: () => [{ path: '/', source: 'default' }],
    crawl: true,
  },
];

/** Which language toolchain each adapter needs, for `easel doctor` and nice errors. */
export const TOOLCHAINS = {
  laravel: ['php', 'composer'], symfony: ['php', 'composer'], wordpress: ['php'], php: ['php'],
  rails: ['ruby', 'bundle'], sinatra: ['ruby', 'bundle'], jekyll: ['ruby'], hugo: ['hugo'],
  go: ['go'], spring: ['java'], dotnet: ['dotnet'], phoenix: ['mix'],
  django: ['python3'], flask: ['python3'], fastapi: ['python3'], streamlit: ['python3'], 'python-script': ['python3'],
};

export function missingToolchain(adapterId) {
  return (TOOLCHAINS[adapterId] || []).filter((t) => !which(t));
}

export { exists };
