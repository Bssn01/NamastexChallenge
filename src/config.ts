import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveConversationIdentity } from './lib/conversation.js';
import type { AppConfig } from './types.js';

export interface LoadConfigOptions {
  allowPartial?: boolean;
}

export function parseDotenv(contents: string): Record<string, string> {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce<Record<string, string>>((acc, line) => {
      const separator = line.indexOf('=');
      if (separator < 0) return acc;
      acc[line.slice(0, separator)] = line.slice(separator + 1);
      return acc;
    }, {});
}

function loadProcessEnvWithDotenv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env !== process.env) return env;
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return env;
  return {
    ...parseDotenv(readFileSync(envPath, 'utf8')),
    ...env,
  };
}

export function findMissingConfig(config: AppConfig): string[] {
  const missing: string[] = [];
  if (
    !config.llm.openrouterKey &&
    !config.llm.anthropicKey &&
    !config.llm.xaiKey &&
    !config.llm.moonshotKey &&
    !config.llm.primary.includes('claude-cli') &&
    !config.llm.primary.includes('codex-cli')
  ) {
    missing.push('A configured LLM provider (Claude CLI, Codex CLI, or API key-backed provider)');
  }
  if (!config.githubToken) {
    missing.push('GITHUB_TOKEN');
  }
  if (config.storeDriver === 'postgres' && !config.databaseUrl) {
    missing.push('NAMASTEX_DATABASE_URL or DATABASE_URL');
  }
  return missing;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): AppConfig {
  const effectiveEnv = loadProcessEnvWithDotenv(env);
  const repoRoot = effectiveEnv.NAMASTEX_REPO_ROOT
    ? resolve(effectiveEnv.NAMASTEX_REPO_ROOT)
    : process.cwd();
  const conversation = resolveConversationIdentity(effectiveEnv);
  const storeDriver = effectiveEnv.NAMASTEX_STORE_DRIVER === 'postgres' ? 'postgres' : 'json';
  const databaseUrl = effectiveEnv.NAMASTEX_DATABASE_URL || effectiveEnv.DATABASE_URL;

  const config: AppConfig = {
    repoRoot,
    repoCacheRoot: effectiveEnv.NAMASTEX_REPO_CACHE_DIR
      ? resolve(repoRoot, effectiveEnv.NAMASTEX_REPO_CACHE_DIR)
      : resolve(repoRoot, 'data', 'repos'),
    storePath: effectiveEnv.NAMASTEX_STORE_PATH
      ? resolve(repoRoot, effectiveEnv.NAMASTEX_STORE_PATH)
      : resolve(repoRoot, 'data', 'genie-research-store.json'),
    storeOutboxPath: effectiveEnv.NAMASTEX_OUTBOX_PATH
      ? resolve(repoRoot, effectiveEnv.NAMASTEX_OUTBOX_PATH)
      : resolve(repoRoot, 'data', 'genie-outbox.jsonl'),
    storeDriver,
    databaseUrl,
    sessionId: conversation.sessionId,
    conversationKey: conversation.conversationKey,
    conversationSource: conversation.source,
    omniInstanceId: conversation.instanceId,
    omniChatId: conversation.chatId,
    hackerNewsApiBase: effectiveEnv.HACKERNEWS_API_BASE || 'https://hn.algolia.com/api/v1',
    hackerNewsUserAgent: effectiveEnv.HACKERNEWS_USER_AGENT || 'NamastexChallenge/0.1.0',
    defaultGithubOwner: effectiveEnv.GITHUB_OWNER,
    defaultGithubRepo: effectiveEnv.GITHUB_REPO,
    githubToken: effectiveEnv.GITHUB_TOKEN,
    githubApiBase: effectiveEnv.GITHUB_API_BASE || 'https://api.github.com',
    llm: {
      primary: effectiveEnv.NAMASTEX_LLM_PRIMARY || 'claude-cli',
      fallbacks: (effectiveEnv.NAMASTEX_LLM_FALLBACKS || 'codex-cli')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      openrouterKey: effectiveEnv.OPENROUTER_API_KEY,
      anthropicKey: effectiveEnv.ANTHROPIC_API_KEY,
      xaiKey: effectiveEnv.XAI_API_KEY,
      moonshotKey: effectiveEnv.MOONSHOT_API_KEY,
    },
    xSearchModel: effectiveEnv.X_SEARCH_MODEL || effectiveEnv.GROK_MODEL || 'grok-4.20-reasoning',
    xSearchLimit: Number(effectiveEnv.X_SEARCH_LIMIT || '5'),
    fieldTheoryBin: effectiveEnv.FIELDTHEORY_BIN,
    fieldTheoryDataDir: effectiveEnv.FT_DATA_DIR
      ? resolve(repoRoot, effectiveEnv.FT_DATA_DIR)
      : resolve(repoRoot, 'data', 'fieldtheory'),
    genieBrainBin: effectiveEnv.GENIE_BRAIN_BIN || 'genie',
    genieBrainIngestDir: effectiveEnv.GENIE_BRAIN_INGEST_DIR
      ? resolve(repoRoot, effectiveEnv.GENIE_BRAIN_INGEST_DIR)
      : resolve(repoRoot, 'data', 'brain-ingest'),
    genieBrainSearchLimit: Number(effectiveEnv.GENIE_BRAIN_SEARCH_LIMIT || '5'),
  };

  const missing = findMissingConfig(config);

  if (!options.allowPartial && missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Please fill your .env file before running the project.`,
    );
  }

  return config;
}
