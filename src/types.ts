export type RuntimeMode = 'mock' | 'dev' | 'real';

export type ResearchProvider =
  | 'arxiv'
  | 'hackernews'
  | 'grok'
  | 'github'
  | 'repomix'
  | 'x'
  | 'fieldtheory';

export type TopicGroupKind = 'main' | 'niche';
export type SourceTrustLevel = 'external-untrusted';

export interface ResearchSource {
  provider: ResearchProvider;
  title: string;
  url?: string;
  summary: string;
  publishedAt?: string;
  tags?: string[];
  id?: string;
}

export interface TopicGroup {
  id: string;
  label: string;
  kind: TopicGroupKind;
  topics: string[];
  summary?: string;
}

export interface DossierResource extends ResearchSource {
  id: string;
  topicGroupId: string;
  score?: number;
  origin?: string;
  trustLevel: SourceTrustLevel;
}

export interface ResearchRunGroupResult {
  topicGroupId: string;
  topicGroupLabel: string;
  summary: string;
  resources: DossierResource[];
  notes?: string[];
}

export interface ResearchRun {
  id: string;
  dossierId: string;
  createdAt: string;
  sessionId: string;
  mode: RuntimeMode;
  groupResults: ResearchRunGroupResult[];
  crossGroupSummary: string;
  notes: string[];
}

export interface RepoTargetRef {
  canonicalSlug: string;
  owner?: string;
  repo?: string;
  sourceUrl?: string;
  localPath?: string;
  defaultBranch?: string;
  notes?: string[];
}

export interface RepoAssessment {
  id: string;
  dossierId: string;
  createdAt: string;
  targetRepo: RepoTargetRef;
  githubReport: Record<string, unknown>;
  repomixReport: Record<string, unknown>;
  fitSummary: string;
  fitScore?: number;
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendedNextSteps: string[];
  notes: string[];
}

export interface IdeaDossier {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  rawIdeaText: string;
  mainTopic: string;
  topicGroups: TopicGroup[];
  researchRuns: ResearchRun[];
  repoAssessments: RepoAssessment[];
  mode: RuntimeMode;
  notes: string[];
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
  dossierId?: string;
  researchRunId?: string;
}

export interface WhatsAppReply {
  command: string;
  chunks: string[];
  metadata?: Record<string, unknown>;
}

export interface AppConfig {
  mode: RuntimeMode;
  repoRoot: string;
  repoCacheRoot: string;
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
  xSearchModel: string;
  xSearchLimit: number;
  fieldTheoryBin?: string;
  fieldTheoryDataDir?: string;
}
