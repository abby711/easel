# Easel

Put your running app on a canvas. Easel takes a repo (or a folder), runs it on your machine, and lays every page out as a **live frame** on an infinite board. You can explore data states side by side, make **frame copies** (separate checkouts with their own dev servers), edit code, and take the changes home as a diff, a `git am` patch or a git bundle.

This is the architecture without AI or cloud: everything runs locally, and nothing here calls a model. AI plugs in later through the MCP server (see "Where AI goes").

```
node bin/easel.js            # start → http://127.0.0.1:4800
```

Requires Node 18.17+ and git. Each stack needs its own toolchain (Python for Django/Flask, PHP for Laravel, and so on). Run `node bin/easel.js doctor` to see what this machine can run.

---

## Quick start

```bash
cd easel
node bin/easel.js                         # opens the canvas server
# in the UI, paste any of:
#   https://github.com/you/app   ·   you/app   ·   /path/to/a/folder
```

Or from a second terminal:

```bash
node bin/easel.js add abby711/dynamic-covidtracker
node bin/easel.js ls
node bin/easel.js detect ~/code/some-repo    # what stack/routes Easel sees, no server needed
```

Setup shows each step as it runs: reading the code, detecting the stack, preparing env, installing and starting, finding pages, adding them to the board, and checking each page.

## Using the canvas

| Action | How |
|---|---|
| Pan | drag the empty canvas, scroll, or hold Space |
| Zoom | Ctrl/⌘ + scroll, ⌘+/⌘−, ⌘0 for 100%, Shift+1 to fit |
| Select / move a frame | click / drag it |
| **Play** (use the live app inside the frame) | double-click, or Enter. Esc to stop |
| **Inspect** | click an element: tag, styles, React/Vue/Svelte source when available, and matching `file:line` from a code search |
| Data state | per frame: `default · empty · error · slow · loading · offline` + any states your mock rules define |
| States side by side | one click adds the same page in each state |
| All viewports | desktop, tablet and mobile side by side |
| **Copy frame** | new checkout + its own server, placed beside the original |
| Code | built-in editor. Saving updates frames through the app's own hot reload |
| Changes | diff view, plus download as `.diff` / `.patch` (mbox) / `.bundle` |
| Notes | N, then click the canvas |
| Pages | top of the left panel. The Library is your app as it is today; + adds a page for explorations, double-click renames |
| Switch project | the project name in the top bar opens a switcher |

Below the Pages list, the left panel has four tabs:

- **Routes:** routes, with status codes and `file:line`. Also sample values for dynamic routes, workspaces, and the other apps found in a monorepo.
- **Design:** design tokens, colours, fonts, sizes, spacing, Tailwind usage, and components with file:line, props and usage counts. It also shows the styles measured on rendered pages.
- **Data:** mock mode, rules, recordings, and a live log of every call the app made and how it was answered.
- **Logs:** the dev server's output, with start, stop and restart.

---

## How it works

```
              ┌───────────────────────────── Easel server :4800 ──────────────────────────────┐
 repo/folder ─┤ ingest (clone/copy, read-only) → detect stack → stub .env → install → start   │
              │ routes: framework conventions + code patterns + crawl + links seen in frames  │
              │ boards.json · workspaces.json · project.json   (EASEL_HOME, default ~/.easel) │
              └───────┬───────────────────────────────────────────────────────────────────────┘
                      │ one per workspace (Library + each copy)
              ┌───────▼────────── Easel proxy :48xx ───────────┐        ┌── your dev server :48yy ──┐
 canvas  ◄────┤ injects /__easel/runtime.js first in <head>     ├──────► │ vite / next dev / flask / │
 iframe       │ strips X-Frame-Options / CSP frame-ancestors     │        │ manage.py runserver / ... │
              │ passes WebSocket upgrades (your HMR keeps working)│ ◄─────┤ (NODE_OPTIONS hook routes │
              │ /__easel/net → mock engine (rules/record/replay) │        │  server-side fetch here)  │
              └──────────────────────────────────────────────────┘        └───────────────────────────┘
```

