// A stdio MCP server so coding agents (Claude Code, Codex, Cursor...) can drive Easel.
// Newline-delimited JSON-RPC 2.0. It talks to a running Easel server over HTTP.
// This is also where AI plugs in later: the agent does the thinking, Easel does the running.
import readline from 'node:readline';

const BASE = process.env.EASEL_URL || 'http://127.0.0.1:4800';

async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });

const TOOLS = [
  { name: 'easel_projects_list', description: 'List Easel projects (repos on the canvas) with stack and status.', inputSchema: S({}), run: () => api('GET', '/api/projects') },
  { name: 'easel_project_add', description: 'Add a repo to Easel: a git URL, owner/repo on GitHub, or a local folder path. Setup runs in the background.', inputSchema: S({ source: str('git URL, owner/repo, or folder path'), name: str('display name'), branch: str('branch'), subdir: str('app folder inside a monorepo') }, ['source']), run: (a) => api('POST', '/api/projects', a) },
  { name: 'easel_project_get', description: 'A project with its setup steps, routes, workspaces (Library + copies, with preview URLs) and boards.', inputSchema: S({ projectId: str('project id') }, ['projectId']), run: (a) => api('GET', `/api/projects/${a.projectId}`) },
  { name: 'easel_routes_list', description: "A project's discovered routes (dynamic ones have :params).", inputSchema: S({ projectId: str('project id') }, ['projectId']), run: (a) => api('GET', `/api/projects/${a.projectId}/routes`) },
  { name: 'easel_frame_copy', description: 'Make a frame copy: a separate checkout of the code with its own running dev server. Edit it freely; export its changes as a patch.', inputSchema: S({ projectId: str('project id'), from: str('workspace id to copy (default Library)'), name: str('name for the copy') }, ['projectId']), run: (a) => api('POST', `/api/projects/${a.projectId}/workspaces`, { from: a.from, name: a.name }) },
  { name: 'easel_board_add_frame', description: 'Put a frame (a live view of one route of one workspace) on a board.', inputSchema: S({ projectId: str('project id'), boardId: str('board id (default Library)'), workspaceId: str('workspace id'), route: str('route path, e.g. /users/1'), state: str('mock state: default, empty, error, slow, loading, offline or a custom one'), viewport: str('desktop | laptop | tablet | mobile'), label: str('label') }, ['projectId', 'workspaceId', 'route']), run: async (a) => {
    const { boards } = await api('GET', `/api/projects/${a.projectId}`);
    const b = boards.find((x) => x.id === a.boardId) || boards[0];
    const vps = await api('GET', '/api/viewports');
    const vp = vps[a.viewport || 'desktop'] || vps.desktop;
    const maxX = b.frames.reduce((m, f) => Math.max(m, f.x + f.w), 0);
    const frame = { id: 'f' + Math.random().toString(16).slice(2, 10), workspaceId: a.workspaceId, route: a.route, state: a.state || 'default', viewport: a.viewport || 'desktop', w: vp.w, h: vp.h, x: b.frames.length ? maxX + 160 : 0, y: 0, label: a.label || a.route };
    return api('PUT', `/api/projects/${a.projectId}/boards/${b.id}`, { frames: [...b.frames, frame] });
  } },
  { name: 'easel_files_list', description: 'List source files in a workspace.', inputSchema: S({ workspaceId: str('workspace id') }, ['workspaceId']), run: (a) => api('GET', `/api/workspaces/${a.workspaceId}/files`) },
  { name: 'easel_file_read', description: 'Read a file from a workspace.', inputSchema: S({ workspaceId: str('workspace id'), path: str('path relative to the app folder') }, ['workspaceId', 'path']), run: (a) => api('GET', `/api/workspaces/${a.workspaceId}/file?path=${encodeURIComponent(a.path)}`) },
  { name: 'easel_file_write', description: "Write a file in a workspace (use a frame copy, not the Library). The app's hot reload updates its frames.", inputSchema: S({ workspaceId: str('workspace id'), path: str('path relative to the app folder'), content: str('full file content') }, ['workspaceId', 'path', 'content']), run: (a) => api('PUT', `/api/workspaces/${a.workspaceId}/file`, { path: a.path, content: a.content }) },
  { name: 'easel_find_in_code', description: 'Find where text, class names or ids appear in the code (file:line).', inputSchema: S({ workspaceId: str('workspace id'), terms: { type: 'array', items: { type: 'string' } } }, ['workspaceId', 'terms']), run: (a) => api('GET', `/api/workspaces/${a.workspaceId}/find?` + a.terms.map((t) => 'q=' + encodeURIComponent(t)).join('&')) },
  { name: 'easel_changes_get', description: "A workspace's changes vs. where it started: format diff (unified) or patch (mbox for git am).", inputSchema: S({ workspaceId: str('workspace id'), format: { type: 'string', enum: ['diff', 'patch'] } }, ['workspaceId']), run: async (a) => {
    const r = await fetch(`${BASE}/api/workspaces/${a.workspaceId}/export?format=${a.format || 'diff'}`);
    return r.text();
  } },
  { name: 'easel_patch_apply', description: 'Apply a unified diff (e.g. your local working-tree changes) onto a workspace.', inputSchema: S({ workspaceId: str('workspace id'), patch: str('unified diff text') }, ['workspaceId', 'patch']), run: (a) => api('POST', `/api/workspaces/${a.workspaceId}/apply`, { patch: a.patch }) },
  { name: 'easel_mocks_get', description: "A workspace's mock rules, recordings, states and the recent request log (what the app called and how it was answered).", inputSchema: S({ workspaceId: str('workspace id') }, ['workspaceId']), run: (a) => api('GET', `/api/workspaces/${a.workspaceId}/mocks`) },
  { name: 'easel_mock_set', description: 'Write a mock rule file (easel.mocks/<name>.json). Shape: {"rules":[{"id","match":{"method","url"|"path"},"states":{"default":{"status","json"|"text","delay"},"empty":{...}}}]}', inputSchema: S({ workspaceId: str('workspace id'), name: str('file name ending in .json'), content: { type: 'object' } }, ['workspaceId', 'name', 'content']), run: (a) => api('PUT', `/api/workspaces/${a.workspaceId}/mocks/file`, { name: a.name, content: a.content }) },
  { name: 'easel_design_get', description: "The project's design system: CSS variables, colours, fonts, sizes, spacing, Tailwind usage, components with file:line/props/usage, and styles measured on rendered pages.", inputSchema: S({ projectId: str('project id'), workspaceId: str('workspace (default Library)') }, ['projectId']), run: (a) => api('GET', `/api/projects/${a.projectId}/design${a.workspaceId ? '?ws=' + a.workspaceId : ''}`) },
  { name: 'easel_logs_get', description: "A workspace's dev-server logs (last 600 lines).", inputSchema: S({ workspaceId: str('workspace id') }, ['workspaceId']), run: (a) => api('GET', `/api/workspaces/${a.workspaceId}/logs`) },
];

export function startMcp() {
  const rl = readline.createInterface({ input: process.stdin });
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  rl.on('line', async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = msg;
    const reply = (result) => id != null && send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => id != null && send({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'easel', version: '0.1.0' }, instructions: 'Easel puts a running app on a canvas. Use frame copies for changes; export with easel_changes_get.' });
      if (method === 'ping') return reply({});
      if (method === 'tools/list') return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      if (method === 'tools/call') {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return fail(-32602, 'Unknown tool ' + params?.name);
        try {
          const out = await tool.run(params.arguments || {});
          return reply({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return reply({ content: [{ type: 'text', text: `Error: ${e.message}. Is Easel running at ${BASE}?` }], isError: true });
        }
      }
      if (method?.startsWith('notifications/')) return undefined;
      return fail(-32601, 'Method not found: ' + method);
    } catch (e) {
      return fail(-32603, e.message);
    }
  });
}

export { TOOLS };
