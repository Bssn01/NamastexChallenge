import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AppConfig } from './types.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const repoRoot = env.NAMASTEX_REPO_ROOT ? resolve(env.NAMASTEX_REPO_ROOT) : process.cwd();

  const config: AppConfig = {
    repoRoot,
    repoCacheRoot: env.NAMASTEX_REPO_CACHE_DIR
      ? resolve(repoRoot, env.NAMASTEX_REPO_CACHE_DIR)
      : resolve(repoRoot, 'data', 'repos'),
    storePath: env.NAMASTEX_STORE_PATH
      ? resolve(repoRoot, env.NAMASTEX_STORE_PATH)
      : resolve(repoRoot, 'data', 'genie-research-store.json'),
    storeOutboxPath: env.NAMASTEX_OUTBOX_PATH
      ? resolve(repoRoot, env.NAMASTEX_OUTBOX_PATH)
      : resolve(repoRoot, 'data', 'genie-outbox.jsonl'),
    sessionId: env.NAMASTEX_SESSION_ID || randomUUID(),
    hackerNewsApiBase: env.HACKERNEWS_API_BASE || 'https://hn.algolia.com/api/v1',
    hackerNewsUserAgent: env.HACKERNEWS_USER_AGENT || 'NamastexChallenge/0.1.0',
    defaultGithubOwner: env.GITHUB_OWNER,
    defaultGithubRepo: env.GITHUB_REPO,
    githubToken: env.GITHUB_TOKEN,
    githubApiBase: env.GITHUB_API_BASE || 'https://api.github.com',
    llm: {
      primary: env.NAMASTEX_LLM_PRIMARY || 'claude-cli',
      fallbacks: (env.NAMASTEX_LLM_FALLBACKS || 'codex-cli')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      openrouterKey: env.OPENROUTER_API_KEY,
      anthropicKey: env.ANTHROPIC_API_KEY,
      xaiKey: env.XAI_API_KEY,
      moonshotKey: env.MOONSHOT_API_KEY,
    },
    xSearchModel: env.X_SEARCH_MODEL || env.GROK_MODEL || 'grok-4.20-reasoning',
    xSearchLimit: Number(env.X_SEARCH_LIMIT || '5'),
    fieldTheoryBin: env.FIELDTHEORY_BIN,
    fieldTheoryDataDir: env.FT_DATA_DIR
      ? resolve(repoRoot, env.FT_DATA_DIR)
      : resolve(repoRoot, 'data', 'fieldtheory'),
    genieBrainBin: env.GENIE_BRAIN_BIN || 'genie',
    genieBrainIngestDir: env.GENIE_BRAIN_INGEST_DIR
      ? resolve(repoRoot, env.GENIE_BRAIN_INGEST_DIR)
      : resolve(repoRoot, 'data', 'brain-ingest'),
    genieBrainSearchLimit: Number(env.GENIE_BRAIN_SEARCH_LIMIT || '5'),
  };

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

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Please fill your .env file before running the project.`,
    );
  }

  return config;
}
