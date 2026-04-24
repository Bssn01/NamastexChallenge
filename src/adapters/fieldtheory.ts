import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { DossierResourceCandidate, ResearchTopicContext } from './arxiv.js';

const execFile = promisify(execFileCallback);

export type FieldTheoryState = 'missing' | 'unconfigured' | 'ready';

export interface FieldTheorySearchResult {
  state: FieldTheoryState;
  sources: DossierResourceCandidate[];
  notes: string[];
}

export interface FieldTheoryAdapter {
  search(
    query: string,
    limit?: number,
    context?: ResearchTopicContext,
  ): Promise<FieldTheorySearchResult>;
}

export interface FieldTheoryAdapterOptions {
  bin?: string;
  dataDir?: string;
}

function envWithDataDir(dataDir?: string): NodeJS.ProcessEnv {
  return dataDir ? { ...process.env, FT_DATA_DIR: dataDir } : process.env;
}

function parseOutput(
  output: string,
  query: string,
  context?: ResearchTopicContext,
): DossierResourceCandidate[] {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd());
  const sources: DossierResourceCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || /^\d+\.\s/.test(line)) continue;

    const author = line.match(/^\d+\.\s+\[(.*?)\]\s+@(\S+)/);
    const title = lines[index + 1]?.trim() || `Field Theory result ${sources.length + 1}`;
    const url = [lines[index + 2], lines[index + 3]].find((candidate) =>
      candidate?.includes('https://x.com/'),
    );

    sources.push({
      provider: 'fieldtheory',
      title,
      url: url?.trim(),
      summary: author
        ? `Bookmark by @${author[2]} saved ${author[1]}.`
        : 'Local bookmark result from Field Theory.',
      tags: [
        'fieldtheory',
        'external-untrusted',
        ...(context?.topicGroupLabel ? [context.topicGroupLabel] : []),
      ],
      origin: 'fieldtheory-cli',
      trustLevel: 'external-untrusted',
      score: Math.max(1, 100 - sources.length),
      topicGroupId: context?.topicGroupId,
      topicGroupLabel: context?.topicGroupLabel,
      query,
    });
  }

  return sources;
}

export function createFieldTheoryAdapter(options: FieldTheoryAdapterOptions): FieldTheoryAdapter {
  const bin = options.bin || 'ft';

  return {
    async search(
      query: string,
      limit = 5,
      context?: ResearchTopicContext,
    ): Promise<FieldTheorySearchResult> {
      try {
        await execFile(bin, ['status'], {
          env: envWithDataDir(options.dataDir),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT|not found/i.test(message)) {
          return {
            state: 'missing',
            sources: [],
            notes: ['fieldtheory-cli is not installed.'],
          };
        }
        return {
          state: 'unconfigured',
          sources: [],
          notes: ['fieldtheory-cli is installed but not configured.'],
        };
      }

      try {
        const result = await execFile(bin, ['search', query, '--limit', String(limit)], {
          env: envWithDataDir(options.dataDir),
        });
        return {
          state: 'ready',
          sources: parseOutput(result.stdout, query, context),
          notes: ['Field Theory local bookmark search completed.'],
        };
      } catch {
        return {
          state: 'unconfigured',
          sources: [],
          notes: ['fieldtheory-cli is installed but no local bookmark store is configured.'],
        };
      }
    },
  };
}
