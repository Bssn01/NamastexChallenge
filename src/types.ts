import type { LlmConfig } from './adapters/llm/provider.js';

export type ResearchProvider =
  | 'arxiv'
  | 'hackernews'
  | 'llm'
  | 'github'
  | 'repomix'
  | 'x'
  | 'fieldtheory'
  | 'genie-brain';

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
  conversationKey?: string;
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

export type MonitorCadence = 'daily' | 'weekly';
export type MonitorProvider = 'x' | 'hackernews' | 'arxiv';

export interface MonitorSubscription {
  id: string;
  conversationKey: string;
  sessionId: string;
  instanceId?: string;
  chatId?: string;
  cadence: MonitorCadence;
  time: string;
  timezone?: string;
  topics: string[];
  niches: string[];
  providers: MonitorProvider[];
  topN: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
}

export interface IdeaDossier {
  id: string;
  sessionId: string;
  conversationKey?: string;
  createdAt: string;
  updatedAt: string;
  rawIdeaText: string;
  mainTopic: string;
  topicGroups: TopicGroup[];
  researchRuns: ResearchRun[];
  repoAssessments: RepoAssessment[];
  notes: string[];
}

export interface ResearchRecord {
  id: string;
  query: string;
  createdAt: string;
  summary: string;
  sources: ResearchSource[];
  sessionId: string;
  conversationKey?: string;
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
  repoRoot: string;
  repoCacheRoot: string;
  storePath: string;
  storeOutboxPath: string;
  storeDriver: 'json' | 'postgres';
  databaseUrl?: string;
  sessionId: string;
  conversationKey: string;
  conversationSource: 'omni' | 'explicit' | 'local';
  omniInstanceId?: string;
  omniChatId?: string;
  hackerNewsApiBase: string;
  hackerNewsUserAgent: string;
  defaultGithubOwner?: string;
  defaultGithubRepo?: string;
  githubToken?: string;
  githubApiBase: string;
  llm: LlmConfig;
  xSearchModel: string;
  xSearchLimit: number;
  fieldTheoryBin?: string;
  fieldTheoryDataDir?: string;
  genieBrainBin: string;
  genieBrainIngestDir: string;
  genieBrainSearchLimit: number;
}
