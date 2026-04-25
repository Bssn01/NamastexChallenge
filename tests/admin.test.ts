import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  authCommandToShell,
  buildProviderAuthCommand,
  buildTerminalLaunchCommand,
} from '../src/admin/auth.js';
import { parseAdminCliArgs } from '../src/admin/cli.js';
import {
  type CommandExecutor,
  type ExecResult,
  buildAdminActionCommands,
} from '../src/admin/commands.js';
import { redactEnv, upsertEnvValue } from '../src/admin/env.js';
import {
  clearMemoryConversation,
  readMemorySnapshot,
  resetMemoryConversation,
} from '../src/admin/memory.js';
import { startAdminServer } from '../src/admin/server.js';
import type { GenieStoreSnapshot } from '../src/store/genie-research-store.js';

class FakeExecutor implements CommandExecutor {
  calls: { file: string; args: string[] }[] = [];

  async run(file: string, args: string[]): Promise<ExecResult> {
    this.calls.push({ file, args });
    if (file === 'docker' && args.includes('ps')) {
      return { stdout: '[]', stderr: '', exitCode: 0 };
    }
    return { stdout: 'ok', stderr: '', exitCode: 0 };
  }
}

test('admin auth commands map local and docker providers', () => {
  assert.deepEqual(buildProviderAuthCommand('claude', 'local'), { file: 'claude', args: [] });
  assert.deepEqual(buildProviderAuthCommand('codex', 'local'), {
    file: 'codex',
    args: ['login'],
  });
  const dockerClaudeAuth = buildProviderAuthCommand('claude', 'docker');
  assert.equal(dockerClaudeAuth?.file, 'sh');
  assert.match(dockerClaudeAuth?.args.join(' ') || '', /docker compose/);
  assert.match(dockerClaudeAuth?.args.join(' ') || '', /docker-compose/);
  assert.match(
    dockerClaudeAuth?.args.join(' ') || '',
    /'exec' '-it' '-u' 'appuser' 'genie' 'claude'/,
  );
  assert.equal(buildProviderAuthCommand('kimi', 'local'), undefined);

  const shell = authCommandToShell({ file: 'codex', args: ['login'] }, '/tmp/app path');
  assert.equal(shell, "cd '/tmp/app path' && 'codex' 'login'");
  assert.equal(
    authCommandToShell({ file: 'codex', args: ['login'] }, 'C:\\repo path', 'win32'),
    'cd /d "C:\\repo path" && "codex" "login"',
  );
  const launcher = buildTerminalLaunchCommand('darwin', shell);
  assert.equal(launcher?.file, 'osascript');
});

test('admin action mapping is whitelisted and mode-aware', () => {
  const dockerRestart = buildAdminActionCommands('/repo', 'docker', 'genie.serve.restart')[0];
  assert.equal(dockerRestart?.label, 'genie restart');
  assert.equal(dockerRestart?.file, 'sh');
  assert.equal(dockerRestart?.cwd, '/repo');
  assert.equal(dockerRestart?.timeoutMs, 20000);
  assert.match(dockerRestart?.args.join(' ') || '', /docker compose/);
  assert.match(dockerRestart?.args.join(' ') || '', /docker-compose/);
  assert.match(dockerRestart?.args.join(' ') || '', /'restart' 'genie'/);
  assert.deepEqual(
    buildAdminActionCommands('/repo', 'local', 'omni.instance.restart', { id: 'abc' })[0]?.args,
    ['instances', 'restart', 'abc'],
  );
  assert.throws(() => buildAdminActionCommands('/repo', 'local', 'omni.turn.closeAll'));
});

test('admin server requires token and only binds remote with explicit opt-in', async () => {
  await assert.rejects(
    () =>
      startAdminServer({
        repoRoot: '/tmp',
        host: '0.0.0.0',
        open: false,
        executor: new FakeExecutor(),
      }),
    /loopback/,
  );

  const server = await startAdminServer({
    repoRoot: '/tmp',
    open: false,
    executor: new FakeExecutor(),
    mode: 'local',
  });
  try {
    const unauthorized = await fetch(`${server.url}api/snapshot`);
    assert.equal(unauthorized.status, 401);

    const action = await fetch(`${server.url}api/action`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-namastex-admin-token': server.token,
      },
      body: JSON.stringify({ action: 'genie.serve.start' }),
    });
    assert.equal(action.status, 200);
  } finally {
    await server.close();
  }
});

