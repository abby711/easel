// Regression tests for fixes found by running real public repos (see test/public-repos-report.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fillParams } from '../../src/routes.js';
import { nodeRequirement, nodeInstall } from '../../src/adapters/node.js';
import { flaskRoutes } from '../../src/adapters/python.js';
import { makeCtx } from '../../src/adapters/context.js';

const tmp = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'easel-h-'));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
};

test('fillParams handles a param inside a segment (SvelteKit /profile/@[user])', () => {
  assert.equal(fillParams('/profile/@:user', { user: 'ada' }), '/profile/@ada');
  assert.equal(fillParams('/profile/@:user', {}), null);
});

test('nodeRequirement understands common engine ranges', () => {
  const ctx = (v) => ({ pkg: { engines: { node: v } }, read: () => '' });
  assert.equal(nodeRequirement(ctx('^24.0.0'), '22.23.2').ok, false);
  assert.equal(nodeRequirement(ctx('^24.0.0'), '24.22.3').ok, true);
  assert.equal(nodeRequirement(ctx('>=22.23.4'), '22.23.2').ok, false);
  assert.equal(nodeRequirement(ctx('18 || 20 || 22'), '22.1.0').ok, true);
  assert.equal(nodeRequirement({ pkg: { devEngines: { runtime: { name: 'node', version: '^24' } } }, read: () => '' }, '22.0.0').ok, false);
});

test('pnpm version follows packageManager, else the lockfile format; builds never fail the install', () => {
  const a = makeCtx(tmp({ 'package.json': JSON.stringify({ packageManager: 'pnpm@11.1.2+sha512.x' }), 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }));
  assert.match(nodeInstall(a)[0].label + nodeInstall(a)[0].fallbacks.map((f) => f.label).join(), /pnpm@11\.1\.2/);
  const b = makeCtx(tmp({ 'package.json': '{}', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }));
  const steps = [nodeInstall(b)[0], ...nodeInstall(b)[0].fallbacks];
  assert.ok(steps.some((s) => /pnpm@10/.test(s.label)));
  assert.ok(steps.some((s) => (s.args || []).join(' ').includes('strict-dep-builds=false')));
  assert.ok(steps.some((s) => s.label === 'npm install (ignoring lockfiles)'));
});

test('flask: blueprint prefixes (declared and at registration), POST-only views skipped', () => {
  const d = tmp({
    'app/__init__.py': 'from flask import Flask\nfrom app.api import bp as api_bp\napp = Flask(__name__)\napp.register_blueprint(api_bp, url_prefix="/api")\n',
    'app/api/__init__.py': 'from flask import Blueprint\nbp = Blueprint("api", __name__)\n',
    'app/api/users.py': 'from app.api import bp\n@bp.route("/users")\ndef users(): pass\n@bp.route("/users", methods=["POST"])\ndef create(): pass\n',
    'app/auth.py': 'from flask import Blueprint\nbp = Blueprint("auth", __name__, url_prefix="/auth")\n@bp.route("/login", methods=("GET", "POST"))\ndef login(): pass\n',
    'app/blog.py': 'from flask import Blueprint\nbp = Blueprint("blog", __name__)\n@bp.route("/create")\ndef create(): pass\n',
  });
  const paths = flaskRoutes(makeCtx(d)).map((r) => r.path).sort();
  assert.deepEqual(paths, ['/api/users', '/auth/login', '/create']);
});

test('node_modules/.bin is found in a parent folder (workspace hoisting)', () => {
  const d = tmp({ 'node_modules/.bin/vite': '#!/bin/sh\n', 'frontend/package.json': '{}' });
  assert.equal(makeCtx(path.join(d, 'frontend')).bin('vite'), path.join(d, 'node_modules', '.bin', 'vite'));
});
