import { resolve } from 'node:path';

export type LlmTransport =
  | 'claude-cli'
  | 'codex-cli'
  | 'openrouter'
  | 'anthropic'
  | 'xai'
  | 'moonshot';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  metadata?: {
    mode?: 'turn' | 'analysis';
    workingDirectory?: string;
    appendSystemPromptFile?: string;
  };
}

export interface LlmResponse {
  content: string;
  model: string;
  providerId: string;
  transport: LlmTransport;
}

export interface LlmProvider {
  id: string;
  model: string;
  transport: LlmTransport;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface LlmConfig {
  primary: string;
  fallbacks: string[];
  openrouterKey?: string;
  anthropicKey?: string;
  xaiKey?: string;
  moonshotKey?: string;
}

export interface ProviderCatalogEntry {
  label: string;
  value: string;
  transport: LlmTransport;
}

export type ExecFileLike = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface ProviderFactoryOptions {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFileLike;
  fetch?: FetchLike;
}

export interface ParsedProviderSpec {
  raw: string;
  transport: LlmTransport;
  model: string;
}

export const LLM_PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    label: 'claude-sonnet-4-6 (Claude CLI)',
    value: 'claude-cli',
    transport: 'claude-cli',
  },
  {
    label: 'gpt-5-mini (Codex CLI)',
    value: 'codex-cli',
    transport: 'codex-cli',
  },
  {
    label: 'claude-opus-4-7 (Anthropic API)',
    value: 'anthropic:claude-opus-4-1',
    transport: 'anthropic',
  },
  {
    label: 'kimi-k2 (OpenRouter)',
    value: 'openrouter:moonshotai/kimi-k2',
    transport: 'openrouter',
  },
  {
    label: 'minimax-m1 (OpenRouter)',
    value: 'openrouter:minimax/minimax-m1',
    transport: 'openrouter',
  },
  {
    label: 'glm-4.6 (OpenRouter)',
    value: 'openrouter:z-ai/glm-4.6',
    transport: 'openrouter',
  },
  {
    label: 'grok-4 (xAI)',
    value: 'xai:grok-4',
    transport: 'xai',
  },
];

function normalizeMessages(messages: LlmMessage[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');
}

export function toPromptText(req: LlmRequest): string {
  return normalizeMessages(req.messages);
}

export function parseProviderSpec(spec: string): ParsedProviderSpec {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw new Error('Provider spec cannot be empty.');
  }

  if (trimmed === 'claude-cli') {
    return { raw: trimmed, transport: 'claude-cli', model: 'claude-cli' };
  }

  if (trimmed === 'codex-cli') {
    return { raw: trimmed, transport: 'codex-cli', model: 'codex-cli' };
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex < 0) {
    throw new Error(`Unsupported provider spec: ${trimmed}`);
  }

  const transport = trimmed.slice(0, colonIndex) as LlmTransport;
  const model = trimmed.slice(colonIndex + 1).trim();
  if (!model) {
    throw new Error(`Provider spec is missing a model: ${trimmed}`);
  }

  if (
    transport !== 'openrouter' &&
    transport !== 'anthropic' &&
    transport !== 'xai' &&
    transport !== 'moonshot'
  ) {
    throw new Error(`Unsupported provider transport: ${transport}`);
  }

  return {
    raw: trimmed,
    transport,
    model,
  };
}

export function defaultProviderSpecs(config: LlmConfig): string[] {
  const ordered = [config.primary, ...config.fallbacks]
    .map((value) => value.trim())
    .filter(Boolean);
  if (ordered.length > 0) return ordered;

  const defaults = ['claude-cli', 'codex-cli'];
  if (config.openrouterKey) {
    defaults.push('openrouter:moonshotai/kimi-k2');
  } else if (config.anthropicKey) {
    defaults.push('anthropic:claude-sonnet-4-5');
  } else if (config.moonshotKey) {
    defaults.push('moonshot:kimi-k2.6');
  } else if (config.xaiKey) {
    defaults.push('xai:grok-4');
  }

  return defaults;
}

export function claudePromptFile(repoRoot: string): string {
  return resolve(repoRoot, 'CLAUDE.md');
}

export async function completeWithFallback(
  providers: LlmProvider[],
  req: LlmRequest,
): Promise<LlmResponse & { failures: string[] }> {
  const failures: string[] = [];

  for (const provider of providers) {
    try {
      const response = await provider.complete(req);
      return { ...response, failures };
    } catch (error) {
      failures.push(
        `${provider.id}: ${error instanceof Error ? error.message : String(error)}`.trim(),
      );
    }
  }

  throw new Error(`All providers failed. ${failures.join(' | ')}`.trim());
}
