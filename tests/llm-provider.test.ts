import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnthropicApiProvider } from '../src/adapters/llm/anthropic-api.js';
import { createClaudeCliProvider } from '../src/adapters/llm/claude-cli.js';
import { createCodexCliProvider } from '../src/adapters/llm/codex-cli.js';
import { createMoonshotProvider } from '../src/adapters/llm/moonshot.js';
import { createOpenRouterProvider } from '../src/adapters/llm/openrouter.js';
import { parseProviderSpec } from '../src/adapters/llm/provider.js';
import { createXaiProvider } from '../src/adapters/llm/xai.js';

test('claude-cli provider shells out with the rendered prompt', async () => {
  let call: { file: string; args: string[] } | null = null;
  const provider = createClaudeCliProvider({
    repoRoot: '/tmp/namastex',
    execFile: async (file, args) => {
      call = { file, args };
      return { stdout: 'ok', stderr: '' };
    },
  });

  const response = await provider.complete({
    messages: [{ role: 'user', content: 'hello' }],
  });

  if (!call) throw new Error('Expected Claude CLI to be called.');
  const captured = call as { file: string; args: string[] };
  assert.equal(captured.file, 'claude');
  assert.match(captured.args.at(-1) || '', /USER:\nhello/);
  assert.equal(response.content, 'ok');
});

test('codex-cli provider shells out with codex exec', async () => {
  let call: { file: string; args: string[] } | null = null;
  const provider = createCodexCliProvider({
    repoRoot: '/tmp/namastex',
    execFile: async (file, args) => {
      call = { file, args };
      return { stdout: 'ok', stderr: '' };
    },
  });

  const response = await provider.complete({
    messages: [{ role: 'user', content: 'hello' }],
  });

  if (!call) throw new Error('Expected Codex CLI to be called.');
  const captured = call as { file: string; args: string[] };
  assert.equal(captured.file, 'codex');
  assert.equal(captured.args[0], 'exec');
  assert.equal(response.content, 'ok');
});

test('openrouter provider posts chat completions with model from spec', async () => {
  let call: { url: string; init?: Record<string, unknown> } | null = null;
  const provider = createOpenRouterProvider({
    repoRoot: '/tmp/namastex',
    apiKey: 'sk-test',
    spec: parseProviderSpec('openrouter:moonshotai/kimi-k2'),
    fetch: async (url, init) => {
      call = { url, init: init as Record<string, unknown> };
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      };
    },
  });

  const response = await provider.complete({
    messages: [{ role: 'user', content: 'hello' }],
  });
  if (!call) throw new Error('Expected OpenRouter to be called.');
  const captured = call as { url: string; init?: Record<string, unknown> };
  const body = JSON.parse((captured.init?.body as string) || '{}');

  assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(body.model, 'moonshotai/kimi-k2');
  assert.equal(response.content, 'ok');
});

test('anthropic provider maps system and user messages to the api payload', async () => {
  let call: { url: string; init?: Record<string, unknown> } | null = null;
  const provider = createAnthropicApiProvider({
    repoRoot: '/tmp/namastex',
    apiKey: 'sk-ant',
    spec: parseProviderSpec('anthropic:claude-opus-4-1'),
    fetch: async (url, init) => {
      call = { url, init: init as Record<string, unknown> };
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
        }),
      };
    },
  });

  const response = await provider.complete({
    messages: [
      { role: 'system', content: 'system rule' },
      { role: 'user', content: 'hello' },
    ],
  });
  if (!call) throw new Error('Expected Anthropic to be called.');
  const captured = call as { url: string; init?: Record<string, unknown> };
  const body = JSON.parse((captured.init?.body as string) || '{}');

  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(body.system, 'system rule');
  assert.equal(body.model, 'claude-opus-4-1');
  assert.equal(response.content, 'ok');
});

test('moonshot provider calls the moonshot chat completions api', async () => {
  let call: { url: string; init?: Record<string, unknown> } | null = null;
  const provider = createMoonshotProvider({
    repoRoot: '/tmp/namastex',
    apiKey: 'sk-moon',
    spec: parseProviderSpec('moonshot:kimi-k2.6'),
    fetch: async (url, init) => {
      call = { url, init: init as Record<string, unknown> };
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      };
    },
  });

  const response = await provider.complete({
    messages: [{ role: 'user', content: 'hello' }],
  });
  if (!call) throw new Error('Expected Moonshot to be called.');
  const captured = call as { url: string; init?: Record<string, unknown> };
  const body = JSON.parse((captured.init?.body as string) || '{}');

  assert.equal(captured.url, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(body.model, 'kimi-k2.6');
  assert.equal(response.content, 'ok');
});

test('xai provider calls the xAI chat completions api', async () => {
  let call: { url: string; init?: Record<string, unknown> } | null = null;
  const provider = createXaiProvider({
    repoRoot: '/tmp/namastex',
    apiKey: 'sk-xai',
    spec: parseProviderSpec('xai:grok-4'),
    fetch: async (url, init) => {
      call = { url, init: init as Record<string, unknown> };
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      };
    },
  });

  const response = await provider.complete({
    messages: [{ role: 'user', content: 'hello' }],
  });
  if (!call) throw new Error('Expected xAI to be called.');
  const captured = call as { url: string; init?: Record<string, unknown> };
  const body = JSON.parse((captured.init?.body as string) || '{}');

  assert.equal(captured.url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(body.model, 'grok-4');
  assert.equal(response.content, 'ok');
});
