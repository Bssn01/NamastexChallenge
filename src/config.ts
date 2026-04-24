import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AppConfig, RuntimeMode } from './types.js';

function runtimeMode(value: string | undefined): RuntimeMode {
  if (value === 'live') return 'real';
  if (value === 'real' || value === 'dev' || value === 'mock') return value;
  return 'mock';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const repoRoot = env.NAMASTEX_REPO_ROOT ? resolve(env.NAMASTEX_REPO_ROOT) : process.cwd();
  const mockFixturesDir = resolve(repoRoot, 'fixtures', 'mock');

  return {
    mode: runtimeMode(env.NAMASTEX_MODE),
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
    mockFixturesDir,
    sessionId: env.NAMASTEX_SESSION_ID || randomUUID(),
    arxivFixturePath: resolve(mockFixturesDir, 'research-samples.json'),
    hackerNewsFixturePath: resolve(mockFixturesDir, 'research-samples.json'),
    grokFixturePath: resolve(mockFixturesDir, 'research-samples.json'),
    githubFixturePath: resolve(mockFixturesDir, 'github-lab.json'),
    repomixFixturePath: resolve(mockFixturesDir, 'repomix-pack.txt'),
    hackerNewsApiBase: env.HACKERNEWS_API_BASE || 'https://hn.algolia.com/api/v1',
    hackerNewsUserAgent: env.HACKERNEWS_USER_AGENT || 'NamastexChallenge/0.1.0',
    githubOwner: env.GITHUB_OWNER,
    githubRepo: env.GITHUB_REPO,
    githubToken: env.GITHUB_TOKEN,
    githubApiBase: env.GITHUB_API_BASE || 'https://api.github.com',
    openRouterApiKey: env.OPENROUTER_API_KEY,
    xaiApiKey: env.XAI_API_KEY,
    grokModel: env.GROK_MODEL || 'x-ai/grok-4.1-fast',
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
    moonshotApiKey: env.MOONSHOT_API_KEY,
    kimiApiBase: env.KIMI_API_BASE || 'https://api.moonshot.ai/v1',
    kimiModel: env.KIMI_MODEL || 'kimi-k2.6',
    kimiCliBin: env.KIMI_CLI_BIN || 'kimi',
    kimiMode: env.NAMASTEX_KIMI_MODE === 'cli' ? 'cli' : 'api',
  };
}
