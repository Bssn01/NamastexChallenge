import assert from 'node:assert/strict';
import test from 'node:test';
import { createXSearchAdapter } from '../src/adapters/x.js';

test('x adapter returns fixture results in mock mode', async () => {
  const adapter = createXSearchAdapter({
    mode: 'mock',
    fixturePath: 'fixtures/mock/research-samples.json',
    model: 'grok-4.20-reasoning',
  });

  const result = await adapter.search('agents', 2, {
    topicGroupId: 'group-1',
    topicGroupLabel: 'Main topic',
  });

  assert.equal(result.provider, 'mock');
  assert.equal(result.posts.length >= 1, true);
  assert.equal(result.posts[0]?.provider, 'x');
});

test('x adapter reports unconfigured when no keys are provided', async () => {
  const adapter = createXSearchAdapter({
    mode: 'real',
    fixturePath: 'fixtures/mock/research-samples.json',
    model: 'grok-4.20-reasoning',
  });

  const result = await adapter.search('agents', 2);

  assert.equal(result.provider, 'unconfigured');
  assert.equal(result.configured, false);
  assert.equal(result.posts.length, 0);
  assert.match(result.notes[0] || '', /not configured/i);
});
