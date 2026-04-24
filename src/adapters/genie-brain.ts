import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { normalizeWhitespace } from '../lib/text.js';
import type { DossierResourceCandidate, ResearchTopicContext } from './arxiv.js';

const execFile = promisify(execFileCallback);

export type GenieBrainState = 'missing' | 'unconfigured' | 'ready';

export interface GenieBrainIngestInput {
  dossierId: string;
  mainTopic: string;
  rawIdeaText: string;
  crossGroupSummary: string;
  groupResults: Array<{
    label: string;
    summary: string;
    resourceTitles: string[];
  }>;
}

export interface GenieBrainIngestResult {
  state: GenieBrainState;
  notes: string[];
  ingestPath?: string;
}

export interface GenieBrainSearchResult {
  state: GenieBrainState;
  sources: DossierResourceCandidate[];
  notes: string[];
}

export interface GenieBrainAdapter {
  probe(): Promise<GenieBrainState>;
  ingest(input: GenieBrainIngestInput): Promise<GenieBrainIngestResult>;
  search(
    query: string,
    limit?: number,
    context?: ResearchTopicContext,
  ): Promise<GenieBrainSearchResult>;
}

export interface GenieBrainAdapterOptions {
  bin?: string;
  ingestDir: string;
}

type ExecFile = typeof execFile;

function isMissingBinary(message: string): boolean {
  return /ENOENT|not found|command not found/i.test(message);
}

function isUnconfiguredOutput(output: string): boolean {
  return /no workspace found|run\s+`?genie init`?|brain not installed|not installed/i.test(output);
}

function renderDossierMarkdown(input: GenieBrainIngestInput): string {
  const lines = [
    `# ${input.mainTopic}`,
    '',
    `> Dossier ID: ${input.dossierId}`,
    '',
    '## Original idea',
    '',
    input.rawIdeaText,
    '',
    '## Cross-group summary',
    '',
    input.crossGroupSummary || '_(no synthesis available yet)_',
    '',
    '## Topic groups',
    '',
  ];

  for (const group of input.groupResults) {
    lines.push(`### ${group.label}`);
    lines.push('');
    lines.push(group.summary || '_(no summary)_');
    lines.push('');
    if (group.resourceTitles.length > 0) {
      lines.push('Sources:');
      for (const title of group.resourceTitles) {
        lines.push(`- ${title}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function parseBrainSearchOutput(
  output: string,
  query: string,
  context?: ResearchTopicContext,
): DossierResourceCandidate[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sources: DossierResourceCandidate[] = [];

  for (const line of lines) {
    if (line.startsWith('#') || /^(usage|warning|info|debug):/i.test(line)) continue;
    const cleaned = line.replace(/^[-*\d+.\s]+/, '').trim();
    if (!cleaned) continue;

    const titleMatch =
      cleaned.match(/^"(.+?)"\s*(?:—|-|::)\s*(.*)$/) || cleaned.match(/^(.+?)\s+(?:—|::)\s+(.*)$/);
    const title = titleMatch ? titleMatch[1] : cleaned.split(/\s+/).slice(0, 10).join(' ');
    const summary = titleMatch ? titleMatch[2] : cleaned;
    const urlMatch = cleaned.match(/https?:\/\/\S+/);

    sources.push({
      provider: 'genie-brain',
      title: normalizeWhitespace(title),
      url: urlMatch?.[0],
      summary: normalizeWhitespace(summary),
      tags: [
        'genie-brain',
        'external-untrusted',
        ...(context?.topicGroupLabel ? [context.topicGroupLabel] : []),
      ],
      origin: 'genie-brain',
      trustLevel: 'external-untrusted',
      score: Math.max(1, 100 - sources.length),
      topicGroupId: context?.topicGroupId,
      topicGroupLabel: context?.topicGroupLabel,
      query,
    });
  }

  return sources;
}

export function createGenieBrainAdapter(
  options: GenieBrainAdapterOptions,
  deps: { execFile?: ExecFile } = {},
): GenieBrainAdapter {
  const bin = options.bin || 'genie';
  const runner = deps.execFile || execFile;

  async function probe(): Promise<GenieBrainState> {
    try {
      const { stdout } = await runner(bin, ['brain', 'status', '--no-interactive', '--no-tui']);
      if (isUnconfiguredOutput(stdout)) return 'unconfigured';
      return 'ready';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stdout =
        typeof (error as { stdout?: unknown }).stdout === 'string'
          ? (error as { stdout: string }).stdout
          : '';
      if (isMissingBinary(message)) return 'missing';
      if (isUnconfiguredOutput(stdout) || isUnconfiguredOutput(message)) return 'unconfigured';
      return 'unconfigured';
    }
  }

  return {
    probe,

    async ingest(input: GenieBrainIngestInput): Promise<GenieBrainIngestResult> {
      const state = await probe();
      if (state !== 'ready') {
        return {
          state,
          notes:
            state === 'missing'
              ? ['genie-brain CLI is not installed.']
              : ['genie-brain is installed but no vault is initialized.'],
        };
      }

      const ingestPath = resolve(options.ingestDir, `${input.dossierId}.md`);
      try {
        await mkdir(dirname(ingestPath), { recursive: true });
        await writeFile(ingestPath, renderDossierMarkdown(input), 'utf8');
      } catch (error) {
        return {
          state: 'unconfigured',
          notes: [
            `Failed to write brain ingest file: ${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }

      try {
        await runner(bin, ['brain', 'ingest', ingestPath, '--no-interactive', '--no-tui']);
        return {
          state: 'ready',
          notes: [`Dossier ingested into Genie Brain at ${ingestPath}.`],
          ingestPath,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          state: 'unconfigured',
          notes: [`genie brain ingest failed: ${normalizeWhitespace(message)}`],
          ingestPath,
        };
      }
    },

    async search(
      query: string,
      limit = 5,
      context?: ResearchTopicContext,
    ): Promise<GenieBrainSearchResult> {
      const state = await probe();
      if (state !== 'ready') {
        return {
          state,
          sources: [],
          notes:
            state === 'missing'
              ? ['genie-brain CLI is not installed.']
              : ['genie-brain is installed but no vault is initialized.'],
        };
      }

      try {
        const { stdout } = await runner(bin, [
          'brain',
          'search',
          query,
          '--no-interactive',
          '--no-tui',
        ]);
        return {
          state: 'ready',
          sources: parseBrainSearchOutput(stdout, query, context).slice(0, limit),
          notes: ['Genie Brain search completed.'],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          state: 'unconfigured',
          sources: [],
          notes: [`genie brain search failed: ${normalizeWhitespace(message)}`],
        };
      }
    },
  };
}
