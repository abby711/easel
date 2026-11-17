import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectRepo, discoverRoutes } from '../../src/adapters/index.js';
import { fillParams } from '../../src/routes.js';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const best = (name) => detectRepo(path.join(F, name))[0];
const paths = (name) => {
  const b = best(name);
  return discoverRoutes(path.join(F, name, b.subdir), b.adapter).map((r) => r.path);
};

const cases = {
  'static-site': ['static', ['/', '/about.html', '/blog/post-1.html']],
  'vite-react': ['vite', ['/', '/about', '/users', '/users/:id']],
  'next-app': ['next', ['/', '/about', '/docs/:slug*', '/news', '/posts/:id', '/pricing']],
  'flask-app': ['flask', ['/', '/api/status', '/products', '/products/:pid']],
  'django-app': ['django', ['/', '/accounts/profile', '/admin', '/archive/:year', '/posts/:pk']],
  'rails-app': ['rails', ['/', '/about', '/admin/users', '/admin/users/:id', '/articles', '/articles/:article_id/comments', '/articles/:id', '/articles/:id/edit', '/articles/new', '/profile', '/profile/edit']],
  'laravel-app': ['laravel', ['/', '/dashboard', '/photos', '/photos/:id', '/photos/:id/edit', '/photos/create', '/terms', '/users/:user']],
  'sveltekit-app': ['sveltekit', ['/', '/blog/:slug', '/settings']],
  'nuxt-app': ['nuxt', ['/', '/about', '/users', '/users/:id']],
  'astro-app': ['astro', ['/', '/about', '/blog/:slug']],
  'remix-app': ['remix', ['/', '/*', '/about', '/login', '/users', '/users/:id']],
  'custom-app': ['custom', ['/', '/health', '/orders/:id']],
};

for (const [name, [adapter, expected]] of Object.entries(cases)) {
  test(`${name}: detects ${adapter} and its routes`, () => {
    assert.equal(best(name).adapter, adapter);
    assert.deepEqual(paths(name), expected);
  });
}

test('monorepo: finds both apps, best first', () => {
  const c = detectRepo(path.join(F, 'monorepo'));
  assert.deepEqual(c.map((x) => `${x.subdir}:${x.adapter}`), ['apps/web:next', 'apps/docs:astro']);
});

test('fillParams fills, skips optional, and refuses missing', () => {
  assert.equal(fillParams('/users/:id', { id: '7' }), '/users/7');
  assert.equal(fillParams('/docs/:slug*?', {}), '/docs');
  assert.equal(fillParams('/users/:id', {}), null);
});
