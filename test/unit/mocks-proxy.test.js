import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { MockEngine, emptied } from '../../src/mocks.js';
import { createProxy, injectTag } from '../../src/proxy.js';
import { extractTokens, normColor } from '../../src/tokens.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'easel-test-'));

test('emptied() empties every array, keeps the shape', () => {
  assert.deepEqual(emptied({ a: [1, 2], b: { c: [3], d: 'x' }, n: 4 }), { a: [], b: { c: [], d: 'x' }, n: 4 });
});

test('mock engine: rules, derived states, same-origin paths', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'easel.mocks'));
  fs.writeFileSync(path.join(dir, 'easel.mocks', 'api.json'), JSON.stringify({
    rules: [
      { id: 'users', match: { method: 'GET', url: 'https://api.example.com/users*' }, states: { default: { json: { users: [{ id: 1 }] } }, vip: { json: { users: [{ id: 99 }] } } } },
      { id: 'me', match: { path: '/api/me' }, response: { json: { name: 'Ada' } } },
    ],
  }));
  const m = new MockEngine(dir);
  const get = async (state, url = 'https://api.example.com/users?page=2') => m.handleNet({ method: 'GET', url, headers: {}, state });
  assert.deepEqual(JSON.parse((await get('default')).body), { users: [{ id: 1 }] });
  assert.deepEqual(JSON.parse((await get('vip')).body), { users: [{ id: 99 }] });
  assert.deepEqual(JSON.parse((await get('empty')).body), { users: [] });
  assert.equal((await get('error')).status, 500);
  assert.equal((await get('loading')).hang, true);
  assert.equal((await get('offline')).networkError, true);
  assert.equal((await get('slow')).delay, 3000);
  assert.deepEqual(JSON.parse(m.handleSameOrigin('GET', '/api/me', 'default').body), { name: 'Ada' });
  assert.equal(m.handleSameOrigin('GET', '/api/other', 'default'), null);
  assert.ok(m.states().includes('vip'));
  // replay mode refuses unknown URLs instead of going live
  m.setMode('replay');
  assert.equal((await get('default', 'https://unknown.example.com/x')).status, 504);
  m.close();
});

test('injectTag puts the runtime first in <head>', () => {
  assert.match(injectTag('<!doctype html><html><head><script src="a.js"></script></head></html>'), /<head><script src="\/__easel\/runtime\.js" data-easel><\/script><script src="a\.js">/);
  assert.match(injectTag('<p>hi</p>'), /^<script src="\/__easel\/runtime\.js"/);
});

test('proxy: injects into upstream HTML, strips frame-blocking headers, passes other content', async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
      res.end('<html><head><title>x</title></head><body>hello</body></html>');
    } else if (req.url === '/api/data') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"real":true}');
    } else {
      res.writeHead(302, { location: `http://127.0.0.1:${upstream.address().port}/` });
      res.end();
    }
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const dir = tmp();
  const mocks = new MockEngine(dir);
  const proxy = createProxy({ instanceId: 't', mocks, target: { port: upstream.address().port } });
  const server = proxy.server;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(base + '/', { headers: { accept: 'text/html' } });
  const html = await res.text();
  assert.ok(html.includes('/__easel/runtime.js'));
  assert.equal(res.headers.get('x-frame-options'), null);
  assert.equal(res.headers.get('content-security-policy'), null);
  assert.deepEqual(await (await fetch(base + '/api/data')).json(), { real: true });
  const redir = await fetch(base + '/elsewhere', { redirect: 'manual' });
  assert.equal(redir.headers.get('location'), `${base}/`);
  const rt = await (await fetch(base + '/__easel/runtime.js')).text();
  assert.match(rt, /__EASEL_CONFIG__/);
  // a same-origin mock overrides the real backend
  fs.mkdirSync(path.join(dir, 'easel.mocks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'easel.mocks', 'a.json'), JSON.stringify({ match: { path: '/api/data' }, response: { json: { mocked: true } } }));
  mocks.load();
  assert.deepEqual(await (await fetch(base + '/api/data')).json(), { mocked: true });
  await proxy.close();
  upstream.close();
  mocks.close();
});

test('tokens: css variables, colours, fonts', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.css'), ':root{--brand:#E15001;--gap:8px}\n.b{color:var(--brand);background:rgb(255,255,255);font-family:"Inter",sans-serif;padding:8px 16px}');
  const t = extractTokens(dir);
  assert.equal(t.vars.find((v) => v.name === '--brand').kind, 'color');
  assert.equal(t.vars.find((v) => v.name === '--brand').uses, 1);
  assert.ok(t.colors.some((c) => c.value === '#e15001'));
  assert.ok(t.colors.some((c) => c.value === '#ffffff'));
  assert.equal(t.fonts[0].value, 'Inter');
  assert.equal(normColor('rgba(0, 0, 0, 0.5)'), '#00000080');
});
