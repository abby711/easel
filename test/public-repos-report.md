# Public repos through Easel

Last updated 2026-11-17 10:00 UTC. Sandbox has no internet except GitHub + npm/PyPI registries, and no PHP.

| Name | Repo | Detected as | Setup | Result | Routes | Pages | Notes |
|---|---|---|---|---|---|---|---|
| angular | `gothinkster/angular-realworld-example-app` | Angular | 517s | ✅ runs | 11 (4 dynamic) | 7/7 ok | Fixed: git submodules weren’t fetched (theme lives in one). |
| sveltekit | `sveltejs/realworld` | SvelteKit | 22s | 🟡 partly | 10 (4 dynamic) | 2/8 ok, 3 redirect, 3 error | Runs. Pages that load data server-side from the (dead) RealWorld API 500 until mock rules are added; auth pages redirect correctly. |
| vue-realworld | `mutoe/vue3-realworld-example-app` | Vite + Vue | 26s | ✅ runs | 11 (5 dynamic) | 6/6 ok |  |
| vitesse | `antfu-collective/vitesse` | Vite + Vue | 34s | ✅ runs | 1 (0 dynamic) | 1/1 ok | Fixed: Vue Router’s built-in file routing (src/pages) wasn’t read. pnpm via Easel’s tool cache. |
| bulletproof-vite | `alan2207/bulletproof-react/apps/react-vite` | Vite + React @ apps/react-vite | 66s | ✅ runs | 1 (0 dynamic) | 1/1 ok | Fixed: routes kept in a config module; lockfile pointing at an unreachable mirror (falls back to a fresh resolve). |
| bulletproof-next | `alan2207/bulletproof-react/apps/nextjs-app` | Next.js @ apps/nextjs-app | 162s | ✅ runs | 9 (2 dynamic) | 7/7 ok | Monorepo app picked from apps/. |
| fastapi-frontend | `fastapi/full-stack-fastapi-template/frontend` | Vite + React @ frontend | 20s | ✅ runs | 8 (0 dynamic) | 8/8 ok | Fixed: workspace installs hoist binaries to the repo root; TanStack pathless layouts in paths. |
| next-saas | `leerob/next-saas-starter` | Next.js | 126s | 🟡 partly | 8 (0 dynamic) | 3/8 ok, 4 redirect, 1 error | Runs (Postgres/Stripe keys stubbed). Dashboard pages redirect to sign-in; /pricing calls Stripe’s SDK (now intercepted by the Node http hook) and needs a mock rule. |
| commerce | `vercel/commerce` | Next.js | 112s | 🟡 partly | 5 (3 dynamic) | 0/2 ok, 2 error | Installs and runs (pnpm 10 picked from the lockfile format). Every page queries the Shopify Storefront API, so pages 500 until a mock rule for the GraphQL endpoint is added: the textbook “needs mocks” case. |
| nuxt-movies | `nuxt/movies` | Nuxt | 227s | ❌ sandbox only: pnpm 11 downloads Node from nodejs.org (blocked here) | 8 (6 dynamic) | — | Easel fetched Node 24 + pnpm 11.1.2 correctly; pnpm then pins its own Node runtime from nodejs.org, which this sandbox cannot reach. Expected to work on a normal machine. |
| astro-paper | `satnaing/astro-paper` | Astro | 171s | ✅ runs | 9 (3 dynamic) | 6/6 ok | Easel fetched Node 24 for it (app needs >=22.23.4). /404 answering 404 counts as correct. |
| react-router | `remix-run/react-router-templates` | Remix / React Router @ default | 102s | ✅ runs | 1 (0 dynamic) | 1/1 ok | Picked default/ from a repo of templates. |
| flask-tutorial | `pallets/flask/examples/tutorial` | Flask @ examples/tutorial | 10s | ✅ runs | 8 (2 dynamic) | 4/6 ok, 2 redirect | Fixed: explicit app folder wasn’t honoured; blueprint url_prefix; runs the app’s init-db command so pages have tables. |
| microblog | `miguelgrinberg/microblog` | Flask | 20s | ✅ runs | 20 (7 dynamic) | 3/13 ok, 10 redirect | Fixed: blueprint prefixes from register_blueprint(); POST-only views skipped; 401 API counted as “needs sign-in”. |
| django-library | `mdn/django-locallibrary-tutorial` | Django | 18s | ❌ needs Python 3.12+ (machine has 3.10) | 31 (16 dynamic) | — | Routes found. Easel fell back to fetching Python with uv; uv’s download host is blocked in this sandbox. Expected to work on a normal machine. |
| bakerydemo | `wagtail/bakerydemo` | Django | 40s | ❌ needs Python 3.12+ (machine has 3.10) | 12 (0 dynamic) | — | Routes found. Easel fell back to fetching Python with uv; uv’s download host is blocked in this sandbox. Expected to work on a normal machine. |
| laravel | `laravel/laravel` | Laravel | 2s | ⚪ routes only | 1 (0 dynamic) | — | PHP isn’t installed in this sandbox; routes parsed from routes/web.php |
