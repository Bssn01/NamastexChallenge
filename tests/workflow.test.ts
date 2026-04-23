import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntime } from '../src/runtime.js';
import { routeWhatsappCommand } from '../src/workflow.js';

test('research workflow includes arxiv, hacker news, and grok signals', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'test-session',
    NAMASTEX_STORE_PATH: 'data/test-genie-research-store.json',
    NAMASTEX_OUTBOX_PATH: 'data/test-genie-outbox.jsonl',
  });

  await runtime.store.clearAll();
  const reply = await routeWhatsappCommand('/pesquisar agentes de whatsapp com swarm', runtime);
  const joined = reply.chunks.join('\n');

  assert.match(joined, /Pesquisa:/);
  assert.match(joined, /Resumo:/);
  assert.match(joined, /ARXIV/);
  assert.match(joined, /HACKERNEWS/);

  const snapshot = await runtime.store.snapshot();
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.events.length, 1);
});

test('reset workflow preserves the persistent wiki records', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'test-session-reset',
    NAMASTEX_STORE_PATH: 'data/test-genie-research-store-reset.json',
    NAMASTEX_OUTBOX_PATH: 'data/test-genie-outbox-reset.jsonl',
  });

  await runtime.store.clearAll();
  await routeWhatsappCommand('/pesquisar agentes de whatsapp com swarm', runtime);
  await routeWhatsappCommand('/reset', runtime);
  await routeWhatsappCommand('/pesquisar memoria apos reset', runtime);

  const snapshot = await runtime.store.snapshot();
  assert.equal(snapshot.records.length, 2);
  assert.notEqual(snapshot.records[0]?.sessionId, snapshot.records[1]?.sessionId);
});

test('repo viability workflow uses fixtures in mock mode', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'test-session-2',
    NAMASTEX_STORE_PATH: 'data/test-genie-research-store-2.json',
    NAMASTEX_OUTBOX_PATH: 'data/test-genie-outbox-2.jsonl',
  });

  const reply = await routeWhatsappCommand('/repo Bssn01/NamastexChallenge', runtime);
  const joined = reply.chunks.join('\n');

  assert.match(joined, /Repo:/);
  assert.match(joined, /GitHub:/);
  assert.match(joined, /Repomix:/);
});
