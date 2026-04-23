import { createArxivAdapter } from './adapters/arxiv.js';
import { createFieldTheoryAdapter } from './adapters/fieldtheory.js';
import { createGenieBrainAdapter } from './adapters/genie-brain.js';
import { createGitHubLabAdapter } from './adapters/github.js';
import { createGrokAdapter } from './adapters/grok.js';
import { createHackerNewsAdapter } from './adapters/hackernews.js';
import { createRepomixAdapter } from './adapters/repomix.js';
import { createXSearchAdapter } from './adapters/x.js';
import { loadConfig } from './config.js';
import { createGenieResearchStore } from './store/genie-research-store.js';

export function createRuntime(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  const store = createGenieResearchStore({
    mode: config.mode,
    storePath: config.storePath,
    outboxPath: config.storeOutboxPath,
    sessionId: config.sessionId,
  });

  const arxiv = createArxivAdapter({
    mode: config.mode,
    fixturePath: config.arxivFixturePath,
  });

  const hackernews = createHackerNewsAdapter({
    mode: config.mode,
    fixturePath: config.hackerNewsFixturePath,
    apiBase: config.hackerNewsApiBase,
    userAgent: config.hackerNewsUserAgent,
  });

  const grok = createGrokAdapter({
    mode: config.mode,
    fixturePath: config.grokFixturePath,
    openRouterApiKey: config.openRouterApiKey,
    xaiApiKey: config.xaiApiKey,
    model: config.grokModel,
  });

  const github = createGitHubLabAdapter({
    mode: config.mode,
    fixturePath: config.githubFixturePath,
    githubApiBase: config.githubApiBase,
    githubToken: config.githubToken,
    defaultOwner: config.githubOwner,
    defaultRepo: config.githubRepo,
    repoRoot: config.repoRoot,
    repoCacheRoot: config.repoCacheRoot,
  });

  const repomix = createRepomixAdapter({
    mode: config.mode,
    fixturePath: config.repomixFixturePath,
    repoRoot: config.repoRoot,
  });

  const x = createXSearchAdapter({
    mode: config.mode,
    fixturePath: config.arxivFixturePath,
    xaiApiKey: config.xaiApiKey,
    openRouterApiKey: config.openRouterApiKey,
    model: config.xSearchModel,
  });

  const fieldtheory = createFieldTheoryAdapter({
    mode: config.mode,
    fixturePath: config.arxivFixturePath,
    bin: config.fieldTheoryBin,
    dataDir: config.fieldTheoryDataDir,
  });

  const genieBrain = createGenieBrainAdapter({
    mode: config.mode,
    bin: config.genieBrainBin,
    ingestDir: config.genieBrainIngestDir,
  });

  return {
    config,
    store,
    arxiv,
    hackernews,
    grok,
    github,
    repomix,
    x,
    fieldtheory,
    genieBrain,
  };
}
