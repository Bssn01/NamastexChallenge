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
import { createPostgresResearchStore } from './store/postgres-research-store.js';

export function createRuntime(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  const store =
    config.storeDriver === 'postgres'
      ? createPostgresResearchStore({
          databaseUrl: config.databaseUrl as string,
          sessionId: config.sessionId,
          conversationKey: config.conversationKey,
        })
      : createGenieResearchStore({
          storePath: config.storePath,
          outboxPath: config.storeOutboxPath,
          sessionId: config.sessionId,
          conversationKey: config.conversationKey,
        });

  const arxiv = createArxivAdapter();

  const hackernews = createHackerNewsAdapter({
    apiBase: config.hackerNewsApiBase,
    userAgent: config.hackerNewsUserAgent,
  });

  const grok = createGrokAdapter({
    llm: config.llm,
    repoRoot: config.repoRoot,
  });

  const github = createGitHubLabAdapter({
    githubApiBase: config.githubApiBase,
    githubToken: config.githubToken,
    defaultOwner: config.defaultGithubOwner,
    defaultRepo: config.defaultGithubRepo,
    repoRoot: config.repoRoot,
    repoCacheRoot: config.repoCacheRoot,
  });

  const repomix = createRepomixAdapter({
    repoRoot: config.repoRoot,
  });

  const x = createXSearchAdapter({
    xaiApiKey: config.llm.xaiKey,
    openRouterApiKey: config.llm.openrouterKey,
    model: config.xSearchModel,
  });

  const fieldtheory = createFieldTheoryAdapter({
    bin: config.fieldTheoryBin,
    dataDir: config.fieldTheoryDataDir,
  });

  const genieBrain = createGenieBrainAdapter({
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
