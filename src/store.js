// JSON-file persistence. One folder per project under EASEL_HOME/projects.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS_DIR } from './config.js';
import { readJSON, writeJSON, rmrf } from './util.js';

const pdir = (id) => path.join(PROJECTS_DIR, id);

export const paths = {
  project: (id) => pdir(id),
  repo: (id) => path.join(pdir(id), 'repo'),
  copies: (id) => path.join(pdir(id), 'copies'),
  copy: (id, wid) => path.join(pdir(id), 'copies', wid),
  exports: (id) => path.join(pdir(id), 'exports'),
};

export const store = {
  listProjects() {
    let ids = [];
    try {
      ids = fs.readdirSync(PROJECTS_DIR);
    } catch {
      return [];
    }
    return ids
      .map((id) => readJSON(path.join(pdir(id), 'project.json')))
      .filter(Boolean)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  getProject(id) {
    return readJSON(path.join(pdir(id), 'project.json'));
  },
  saveProject(p) {
    p.updatedAt = Date.now();
    writeJSON(path.join(pdir(p.id), 'project.json'), p);
    return p;
  },
  patchProject(id, patch) {
    const p = this.getProject(id);
    if (!p) return null;
    Object.assign(p, patch);
    return this.saveProject(p);
  },
  async deleteProject(id) {
    await rmrf(pdir(id));
  },
  getWorkspaces(pid) {
    return readJSON(path.join(pdir(pid), 'workspaces.json'), []);
  },
  saveWorkspaces(pid, list) {
    writeJSON(path.join(pdir(pid), 'workspaces.json'), list);
  },
  getWorkspace(wid) {
    for (const p of this.listProjects()) {
      const w = this.getWorkspaces(p.id).find((x) => x.id === wid);
      if (w) return w;
    }
    return null;
  },
  getBoards(pid) {
    return readJSON(path.join(pdir(pid), 'boards.json'), []);
  },
  saveBoards(pid, boards) {
    writeJSON(path.join(pdir(pid), 'boards.json'), boards);
  },
};
