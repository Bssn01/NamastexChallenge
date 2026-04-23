import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOmniText } from '../scripts/omni-turn.js';
import {
  buildClaudeTurnPrompt,
  parseClaudeTurnOutput,
  resolveTurnExecutor,
  runClaudeTurn,
} from '../src/turn-execution.js';

test('omni turn extracts text from argv first', () => {
  const text = extractOmniText(['/pesquisar', 'genie omni'], {
    OMNI_MESSAGE: '{"text":"ignored"}',
  });

  assert.equal(text, '/pesquisar genie omni');
});

test('omni turn extracts text from json payload env', () => {
  const text = extractOmniText([], {
    OMNI_MESSAGE: JSON.stringify({ message: { text: '/wiki agentes' } }),
  });

  assert.equal(text, '/wiki agentes');
});

test('omni turn extracts text from json argv payload', () => {
  const text = extractOmniText([JSON.stringify({ message: { text: '/pesquisar agentes' } })], {});

  assert.equal(text, '/pesquisar agentes');
});

test('turn executor defaults to claude in real mode', () => {
  assert.equal(resolveTurnExecutor({ NAMASTEX_MODE: 'real' }), 'claude');
});

test('turn executor defaults to local in mock mode', () => {
  assert.equal(resolveTurnExecutor({ NAMASTEX_MODE: 'mock' }), 'local');
});

test('claude turn prompt delegates to local turn script', () => {
  const prompt = buildClaudeTurnPrompt('/pesquisar agentes');

  assert.match(prompt, /npm run local:turn -- --json/);
  assert.match(prompt, /Return exactly the stdout/);
});

test('claude turn output parser accepts fenced json payloads', () => {
  const reply = parseClaudeTurnOutput(
    [
      '```json',
      '{"command":"/wiki","chunks":["Wiki: agentes"],"metadata":{"ok":true}}',
      '```',
    ].join('\n'),
  );

  assert.equal(reply.command, '/wiki');
  assert.deepEqual(reply.chunks, ['Wiki: agentes']);
});

test('claude turn shells out with local executor handoff', async () => {
  let call: {
    file: string;
    args: string[];
    options: { cwd: string; env: NodeJS.ProcessEnv };
  } | null = null;
  const reply = await runClaudeTurn(
    '/wiki agentes',
    { NAMASTEX_MODE: 'real', NAMASTEX_REPO_ROOT: '/tmp/namastex-test' },
    {
      execFile: async (file, args, options) => {
        call = { file, args, options };
        return {
          stdout: '{"command":"/wiki","chunks":["Wiki: agentes"]}',
          stderr: '',
        };
      },
    },
  );

  if (!call) {
    throw new Error('Expected Claude runner to be called.');
  }

  const captured = call as {
    file: string;
    args: string[];
    options: { cwd: string; env: NodeJS.ProcessEnv };
  };

  assert.equal(captured.file, 'claude');
  assert.equal(captured.options.cwd, '/tmp/namastex-test');
  assert.equal(captured.options.env.NAMASTEX_TURN_EXECUTOR, 'local');
  assert.match(captured.args[2] || '', /CLAUDE\.md$/);
  assert.match(captured.args[3] || '', /npm run local:turn -- --json/);
  assert.deepEqual(reply.chunks, ['Wiki: agentes']);
});
