import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { normalizeWhitespace } from './lib/text.js';
import { createRuntime } from './runtime.js';
import type { WhatsAppReply } from './types.js';
import { routeWhatsappCommand } from './workflow.js';

const execFile = promisify(execFileCallback);

type Env = NodeJS.ProcessEnv;
type ExecFile = (
  file: string,
  args: string[],
  options: { cwd: string; env: Env },
) => Promise<{ stdout: string; stderr: string }>;

export type TurnExecutor = 'local' | 'claude';

function valueFromObject(payload: Record<string, unknown>): string | undefined {
  const direct = [payload.text, payload.body, payload.content, payload.message].find(
    (value) => typeof value === 'string',
  );
  if (typeof direct === 'string') return direct;

  for (const key of ['message', 'content', 'data']) {
    const nested = payload[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = valueFromObject(nested as Record<string, unknown>);
      if (found) return found;
    }
  }

  return undefined;
}

export function parseOmniPayload(raw: string): string {
  if (!raw.trim()) return '';

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return valueFromObject(parsed as Record<string, unknown>) || raw;
    }
  } catch {
    return raw;
  }

  return raw;
}

export function extractOmniText(argv: string[], env: Env): string {
  const fromArgs = parseOmniPayload(argv.join(' ').trim());
  if (fromArgs) return fromArgs;

  return parseOmniPayload(env.OMNI_MESSAGE || env.OMNI_TEXT || env.MESSAGE_TEXT || '');
}

export function resolveTurnExecutor(env: Env): TurnExecutor {
  if (env.NAMASTEX_TURN_EXECUTOR === 'local' || env.NAMASTEX_TURN_EXECUTOR === 'claude') {
    return env.NAMASTEX_TURN_EXECUTOR;
  }

  return env.NAMASTEX_MODE === 'real' ? 'claude' : 'local';
}

export async function runLocalTurn(
  command: string,
  env: Env = process.env,
): Promise<WhatsAppReply> {
  const runtime = createRuntime(env);
  return routeWhatsappCommand(command, runtime);
}

export function buildClaudeTurnPrompt(command: string): string {
  return [
    'You are the Genie/Claude Code agent for this repository.',
    'Process the Omni/WhatsApp turn by running the deterministic local workflow command from the repository root exactly once.',
    `Command: npm run local:turn -- --json ${JSON.stringify(command)}`,
    'Return exactly the stdout from that command.',
    'Do not add commentary, markdown fences, labels, or explanations.',
  ].join('\n\n');
}

function normalizeClaudePayload(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  return trimmed;
}

function parseReplyPayload(raw: string): WhatsAppReply {
  const parsed = JSON.parse(raw) as Partial<WhatsAppReply>;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chunks)) {
    throw new Error('Missing reply chunks.');
  }

  return {
    command: typeof parsed.command === 'string' ? parsed.command : 'unknown',
    chunks: parsed.chunks.map((chunk) => String(chunk)),
    metadata:
      parsed.metadata && typeof parsed.metadata === 'object'
        ? (parsed.metadata as Record<string, unknown>)
        : undefined,
  };
}

export function parseClaudeTurnOutput(stdout: string): WhatsAppReply {
  const normalized = normalizeClaudePayload(stdout);
  if (!normalized) throw new Error('Empty Claude Code output.');

  try {
    return parseReplyPayload(normalized);
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return parseReplyPayload(normalized.slice(start, end + 1));
    }
    throw new Error('Claude Code output was not valid turn JSON.');
  }
}

export async function runClaudeTurn(
  command: string,
  env: Env = process.env,
  deps: { execFile?: ExecFile } = {},
): Promise<WhatsAppReply> {
  const repoRoot = env.NAMASTEX_REPO_ROOT ? resolve(env.NAMASTEX_REPO_ROOT) : process.cwd();
  const runner = deps.execFile || ((file, args, options) => execFile(file, args, options));
  const claudeEnv: Env = {
    ...env,
    GENIE_WORKER: env.GENIE_WORKER || '1',
    NAMASTEX_TURN_EXECUTOR: 'local',
  };

  const { stdout, stderr } = await runner(
    'claude',
    [
      '--dangerously-skip-permissions',
      '--append-system-prompt-file',
      resolve(repoRoot, 'CLAUDE.md'),
      buildClaudeTurnPrompt(command),
    ],
    { cwd: repoRoot, env: claudeEnv },
  );

  try {
    return parseClaudeTurnOutput(stdout);
  } catch (error) {
    const suffix = stderr.trim() ? ` stderr=${normalizeWhitespace(stderr)}` : '';
    throw new Error(
      `Claude Code did not return a valid WhatsApp payload: ${error instanceof Error ? error.message : String(error)}.${suffix}`,
    );
  }
}
