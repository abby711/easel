import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = path.resolve(process.env.EASEL_HOME || path.join(os.homedir(), '.easel'));
export const PROJECTS_DIR = path.join(HOME, 'projects');
export const VENVS_DIR = path.join(HOME, 'venvs');
export const PORT = Number(process.env.EASEL_PORT || 4800);
export const HOST = process.env.EASEL_HOST || '127.0.0.1';
export const APP_PORT_START = Number(process.env.EASEL_APP_PORT_START || 4810);

// Name of the per-workspace folder that holds mock rules and recordings.
// It lives inside the workspace so mocks travel with frame copies, and is
// excluded from exported patches.
export const MOCKS_DIR = 'easel.mocks';

for (const d of [HOME, PROJECTS_DIR, VENVS_DIR]) fs.mkdirSync(d, { recursive: true });