test('admin env helpers redact secrets and preserve dotenv updates', async () => {
  assert.deepEqual(redactEnv({ GITHUB_TOKEN: 'ghp_1234567890', NAMASTEX_STORE_DRIVER: 'json' }), {
    GITHUB_TOKEN: 'ghp_...7890',
    NAMASTEX_STORE_DRIVER: 'json',
  });

  const dir = await mkdtemp(join(tmpdir(), 'namastex-admin-env-'));
  const envPath = join(dir, '.env');
  try {
    await writeFile(envPath, 'GITHUB_TOKEN=old\n# comment\n', 'utf8');
    await upsertEnvValue(envPath, 'OPENROUTER_API_KEY', 'sk-or-test');
    await upsertEnvValue(envPath, 'GITHUB_TOKEN', 'new');
    assert.equal(
      await readFile(envPath, 'utf8'),
      'GITHUB_TOKEN=new\n# comment\n\nOPENROUTER_API_KEY=sk-or-test\n',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('json memory snapshot supports summarize reset and clear per conversation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'namastex-admin-memory-'));
  const storePath = join(dir, 'store.json');
  const env = {
    NAMASTEX_STORE_DRIVER: 'json',
    NAMASTEX_STORE_PATH: storePath,
    GITHUB_TOKEN: 'token',
    NAMASTEX_LLM_PRIMARY: 'claude-cli',
  };
  const snapshot: GenieStoreSnapshot = {
    version: 2,
    sessionId: 'session-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dossiers: [
      {
        id: 'dossier-a',
        conversationKey: 'omni:alice',
        sessionId: 'session-a',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        rawIdeaText: 'A',
        mainTopic: 'Agents',
        topicGroups: [],
        researchRuns: [
          {
            id: 'run-a',
            dossierId: 'dossier-a',
            createdAt: '2026-01-02T00:00:00.000Z',
            sessionId: 'session-a',
            conversationKey: 'omni:alice',
            groupResults: [],
            crossGroupSummary: 'ok',
            notes: [],
          },
        ],
        repoAssessments: [],
        notes: [],
      },
      {
        id: 'dossier-b',
        conversationKey: 'omni:bob',
        sessionId: 'session-b',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        rawIdeaText: 'B',
        mainTopic: 'Support',
        topicGroups: [],
        researchRuns: [],
        repoAssessments: [],
        notes: [],
      },
    ],
    monitorSubscriptions: [],
    records: [],
    tasks: [],
    events: [],
  };

  try {
    await writeFile(storePath, JSON.stringify(snapshot), 'utf8');
    const memory = await readMemorySnapshot(dir, env);
    assert.equal(memory.driver, 'json');
    assert.equal(memory.conversations.length, 2);
    assert.equal(memory.conversations[0]?.conversationKey, 'omni:alice');
    assert.equal(memory.conversations[0]?.researchRunCount, 1);

    const reset = await resetMemoryConversation(dir, 'omni:alice', env);
    assert.match(reset.sessionId, /^omni:alice:session:/);

    await clearMemoryConversation(dir, 'omni:alice', 'CLEAR MEMORY', env);
    const afterClear = await readMemorySnapshot(dir, env);
    assert.deepEqual(
      afterClear.conversations.map((conversation) => conversation.conversationKey),
      ['omni:bob'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('admin cli parser handles mode host port and browser flags', () => {
  assert.deepEqual(
    parseAdminCliArgs(['--mode=docker', '--host', 'localhost', '--port', '7777', '--no-open']),
    {
      host: 'localhost',
      port: 7777,
      open: false,
      mode: 'docker',
      allowRemote: false,
    },
  );
  assert.throws(() => parseAdminCliArgs(['--port', '99999']), /Port/);
});