**Why it works for any language:** only three things are per-stack, and they live in an adapter: how to install, how to start on a given port, and where routes are defined. Everything else (the proxy, runtime, mocks, canvas, copies and export) happens at the HTTP and browser level, so it doesn't care what the server is written in.

### The runtime (`runtime/runtime.js`)

The proxy injects it as the first script on every page.

- **Network:** cross-origin `fetch`/XHR goes through `/__easel/net`. Same-origin calls carry an `x-easel-state` header, and WebSockets with a mock rule get a fake socket.
- **Frame identity and state:** travel in `window.name`, so in-frame navigation keeps them.
- **Reports to the canvas:** ready, route changes, page height, errors, same-origin links (used for route discovery) and a style census (used by the Design tab).
- **Inspector:** the element picker.

### Mocks (`easel.mocks/` inside the workspace, never exported)

Mock files are plain JSON:

```json
{
  "rules": [
    {
      "id": "users",
      "match": { "method": "GET", "url": "https://api.example.com/users*" },
      "states": {
        "default": { "status": 200, "json": [{ "id": 1, "name": "Ada" }] },
        "long":    { "json": [{ "id": 1, "name": "Maximiliana Wolfeschlegelsteinhausenberger" }] },
        "error":   { "status": 503, "json": { "error": "down" } }
      }
    },
    { "id": "me", "match": { "path": "/api/me" }, "response": { "json": { "name": "Ada" } } },
    { "id": "ticker", "match": { "url": "wss://stream.example.com/*" }, "ws": { "messages": [{ "price": 1 }, { "price": 2 }], "interval": 500, "echo": true } }
  ]
}
```

- **`url`** matches cross-origin calls; `*` is a wildcard and the query is ignored unless you include `?`.
- **`path`** matches the app's own backend, with `:params` and `*`.
- **Free states for every rule:**

  | State | What it does |
  |---|---|
  | `empty` | every array in the response becomes `[]` |
  | `error` | 500 |
  | `slow` | +3 s |
  | `loading` | never answers |
  | `offline` | network error |

  Custom states (like `long`) show up in the state menu.
- **Modes:**

  | Mode | Answers with |
  |---|---|
  | `auto` (default) | rules → recordings → live, and records new successful calls into `easel.mocks/recorded/` |
  | `live` | rules → live |
  | `replay` | rules → recordings only (fully offline) |
  | `off` | everything live |

- **Server-side calls:** Node dev servers get `runtime/node-hook.cjs` preloaded. It hooks both `fetch()` and Node's `http`/`https` modules, so these are mocked too:
  - server components, loaders, SvelteKit `load` and the like
  - axios, got, and SDKs like Stripe's

  It's tested with a Next.js server component plus `https.get`/`request` (with keep-alive agents and POST bodies). Unmocked calls fail with an error that names the URL to mock.

### Frame copies and export

- **How a copy is made:** `git clone --shared` of the parent, plus the parent's exact working tree. `node_modules`/`vendor` are hard-linked (APFS clones on macOS), so there's no reinstall.
- **Separate server:** each copy runs on its own port.
- **What setup produced stays out of "your changes".** For example, a `package-lock.json` npm generated, Django's `db.sqlite3` or the stub `.env`. So do `easel.mocks/`, `.env` and `node_modules`.
- **Exports:**

  | Format | Apply it with |
  |---|---|
  | `.diff` | `git apply` |
  | `.patch` (mbox) | `git am` |
  | `.bundle` | `git fetch x.bundle refs/heads/easel/*:refs/heads/easel/*` |

- **The other direction:** you can also push a local patch onto a copy (`POST /api/workspaces/:id/apply`, or the MCP tool).

### Secrets and env

- **Local folders:** they're copied without `.env*` (examples are kept), keys or `credentials.json`.
- **`.env` from an example:** if there's a `.env.example`, Easel writes a `.env` with placeholder values. Real services don't work, and the mock layer answers instead.
- **Your original repo:** never written to.

---

## Supported stacks

