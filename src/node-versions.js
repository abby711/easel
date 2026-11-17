// Per-app Node versions. When an app asks for a Node that this machine doesn't have
// (engines.node, devEngines, .nvmrc), Easel fetches a matching official Node binary
// from the npm registry (node-<platform>-<arch> packages) into EASEL_HOME/node/<version>
// and puts it first on PATH for that app's install and dev server. No nvm needed.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './config.js';
import { run, exists } from './util.js';

const NODE_DIR = path.join(HOME, 'node');

function platformPackage() {
  const plat = process.platform === 'win32' ? 'win' : process.platform; // darwin | linux | win
  const arch = process.arch; // arm64 | x64
  return `node-${plat}-${arch}`;
}

/** Normalise .nvmrc-style values ("v24", "24.1", "lts/*") into an npm semver range. */
function toRange(wanted) {
  const w = String(wanted).trim();
  if (/^v?\d+(\.\d+)?$/.test(w)) return '^' + w.replace(/^v/, '') + (w.split('.').length === 1 ? '.0.0' : '.0');
  if (/^lts|^node|^stable/i.test(w)) return '*';
  return w.replace(/^v/, '');
}

/** Already-downloaded versions, newest first. */
function installed() {
  try {
    return fs.readdirSync(NODE_DIR).filter((v) => exists(binOf(v))).sort((a, b) => cmpVer(b, a));
  } catch {
    return [];
  }
}
const binDirOf = (version) => path.join(NODE_DIR, version, 'node_modules', platformPackage(), 'bin');
const binOf = (version) => path.join(binDirOf(version), process.platform === 'win32' ? 'node.exe' : 'node');
function cmpVer(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/**
 * Return {version, binDir} for a Node satisfying `wanted`, downloading it if needed.
 * `satisfies(version)` decides whether an already-downloaded version is good enough.
 */
export async function ensureNode(wanted, { satisfies, onLine = () => {} } = {}) {
  const have = installed().find((v) => satisfies?.(v));
  if (have) return { version: have, binDir: binDirOf(have) };
  const pkg = platformPackage();
  const range = toRange(wanted);
  onLine(`Looking up Node ${range} (${pkg})…`);
  const view = await run('npm', ['view', `${pkg}@${range}`, 'version', '--json'], { timeout: 60000 });
  if (view.code !== 0) throw new Error(`No Node build matching ${wanted} for ${process.platform}/${process.arch}.`);
  let versions;
  try {
    versions = [].concat(JSON.parse(view.out.trim().split('\n').filter((l) => !/^npm (warn|notice)/.test(l)).join('\n')));
  } catch {
    versions = [view.out.trim().replace(/"/g, '')];
  }
  const version = versions.filter(Boolean).sort(cmpVer).pop();
  if (!version) throw new Error(`No Node build matching ${wanted}.`);
  const prefix = path.join(NODE_DIR, version);
  onLine(`Downloading Node ${version} for this app (one time)…`);
  fs.mkdirSync(prefix, { recursive: true });
  const r = await run('npm', ['install', '--prefix', prefix, `${pkg}@${version}`, '--no-audit', '--no-fund', '--no-save', '--loglevel=error'], { onLine, timeout: 10 * 60 * 1000 });
  if (r.code !== 0 || !exists(binOf(version))) throw new Error(`Could not download Node ${version}: ${r.out.trim().split('\n').slice(-2).join(' ')}`);
  return { version, binDir: binDirOf(version) };
}
