import assert from 'node:assert/strict';
import test from 'node:test';
import { createFieldTheoryAdapter } from '../src/adapters/fieldtheory.js';

test('fieldtheory adapter reports missing binary clearly', async () => {
  const adapter = createFieldTheoryAdapter({
    mode: 'real',
    fixturePath: 'fixtures/mock/research-samples.json',
    bin: '/definitely-missing-ft',
  });

  const result = await adapter.search('agents', 2);
  assert.equal(result.state, 'missing');
});

test('fieldtheory adapter returns fixtures in mock mode', async () => {
  const adapter = createFieldTheoryAdapter({
    mode: 'mock',
    fixturePath: 'fixtures/mock/research-samples.json',
  });

  const result = await adapter.search('memory', 2);
  assert.equal(result.state, 'ready');
  assert.equal(result.sources.length >= 1, true);
});

test('fieldtheory adapter reports unconfigured when binary exists but fails', async () => {
  const adapter = createFieldTheoryAdapter({
    mode: 'real',
    fixturePath: 'fixtures/mock/research-samples.json',
    bin: 'false',
  });

  const result = await adapter.search('agents', 2);
  assert.equal(result.state, 'unconfigured');
  assert.equal(result.sources.length, 0);
  assert.match(result.notes[0] || '', /installed but not configured/i);
});
