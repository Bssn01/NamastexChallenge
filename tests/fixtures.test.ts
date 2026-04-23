import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitHubLabAdapter } from '../src/adapters/github.js';
import { createRepomixAdapter } from '../src/adapters/repomix.js';
import { createRuntime } from '../src/runtime.js';

test('github lab fixture is stable', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'fixture-session',
  });

  const report = await runtime.github.validateRepository('Bssn01/NamastexChallenge');
  assert.equal(report.accessible, true);
  assert.equal(report.issues.length >= 1, true);
  assert.match(report.readme, /Mock README fixture/);
});

test('repomix lab fixture is stable', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'fixture-session-2',
  });

  const report = await runtime.repomix.validateRepository(runtime.config.repoRoot);
  assert.equal(report.accessible, true);
  assert.match(report.pack, /Repository pack snapshot/);
});
