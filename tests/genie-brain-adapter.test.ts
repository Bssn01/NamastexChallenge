import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGenieBrainAdapter } from '../src/adapters/genie-brain.js';

type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

function makeExec(
  response: Record<string, { stdout?: string; stderr?: string; throws?: Error }>,
): ExecFileFn {
  return async (_file, args) => {
    const subcommand = args[1];
    const entry = response[subcommand] || response['*'];
    if (!entry) throw new Error(`Unexpected subcommand: ${subcommand}`);
    if (entry.throws) throw entry.throws;
    return { stdout: entry.stdout || '', stderr: entry.stderr || '' };
  };
}

test('genie-brain adapter returns ready in mock mode and skips ingest', async () => {
  const adapter = createGenieBrainAdapter({
    mode: 'mock',
    ingestDir: join(tmpdir(), 'brain-ingest-mock'),
  });

  const probe = await adapter.probe();
  assert.equal(probe, 'ready');

  const ingest = await adapter.ingest({
    dossierId: 'mock-1',
    mainTopic: 'topic',
    rawIdeaText: 'idea',
    crossGroupSummary: 'summary',
    groupResults: [],
  });
  assert.equal(ingest.state, 'ready');
  assert.match(ingest.notes[0] || '', /non-real/);

  const search = await adapter.search('anything', 5);
  assert.equal(search.state, 'ready');
  assert.equal(search.sources.length, 0);
});

test('genie-brain adapter reports missing binary', async () => {
  const adapter = createGenieBrainAdapter(
    {
      mode: 'real',
      bin: 'genie',
      ingestDir: join(tmpdir(), 'brain-ingest-missing'),
    },
    {
      execFile: makeExec({
        status: { throws: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) },
      }) as never,
    },
  );

  const state = await adapter.probe();
  assert.equal(state, 'missing');

  const ingest = await adapter.ingest({
    dossierId: 'x',
    mainTopic: 't',
    rawIdeaText: 'r',
    crossGroupSummary: 's',
    groupResults: [],
  });
  assert.equal(ingest.state, 'missing');
});

test('genie-brain adapter reports unconfigured when vault is missing', async () => {
  const adapter = createGenieBrainAdapter(
    {
      mode: 'real',
      bin: 'genie',
      ingestDir: join(tmpdir(), 'brain-ingest-unconfigured'),
    },
    {
      execFile: makeExec({
        status: { stdout: 'No workspace found. Run `genie init` to set up.' },
      }) as never,
    },
  );

  const state = await adapter.probe();
  assert.equal(state, 'unconfigured');
});

test('genie-brain adapter writes markdown and calls ingest when ready', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brain-ingest-'));
  const calls: Array<{ subcommand: string; path?: string }> = [];

  const adapter = createGenieBrainAdapter(
    {
      mode: 'real',
      bin: 'genie',
      ingestDir: dir,
    },
    {
      execFile: (async (_file: string, args: string[]) => {
        calls.push({ subcommand: args[1], path: args[2] });
        if (args[1] === 'status') return { stdout: 'Brain server running', stderr: '' };
        if (args[1] === 'ingest') return { stdout: 'ok', stderr: '' };
        if (args[1] === 'search') {
          return {
            stdout:
              '1. "vector databases" — Notes about pgvector and embeddings https://example.com/a\n2. "retrieval" — RAG pipeline overview',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      }) as never,
    },
  );

  try {
    const ingest = await adapter.ingest({
      dossierId: 'dossier-abc',
      mainTopic: 'Vector DBs',
      rawIdeaText: 'A research dossier.',
      crossGroupSummary: 'Summary across groups.',
      groupResults: [
        { label: 'Main', summary: 'Core findings.', resourceTitles: ['Title A', 'Title B'] },
      ],
    });
    assert.equal(ingest.state, 'ready');
    assert.ok(ingest.ingestPath);
    const markdown = await readFile(ingest.ingestPath as string, 'utf8');
    assert.match(markdown, /# Vector DBs/);
    assert.match(markdown, /Title A/);

    const search = await adapter.search('vector databases', 5);
    assert.equal(search.state, 'ready');
    assert.equal(search.sources.length, 2);
    assert.equal(search.sources[0]?.provider, 'genie-brain');
    assert.match(search.sources[0]?.title || '', /vector databases/);

    const ingestCall = calls.find((call) => call.subcommand === 'ingest');
    assert.ok(ingestCall?.path?.endsWith('dossier-abc.md'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
