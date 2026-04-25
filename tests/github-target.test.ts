import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { materializeGitHubTarget, resolveGitHubTarget } from '../src/adapters/github-target.js';

test('resolveGitHubTarget rejects path traversal slugs instead of using defaults', async () => {
  const target = await resolveGitHubTarget('../..', {
    repoRoot: '/tmp/namastex',
    githubApiBase: 'https://api.github.com',
    defaultOwner: 'openai',
    defaultRepo: 'codex',
  });

  assert.equal(target.owner, 'unknown');
  assert.equal(target.repo, 'unknown');
  assert.match(target.notes.join(' '), /Invalid GitHub owner/i);
});

test('materializeGitHubTarget does not touch paths outside the cache root for invalid targets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'namastex-target-'));
  const cacheRoot = resolve(dir, 'data', 'repos');
  const sentinelPath = resolve(dir, 'data', 'sentinel.txt');

  try {
    await mkdir(resolve(dir, 'data'), { recursive: true });
    await writeFile(sentinelPath, 'keep me', 'utf8');
    const materialized = await materializeGitHubTarget(
      {
        owner: '..',
        repo: '..',
        canonicalSlug: '../..',
        sourceUrl: 'https://github.com/../..',
        normalizedFrom: 'slug',
        notes: ['malicious explicit input'],
      },
      {
        repoRoot: dir,
        repoCacheRoot: cacheRoot,
        githubApiBase: 'https://api.github.com',
      },
    );

    assert.equal(await readFile(sentinelPath, 'utf8'), 'keep me');
    assert.equal(materialized.localPath, resolve(cacheRoot, 'unknown', 'unknown'));
    assert.match(materialized.notes.join(' '), /Invalid GitHub owner/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