| Stack | Detected by | Routes from | Tested end to end here |
|---|---|---|---|
| Static HTML | `index.html` | `.html` files + crawl | ✅ |
| Vite (React/Vue/Svelte/Solid/Preact/Lit) | `vite` dep | React Router / Vue Router / TanStack / svelte-spa-router code | ✅ (React) |
| Next.js (app + pages router) | `next` dep | `app/**/page.*`, `pages/**` | ✅ |
| Nuxt · SvelteKit · Astro · Remix / React Router 7 · Gatsby | deps | file conventions / `app/routes.ts` | routes ✅ (unit), run: needs your repos |
| Angular · CRA · Vue CLI · Parcel · webpack-dev-server | deps | router code | — |
| Express / Fastify / Koa / Nest / Hono | deps + script | `app.get('/x')`, `@Get()` | — |
| Django | `manage.py` | `ROOT_URLCONF` → `include()` tree | ✅ (venv, migrate, login redirect) |
| Flask · FastAPI · Streamlit | deps / `Flask(` | `@app.route`, `@app.get` + crawl | ✅ (Flask) |
| Rails · Sinatra · Jekyll | Gemfile | `config/routes.rb` (resources, namespace…) | routes ✅ (unit) |
| Laravel · Symfony · WordPress · plain PHP | composer / `artisan` / `.php` | `routes/web.php`, `#[Route]`, files + crawl | routes ✅ (unit); needs PHP to run |
| Go · Spring Boot · ASP.NET Core · Phoenix · Hugo | `go.mod` / pom / csproj / mix.exs / hugo.toml | handler patterns + crawl | — |
| **Anything else** | `easel.json` or `Procfile` | listed or crawled | ✅ (detection) |

**Any language via `easel.json`** at the app root:

```json
{ "label": "My Rust service", "install": ["cargo build"], "start": "cargo run -- --port $PORT", "routes": ["/", "/orders/:id"] }
```

`{"static": "dist"}` serves a folder.

**Monorepos:** Easel lists every app it finds two levels deep, such as `apps/web` and `apps/docs`. You can switch between them in the Routes tab. Pass `--subdir` to pick a deeper one.

### Getting real-world repos to boot (no AI)

These all came out of running 17 recent public repos ([report](test/public-repos-report.md)):

- **Right runtime per app:**
  - **Node:** if an app asks for a Node your machine doesn't have (`engines`, `devEngines`, `.nvmrc`), Easel downloads that official Node build from the npm registry into `~/.easel/node/`. It uses it for that app only.
  - **pnpm and Yarn:** the exact version from `packageManager` is installed into `~/.easel/tools/`. Without one, pnpm's major is matched to the lockfile format.
  - **Python:** if pip fails on an old Python, Easel fetches the one the app wants with `uv`, rebuilds the virtualenv and retries.
- **Install fallbacks:**
  - The chain is the package manager, then corepack, then `npm install`, then `--legacy-peer-deps`.
  - The last resort is a fresh resolve that ignores lockfiles pinned to unreachable mirrors. The lockfiles are put back afterwards.
  - Failed attempts are remembered, so a restart goes straight to the next fallback.
- **Resumable setup:** close Easel mid-install and it picks up where it left off.
- **Git submodules** are fetched; SSH URLs are rewritten to HTTPS.
- **Workspaces:** binaries hoisted to a monorepo root are found.
- **Databases:** Flask apps get `flask db upgrade` or their own `init-db` command. Django gets `migrate`.
- **Pages:** 401/403 counts as "needs sign-in", not broken, and a `/404` page answering 404 counts as working.

---

## Agents (MCP)

Easel ships a stdio MCP server, so Claude Code, Cursor, Codex and others can drive it:

```bash
claude mcp add easel -- node /path/to/easel/bin/easel.js mcp      # Claude Code
# any client: command "node", args ["/path/to/easel/bin/easel.js", "mcp"], env EASEL_URL=http://127.0.0.1:4800
```

It has 16 tools:

| Area | Tools |
|---|---|
| Projects & routes | `easel_projects_list`, `easel_project_add`, `easel_project_get`, `easel_routes_list` |
| Frames & board | `easel_frame_copy`, `easel_board_add_frame` |
| Files & code | `easel_files_list`, `easel_file_read`, `easel_file_write`, `easel_find_in_code` |
| Changes | `easel_changes_get`, `easel_patch_apply` |
| Data & design | `easel_mocks_get`, `easel_mock_set`, `easel_design_get` |
| Logs | `easel_logs_get` |

### Where AI goes (next step)

These are the seams where a model adds value. The rest stays deterministic:

1. **Mock authoring:** read the code and the request log, then write `easel.mocks/*.json` (including auth/session stubs) until every page renders.
2. **Repair loop:** when a page errors (runtime reports plus logs), propose an `easel.json`, a stand-in, or a mock.
3. **Design agent:** "make three variations of this page" → three frame copies, a file write in each, and screenshots compared.
4. **Audits:** feed `easel_design_get` plus the census across pages to a model to find design-system drift.

---

## Tests

```bash
npm install                 # dev deps for tests only (jsdom, jquery)
npm test                    # unit: detection + routes for 12 stacks and a monorepo, mocks, proxy, tokens
node test/e2e.js            # real runs: static, GitHub covid tracker, Flask, Django, Vite+React, MCP
node test/e2e.js --next     # + Next.js (bigger install)
node test/make-demo.js      # rebuilds demo/easel-demo.html (static clickable snapshot of the UI)
node test/public-repos.js --list            # 17 recent public repos across stacks
node test/public-repos.js --only angular    # run one (resumable; re-run if it says "in progress")
node test/public-repos.js --report          # rebuild test/public-repos-report.md
```

Public repos, last run:

| Result | Repos |
|---|---|
| ✅ Run with every page responding (10) | Angular RealWorld, Vue 3 RealWorld, Vitesse, Bulletproof React (Vite and Next.js), FastAPI template front end, Astro Paper, React Router 7, Flask tutorial, Microblog |
| 🟡 Run, but some pages need mock rules for external APIs (3) | SvelteKit RealWorld, Next SaaS starter (Stripe), Vercel Commerce (Shopify) |
| ❌ Blocked only by the test sandbox's network (3) | Nuxt Movies, both Django apps (they need a newer Node/Python downloaded) |
| ⚪ Routes only (1) | Laravel (no PHP here) |

On the last run, 48/48 e2e checks passed, with all six apps running side by side in one Easel. That included the covid tracker case: its real API is dead, so the page shows 0. With one mock rule it renders real-looking numbers. A custom "spike" state renders different data in a second frame. The automatic "empty" state reveals the page has no empty-state UI, and a frame copy with an Indian-number-format edit exports as a clean one-file diff.

## Data layout

```
~/.easel/                         (override with EASEL_HOME)
  projects/<id>/project.json      stack, routes, setup steps, route status
  projects/<id>/boards.json       frames + notes per page
  projects/<id>/workspaces.json   Library + copies
  projects/<id>/repo/             the Library checkout
  projects/<id>/copies/<wid>/     frame copies
  venvs/<id>/                     Python virtualenvs
```

## Known limits (v0.1)

- **No screenshots or thumbnails yet.** Frames are live iframes. Adding Playwright for covers and visual diffs is easy where Chromium is available.
- **Server-side mocking is Node-only.** Python/Ruby/PHP server-side HTTP calls aren't intercepted yet; their browser calls are.
- **No editing by hand on the canvas yet.** Changes happen through code edits, in the built-in editor or from an agent, not by direct manipulation (planned next).
- **Copies don't follow the Library yet.** After you pull new commits, existing copies stay on their old base.
- **Dynamic routes need sample values.** Routes like `/users/:id` need a value, which you set in the Routes tab.
- **Auth-gated pages show the app's own login redirect.** Signed-in states need a mock of the app's session endpoint, or a seeded user (`easel.json` → `prepare`).
- **No real-time multi-user editing.** Multiple browser tabs stay in sync through the event stream, but there are no presence or comment threads.
- **Not tested on Windows yet.** Process-tree kill is implemented; worth testing first.
