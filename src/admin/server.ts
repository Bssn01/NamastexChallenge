import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { URL } from 'node:url';
import {
  type AdminActionId,
  type AdminModeRequest,
  type CommandExecutor,
  NodeCommandExecutor,
  buildAdminActionCommands,
  collectOperationsSnapshot,
  detectAdminMode,
  runPlannedCommand,
} from './commands.js';
import { loadAdminConfigSnapshot } from './env.js';
import { clearMemoryConversation, readMemorySnapshot, resetMemoryConversation } from './memory.js';

export interface StartAdminServerOptions {
  repoRoot: string;
  host?: string;
  port?: number;
  mode?: AdminModeRequest;
  open?: boolean;
  allowRemote?: boolean;
  env?: NodeJS.ProcessEnv;
  executor?: CommandExecutor;
}

export interface StartedAdminServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(body) as Record<string, unknown>);
      } catch {
        reject(new Error('Request body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function hasValidToken(req: IncomingMessage, token: string): boolean {
  const header = req.headers['x-namastex-admin-token'];
  const auth = req.headers.authorization;
  return header === token || auth === `Bearer ${token}`;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

async function snapshotPayload(
  repoRoot: string,
  requestedMode: AdminModeRequest,
  executor: CommandExecutor,
  env: NodeJS.ProcessEnv,
) {
  const [config, operations, memory] = await Promise.all([
    loadAdminConfigSnapshot(repoRoot, env),
    collectOperationsSnapshot(repoRoot, requestedMode, executor, env),
    readMemorySnapshot(repoRoot, env),
  ]);
  return { config, operations, memory };
}

function adminHtml(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Namastex Admin</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar">
    <div>
      <h1>Namastex Admin</h1>
      <p id="subtitle">Local orchestration panel</p>
    </div>
    <div class="top-actions">
      <button id="refreshBtn" type="button">Refresh</button>
    </div>
  </header>
  <main>
    <section class="grid metrics" id="metrics"></section>
    <section class="band">
      <div class="section-title">
        <h2>Services</h2>
      </div>
      <div class="toolbar">
        <button data-action="genie.serve.start">Start Genie</button>
        <button data-action="genie.serve.stop" class="danger">Stop Genie</button>
        <button data-action="genie.serve.restart">Restart Genie</button>
        <button data-action="omni.service.start">Start Omni</button>
        <button data-action="omni.service.stop" class="danger">Stop Omni</button>
        <button data-action="omni.service.restart">Restart Omni</button>
      </div>
      <div class="split">
        <pre id="serviceStatus"></pre>
        <pre id="configStatus"></pre>
      </div>
    </section>
    <section class="band">
      <div class="section-title">
        <h2>Genie</h2>
      </div>
      <div class="split">
        <div id="agents"></div>
        <div id="sessions"></div>
      </div>
    </section>
    <section class="band">
      <div class="section-title">
        <h2>Omni</h2>
      </div>
      <div id="instances" class="list"></div>
      <div class="split">
        <div id="turns"></div>
        <div id="chats"></div>
      </div>
    </section>
    <section class="band">
      <div class="section-title">
        <h2>Memory</h2>
        <button id="exportMemoryBtn" type="button">Export</button>
      </div>
      <div id="memory"></div>
    </section>
    <section class="band">
      <div class="section-title">
        <h2>Command Output</h2>
      </div>
      <pre id="output"></pre>
    </section>
  </main>
  <script>window.NAMASTEX_ADMIN_TOKEN = ${JSON.stringify(token)};</script>
  <script src="/app.js"></script>
</body>
</html>`;
}

const adminCss = `
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --ink: #18202b;
  --muted: #667085;
  --line: #d9dee7;
  --panel: #ffffff;
  --teal: #0f766e;
  --amber: #b45309;
  --rose: #be123c;
  --blue: #2563eb;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.topbar {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
  padding: 22px 28px;
  border-bottom: 1px solid var(--line);
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 2;
}
h1, h2, h3, p { margin: 0; }
h1 { font-size: 24px; font-weight: 760; letter-spacing: 0; }
h2 { font-size: 16px; letter-spacing: 0; }
h3 { font-size: 14px; margin-bottom: 8px; letter-spacing: 0; }
#subtitle { color: var(--muted); margin-top: 4px; font-size: 13px; }
main { width: min(1480px, calc(100vw - 32px)); margin: 18px auto 40px; }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.metric, .band, .item {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.metric { padding: 14px; min-height: 92px; }
.metric .label { color: var(--muted); font-size: 12px; text-transform: uppercase; }
.metric .value { margin-top: 8px; font-size: 22px; font-weight: 740; overflow-wrap: anywhere; }
.metric .detail { margin-top: 6px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.band { margin-top: 14px; padding: 16px; }
.section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
button {
  border: 1px solid #b8c2d1;
  background: #fff;
  color: var(--ink);
  border-radius: 7px;
  padding: 8px 10px;
  min-height: 36px;
  font-weight: 650;
  cursor: pointer;
}
button:hover { border-color: var(--blue); color: var(--blue); }
button.danger:hover { border-color: var(--rose); color: var(--rose); }
.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
pre {
  margin: 0;
  min-height: 96px;
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  background: #101828;
  color: #e6edf7;
  border-radius: 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.item { padding: 12px; min-width: 0; }
.item p { color: var(--muted); font-size: 12px; margin: 3px 0; overflow-wrap: anywhere; }
.item .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 9px; font-size: 13px; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--muted); font-size: 12px; text-transform: uppercase; background: #fafafa; }
.pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 12px; border: 1px solid var(--line); color: var(--muted); margin: 2px 4px 2px 0; }
.ok { color: var(--teal); }
.warn { color: var(--amber); }
.bad { color: var(--rose); }
@media (max-width: 980px) {
  .grid, .split, .list { grid-template-columns: 1fr; }
  .topbar { align-items: flex-start; flex-direction: column; }
}
`;

const adminJs = `
const token = window.NAMASTEX_ADMIN_TOKEN;
const state = { snapshot: null };
const api = async (path, options = {}) => {
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-namastex-admin-token': token,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
};
const el = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const attr = (value) => esc(value);
const text = (value) => value == null || value === '' ? '-' : esc(value);
const asArray = (value) => Array.isArray(value) ? value : [];
const parsed = (key) => state.snapshot?.operations?.commands?.[key]?.parsed;
const commandText = (key) => {
  const command = state.snapshot?.operations?.commands?.[key];
  if (!command) return '';
  return command.ok ? (command.stdout || JSON.stringify(command.parsed, null, 2) || 'ok') : command.stderr || command.stdout || 'failed';
};
function metric(label, value, detail, tone = '') {
  return '<div class="metric"><div class="label">' + text(label) + '</div><div class="value ' + tone + '">' + text(value) + '</div><div class="detail">' + text(detail) + '</div></div>';
}
function renderMetrics() {
  const ops = state.snapshot.operations;
  const tools = ops.providerStatus.tools;
  const apiProviders = ops.providerStatus.apiProviders;
  const memory = state.snapshot.memory;
  el('metrics').innerHTML = [
    metric('Mode', ops.mode, ops.dockerDetected ? 'Docker stack detected' : 'Local runtime'),
    metric('Genie', tools.genie.installed ? 'Ready' : 'Missing', tools.genie.detail || '', tools.genie.installed ? 'ok' : 'bad'),
    metric('Omni', tools.omni.installed ? 'Ready' : 'Missing', tools.omni.detail || '', tools.omni.installed ? 'ok' : 'bad'),
    metric('Providers', [
      tools.claude.installed ? 'Claude' : null,
      tools.codex.installed ? 'Codex' : null,
      apiProviders.kimiConfigured ? 'Kimi' : null,
    ].filter(Boolean).join(' + ') || 'None', 'API keys are shown as presence only', apiProviders.kimiConfigured ? 'ok' : 'warn'),
    metric('Memory', String(memory.conversations.length), memory.driver + (memory.available ? '' : ' unavailable'), memory.available ? 'ok' : 'warn'),
    metric('Store', state.snapshot.config.values.storeDriver, state.snapshot.config.values.storePath || 'Postgres'),
    metric('Missing Config', String(state.snapshot.config.missing.length), state.snapshot.config.missing.join(', ') || 'complete', state.snapshot.config.missing.length ? 'warn' : 'ok'),
    metric('Updated', new Date().toLocaleTimeString(), ops.providerStatus.generatedAt),
  ].join('');
}
function renderServices() {
  el('serviceStatus').textContent = [
    'Genie',
    commandText('genieServeStatus'),
    '',
    'Omni',
    commandText('omniStatus'),
    '',
    'Docker',
    commandText('dockerPs'),
  ].filter(Boolean).join('\\n');
  el('configStatus').textContent = JSON.stringify({
    config: state.snapshot.config.values,
    secrets: state.snapshot.config.secrets,
  }, null, 2);
}
function renderAgents() {
  const agents = asArray(parsed('genieAgents'));
  el('agents').innerHTML = '<h3>Agents</h3>' + (agents.length ? agents.map((agent) => {
    const name = agent.name || agent.id || agent.agent || '';
    return '<div class="item"><h3>' + text(name) + '</h3><p>Status: ' + text(agent.status || agent.state || agent.runtimeStatus) + '</p><p>Session: ' + text(agent.sessionId || agent.session) + '</p><div class="actions"><button data-action="genie.agent.resume" data-name="' + attr(name) + '">Resume</button><button data-action="genie.agent.stop" data-name="' + attr(name) + '" class="danger">Stop</button><button data-action="genie.agent.kill" data-name="' + attr(name) + '" class="danger">Kill</button></div></div>';
  }).join('') : '<p>No agents returned.</p>');
  const sessions = asArray(parsed('genieSessions'));
  el('sessions').innerHTML = '<h3>Sessions</h3>' + table(['ID', 'Agent', 'Status', 'Updated'], sessions.map((session) => [
    text(session.id || session.sessionId),
    text(session.agent || session.agentName || session.name),
    text(session.status || session.state),
    text(session.updatedAt || session.createdAt),
  ]));
}
function renderOmni() {
  const instances = asArray(parsed('omniInstances'));
  el('instances').innerHTML = instances.length ? instances.map((instance) => {
    const id = instance.id || '';
    return '<div class="item"><h3>' + text(instance.name || id) + '</h3><p>ID: ' + text(id) + '</p><p>Phone: ' + text(instance.phone || instance.number || instance.jid) + '</p><p>Status: ' + text(instance.status || instance.connectionStatus) + '</p><p>Agent: ' + text(instance.agentId || instance.agent) + '</p><div class="actions"><button data-action="omni.instance.qr" data-id="' + attr(id) + '">QR</button><button data-action="omni.instance.restart" data-id="' + attr(id) + '">Restart</button><button data-action="omni.instance.disconnect" data-id="' + attr(id) + '" class="danger">Disconnect</button></div></div>';
  }).join('') : '<p>No Omni instances returned.</p>';
  const turns = asArray(parsed('omniTurns'));
  el('turns').innerHTML = '<h3>Turns</h3><div class="toolbar"><button data-action="omni.turn.closeAll" class="danger">Close All Open</button></div>' + table(['ID', 'Status', 'Chat', 'Agent', ''], turns.map((turn) => [
    text(turn.id),
    text(turn.status),
    text(turn.chatId || turn.chat),
    text(turn.agentId || turn.agent),
    turn.id ? '<button data-action="omni.turn.close" data-id="' + attr(turn.id) + '">Close</button>' : '',
  ]));
  const chats = asArray(parsed('omniChats'));
  el('chats').innerHTML = '<h3>Chats</h3>' + table(['ID', 'Name', 'Unread', 'Updated'], chats.map((chat) => [
    text(chat.id || chat.chatId),
    text(chat.name || chat.title || chat.pushName),
    text(chat.unreadCount || chat.unread || 0),
    text(chat.updatedAt || chat.lastMessageAt),
  ]));
}
function renderMemory() {
  const rows = state.snapshot.memory.conversations.map((conversation) => [
    text(conversation.conversationKey),
    text(conversation.activeSessionId),
    String(conversation.dossierCount),
    String(conversation.researchRunCount),
    String(conversation.monitorCount),
    conversation.topics.map((topic) => '<span class="pill">' + text(topic) + '</span>').join(''),
    '<button data-memory-reset="' + attr(conversation.conversationKey) + '">Reset Session</button> <button data-memory-clear="' + attr(conversation.conversationKey) + '" class="danger">Clear</button>',
  ]);
  el('memory').innerHTML = table(['Conversation', 'Session', 'Dossiers', 'Runs', 'Monitors', 'Topics', ''], rows);
}
function table(headers, rows) {
  if (!rows.length) return '<p>No rows.</p>';
  return '<table><thead><tr>' + headers.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
function renderAll() {
  renderMetrics();
  renderServices();
  renderAgents();
  renderOmni();
  renderMemory();
}
async function refresh() {
  el('output').textContent = 'Refreshing...';
  state.snapshot = await api('/api/snapshot');
  renderAll();
  el('output').textContent = 'Ready.';
}
async function runAction(action, payload = {}) {
  el('output').textContent = 'Running ' + action + '...';
  const result = await api('/api/action', { method: 'POST', body: JSON.stringify({ action, payload }) });
  el('output').textContent = JSON.stringify(result, null, 2);
  await refresh();
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  try {
    if (target.id === 'refreshBtn') {
      await refresh();
      return;
    }
    if (target.id === 'exportMemoryBtn') {
      const result = await api('/api/memory/export');
      el('output').textContent = JSON.stringify(result, null, 2);
      return;
    }
    const memoryReset = target.getAttribute('data-memory-reset');
    if (memoryReset) {
      const result = await api('/api/memory/reset', { method: 'POST', body: JSON.stringify({ conversationKey: memoryReset }) });
      el('output').textContent = JSON.stringify(result, null, 2);
      await refresh();
      return;
    }
    const memoryClear = target.getAttribute('data-memory-clear');
    if (memoryClear) {
      const confirmText = prompt('Type CLEAR MEMORY to remove this conversation memory.');
      const result = await api('/api/memory/clear', { method: 'POST', body: JSON.stringify({ conversationKey: memoryClear, confirm: confirmText }) });
      el('output').textContent = JSON.stringify(result, null, 2);
      await refresh();
      return;
    }
    const action = target.getAttribute('data-action');
    if (action) {
      const payload = { id: target.getAttribute('data-id'), name: target.getAttribute('data-name') };
      if (action === 'omni.turn.closeAll') payload.confirm = prompt('Type CLOSE ALL to close all open turns.');
      await runAction(action, payload);
    }
  } catch (error) {
    el('output').textContent = error.message || String(error);
  }
});
refresh().catch((error) => {
  el('output').textContent = error.message || String(error);
});
`;

export async function startAdminServer(
  options: StartAdminServerOptions,
): Promise<StartedAdminServer> {
  const host = options.host || '127.0.0.1';
  if (!options.allowRemote && !isLoopbackHost(host)) {
    throw new Error('Admin panel only binds to loopback unless --allow-remote is passed.');
  }
  const repoRoot = options.repoRoot;
  const requestedMode = options.mode || 'auto';
  const executor = options.executor || new NodeCommandExecutor();
  const env = options.env || process.env;
  const token = randomBytes(24).toString('hex');
  const detected = await detectAdminMode(repoRoot, requestedMode, executor);
  const mode = requestedMode === 'auto' ? detected.mode : requestedMode;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        sendText(res, 200, adminHtml(token), 'text/html; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && url.pathname === '/styles.css') {
        sendText(res, 200, adminCss, 'text/css; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && url.pathname === '/app.js') {
        sendText(res, 200, adminJs, 'application/javascript; charset=utf-8');
        return;
      }
      if (url.pathname.startsWith('/api/') && !hasValidToken(req, token)) {
        sendJson(res, 401, { error: 'Invalid admin token.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        sendJson(res, 200, await snapshotPayload(repoRoot, mode, executor, env));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/memory/export') {
        sendJson(res, 200, await readMemorySnapshot(repoRoot, env, { includeRaw: true }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const body = await readBody(req);
        const action = body.action;
        if (typeof action !== 'string') throw new Error('Missing action.');
        const payload =
          body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
            ? (body.payload as Record<string, unknown>)
            : {};
        const commands = buildAdminActionCommands(repoRoot, mode, action as AdminActionId, payload);
        const results = [];
        for (const command of commands) {
          results.push(await runPlannedCommand(executor, command, env));
        }
        sendJson(res, 200, { action, results });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/memory/reset') {
        const body = await readBody(req);
        if (typeof body.conversationKey !== 'string') throw new Error('Missing conversationKey.');
        sendJson(res, 200, await resetMemoryConversation(repoRoot, body.conversationKey, env));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/memory/clear') {
        const body = await readBody(req);
        if (typeof body.conversationKey !== 'string') throw new Error('Missing conversationKey.');
        const confirm = typeof body.confirm === 'string' ? body.confirm : '';
        sendJson(
          res,
          200,
          await clearMemoryConversation(repoRoot, body.conversationKey, confirm, env),
        );
        return;
      }
      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(options.port || 0, host, () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not resolve admin server port.');
  const url = `http://${host}:${address.port}/`;
  if (options.open !== false) openBrowser(url);
  return {
    url,
    token,
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}
