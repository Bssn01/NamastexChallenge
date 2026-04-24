import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('NAMASTEX_MODE=live is treated as real mode', () => {
  const config = loadConfig({
    NAMASTEX_MODE: 'live',
    NAMASTEX_REPO_ROOT: process.cwd(),
  });

  assert.equal(config.mode, 'real');
});
