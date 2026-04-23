export type RuntimeMode = 'mock' | 'dev' | 'real';

export interface ResearchSource {
  provider: 'arxiv' | 'hackernews' | 'grok' | 'github' | 'repomix';
  title: string;
  url?: string;
  summary: string;
  publishedAt?: string;
  tags?: string[];
  id?: string;
}

export interface ResearchRecord {
  id: string;
  query: string;
  createdAt: string;
  summary: string;
  sources: ResearchSource[];
  sessionId: string;
  mode: RuntimeMode;
  notes: string[];
}

export interface WhatsAppReply {
  command: string;
  chunks: string[];
  metadata?: Record<string, unknown>;
}

export interface AppConfig {
  mode: RuntimeMode;
  repoRoot: string;
  storePath: string;
  storeOutboxPath: string;
  mockFixturesDir: string;
  sessionId: string;
  arxivFixturePath: string;
  hackerNewsFixturePath: string;
  grokFixturePath: string;
  githubFixturePath: string;
  repomixFixturePath: string;
  hackerNewsApiBase: string;
  hackerNewsUserAgent: string;
  githubOwner?: string;
  githubRepo?: string;
  githubToken?: string;
  githubApiBase: string;
  openRouterApiKey?: string;
  xaiApiKey?: string;
  grokModel: string;
}
