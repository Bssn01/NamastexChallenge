import { randomUUID } from 'node:crypto';
import { appendJsonLine, readJsonFile, writeJsonFile } from '../lib/json.js';
import type {
  DossierResource,
  IdeaDossier,
  RepoAssessment,
  RepoTargetRef,
  ResearchRecord,
  ResearchRun,
  ResearchRunGroupResult,
  ResearchSource,
  RuntimeMode,
  TopicGroup,
} from '../types.js';

export interface GenieTaskEvent {
  kind: 'task' | 'event';
  id: string;
  sessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface GenieStoreSnapshot {
  version: 2;
  sessionId: string;
  updatedAt: string;
  dossiers: IdeaDossier[];
  records: ResearchRecord[];
  tasks: GenieTaskEvent[];
  events: GenieTaskEvent[];
}

interface LegacyGenieStoreSnapshot {
  version?: 1;
  sessionId?: string;
  updatedAt?: string;
  records?: ResearchRecord[];
  tasks?: GenieTaskEvent[];
  events?: GenieTaskEvent[];
}

export interface CreateDossierInput {
  rawIdeaText: string;
  mainTopic: string;
  topicGroups?: TopicGroup[];
  notes?: string[];
}

export interface AppendResearchRunInput {
  dossierId: string;
  crossGroupSummary: string;
  groupResults: ResearchRunGroupResult[];
  notes?: string[];
  createdAt?: string;
}

export interface SaveRepoAssessmentInput {
  dossierId: string;
  targetRepo: RepoTargetRef | string;
  githubReport: Record<string, unknown>;
  repomixReport: Record<string, unknown>;
  fitSummary: string;
  fitScore?: number;
  strengths?: string[];
  gaps?: string[];
  risks?: string[];
  recommendedNextSteps?: string[];
  notes?: string[];
  createdAt?: string;
}

export interface GenieResearchStore {
  createDossier(input: CreateDossierInput): Promise<IdeaDossier>;
  appendResearchRun(input: AppendResearchRunInput): Promise<ResearchRun>;
  saveRepoAssessment(input: SaveRepoAssessmentInput): Promise<RepoAssessment>;
  listRecentDossiers(limit?: number): Promise<IdeaDossier[]>;
  getDossier(dossierId: string): Promise<IdeaDossier | undefined>;
  recordResearch(input: {
    query: string;
    summary: string;
    sources: ResearchSource[];
    notes?: string[];
  }): Promise<ResearchRecord>;
  listRecent(limit?: number): Promise<ResearchRecord[]>;
  resetSession(): Promise<void>;
  clearAll(): Promise<void>;
  snapshot(): Promise<GenieStoreSnapshot>;
}

export interface GenieResearchStoreOptions {
  mode: RuntimeMode;
  storePath: string;
  outboxPath: string;
  sessionId: string;
}

type GenieEntity =
  | { entityType: 'dossier'; dossier: IdeaDossier }
  | { entityType: 'research-run'; dossier: IdeaDossier; researchRun: ResearchRun }
  | { entityType: 'repo-assessment'; dossier: IdeaDossier; repoAssessment: RepoAssessment };

const emptySnapshot = (sessionId: string): GenieStoreSnapshot => ({
  version: 2,
  sessionId,
  updatedAt: new Date().toISOString(),
  dossiers: [],
  records: [],
  tasks: [],
  events: [],
});

function asTopicGroup(group: TopicGroup): TopicGroup {
  return {
    id: group.id || randomUUID(),
    label: group.label,
    kind: group.kind,
    topics: [...group.topics],
    summary: group.summary,
  };
}

function asDossierResource(resource: DossierResource): DossierResource {
  return {
    ...resource,
    id: resource.id || randomUUID(),
    topicGroupId: resource.topicGroupId,
    tags: resource.tags ? [...resource.tags] : undefined,
    trustLevel: resource.trustLevel || 'external-untrusted',
  };
}

function asResearchRunGroupResult(groupResult: ResearchRunGroupResult): ResearchRunGroupResult {
  return {
    topicGroupId: groupResult.topicGroupId,
    topicGroupLabel: groupResult.topicGroupLabel,
    summary: groupResult.summary,
    resources: groupResult.resources.map(asDossierResource),
    notes: groupResult.notes ? [...groupResult.notes] : [],
  };
}

function asRepoTargetRef(targetRepo: RepoTargetRef | string): RepoTargetRef {
  if (typeof targetRepo === 'string') {
    return {
      canonicalSlug: targetRepo,
    };
  }

  return {
    canonicalSlug: targetRepo.canonicalSlug,
    owner: targetRepo.owner,
    repo: targetRepo.repo,
    sourceUrl: targetRepo.sourceUrl,
    localPath: targetRepo.localPath,
    defaultBranch: targetRepo.defaultBranch,
    notes: targetRepo.notes ? [...targetRepo.notes] : [],
  };
}

function createDefaultTopicGroups(rawIdeaText: string, mainTopic: string): TopicGroup[] {
  const fallbackTopic = mainTopic || rawIdeaText;
  return [
    {
      id: randomUUID(),
      label: 'Main topic',
      kind: 'main',
      topics: [fallbackTopic],
    },
  ];
}

function toDossierResources(
  sources: ResearchSource[],
  topicGroupId: string,
  origin: string,
): DossierResource[] {
  return sources.map((source, index) => ({
    ...source,
    id: source.id || `${topicGroupId}-${index + 1}`,
    topicGroupId,
    origin,
    trustLevel: 'external-untrusted',
  }));
}

function flattenRunResources(researchRun: ResearchRun): ResearchSource[] {
  return researchRun.groupResults.flatMap((groupResult) =>
    groupResult.resources.map(
      ({ topicGroupId: _topicGroupId, origin: _origin, trustLevel: _trust, ...source }) => ({
        ...source,
      }),
    ),
  );
}

function toLegacyResearchRecord(dossier: IdeaDossier, researchRun: ResearchRun): ResearchRecord {
  return {
    id: researchRun.id,
    query: dossier.rawIdeaText,
    createdAt: researchRun.createdAt,
    summary: researchRun.crossGroupSummary,
    sources: flattenRunResources(researchRun),
    sessionId: researchRun.sessionId,
    mode: researchRun.mode,
    notes: [...researchRun.notes],
    dossierId: dossier.id,
    researchRunId: researchRun.id,
  };
}

function sortByCreatedAtDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function sortDossiersByUpdatedAt(dossiers: IdeaDossier[]): IdeaDossier[] {
  return [...dossiers].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function syncLegacyRecords(snapshot: GenieStoreSnapshot): GenieStoreSnapshot {
  snapshot.dossiers = sortDossiersByUpdatedAt(snapshot.dossiers);
  snapshot.records = sortByCreatedAtDesc(
    snapshot.dossiers.flatMap((dossier) =>
      dossier.researchRuns.map((researchRun) => toLegacyResearchRecord(dossier, researchRun)),
    ),
  );
  return snapshot;
}

function migrateRecordToDossier(record: ResearchRecord): IdeaDossier {
  const topicGroupId = `topic-${record.id}`;
  const dossierId = record.dossierId || `dossier-${record.id}`;
  const researchRunId = record.researchRunId || `run-${record.id}`;

  return {
    id: dossierId,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
    rawIdeaText: record.query,
    mainTopic: record.query,
    topicGroups: [
      {
        id: topicGroupId,
        label: 'Main topic',
        kind: 'main',
        topics: [record.query],
        summary: record.summary,
      },
    ],
    researchRuns: [
      {
        id: researchRunId,
        dossierId,
        createdAt: record.createdAt,
        sessionId: record.sessionId,
        mode: record.mode,
        groupResults: [
          {
            topicGroupId,
            topicGroupLabel: 'Main topic',
            summary: record.summary,
            resources: toDossierResources(record.sources, topicGroupId, 'legacy-record'),
            notes: [...record.notes],
          },
        ],
        crossGroupSummary: record.summary,
        notes: [...record.notes],
      },
    ],
    repoAssessments: [],
    mode: record.mode,
    notes: [...record.notes],
  };
}

function normalizeDossier(
  dossier: IdeaDossier,
  fallbackSessionId: string,
  fallbackMode: RuntimeMode,
): IdeaDossier {
  const topicGroups =
    dossier.topicGroups && dossier.topicGroups.length > 0
      ? dossier.topicGroups.map(asTopicGroup)
      : createDefaultTopicGroups(dossier.rawIdeaText, dossier.mainTopic);

  return {
    id: dossier.id,
    sessionId: dossier.sessionId || fallbackSessionId,
    createdAt: dossier.createdAt,
    updatedAt: dossier.updatedAt || dossier.createdAt,
    rawIdeaText: dossier.rawIdeaText,
    mainTopic: dossier.mainTopic || dossier.rawIdeaText,
    topicGroups,
    researchRuns: sortByCreatedAtDesc(
      (dossier.researchRuns || []).map((researchRun) => ({
        id: researchRun.id,
        dossierId: dossier.id,
        createdAt: researchRun.createdAt,
        sessionId: researchRun.sessionId || dossier.sessionId || fallbackSessionId,
        mode: researchRun.mode || dossier.mode || fallbackMode,
        groupResults: (researchRun.groupResults || []).map(asResearchRunGroupResult),
        crossGroupSummary: researchRun.crossGroupSummary,
        notes: researchRun.notes ? [...researchRun.notes] : [],
      })),
    ),
    repoAssessments: sortByCreatedAtDesc(
      (dossier.repoAssessments || []).map((repoAssessment) => ({
        id: repoAssessment.id,
        dossierId: dossier.id,
        createdAt: repoAssessment.createdAt,
        targetRepo: asRepoTargetRef(repoAssessment.targetRepo),
        githubReport: { ...repoAssessment.githubReport },
        repomixReport: { ...repoAssessment.repomixReport },
        fitSummary: repoAssessment.fitSummary,
        fitScore: repoAssessment.fitScore,
        strengths: repoAssessment.strengths ? [...repoAssessment.strengths] : [],
        gaps: repoAssessment.gaps ? [...repoAssessment.gaps] : [],
        risks: repoAssessment.risks ? [...repoAssessment.risks] : [],
        recommendedNextSteps: repoAssessment.recommendedNextSteps
          ? [...repoAssessment.recommendedNextSteps]
          : [],
        notes: repoAssessment.notes ? [...repoAssessment.notes] : [],
      })),
    ),
    mode: dossier.mode || fallbackMode,
    notes: dossier.notes ? [...dossier.notes] : [],
  };
}

function normalizeSnapshot(
  raw: GenieStoreSnapshot | LegacyGenieStoreSnapshot,
  sessionId: string,
  mode: RuntimeMode,
): GenieStoreSnapshot {
  if ('dossiers' in raw && Array.isArray(raw.dossiers)) {
    return syncLegacyRecords({
      version: 2,
      sessionId: raw.sessionId || sessionId,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      dossiers: raw.dossiers.map((dossier) => normalizeDossier(dossier, sessionId, mode)),
      records: Array.isArray(raw.records) ? raw.records : [],
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      events: Array.isArray(raw.events) ? raw.events : [],
    });
  }

  const migratedSnapshot: GenieStoreSnapshot = {
    version: 2,
    sessionId: raw.sessionId || sessionId,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    dossiers: Array.isArray(raw.records) ? raw.records.map(migrateRecordToDossier) : [],
    records: [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    events: Array.isArray(raw.events) ? raw.events : [],
  };

  return syncLegacyRecords(migratedSnapshot);
}

function collectSourceProviders(resources: DossierResource[]): string[] {
  return [...new Set(resources.map((resource) => resource.provider))];
}

export function toGenieTaskEvent(entity: GenieEntity): GenieTaskEvent {
  if (entity.entityType === 'dossier') {
    return {
      kind: 'task',
      id: `task_dossier_${entity.dossier.id}`,
      sessionId: entity.dossier.sessionId,
      createdAt: entity.dossier.createdAt,
      payload: {
        action: 'dossier.created',
        dossierId: entity.dossier.id,
        mainTopic: entity.dossier.mainTopic,
        rawIdeaText: entity.dossier.rawIdeaText,
        topicGroupCount: entity.dossier.topicGroups.length,
        mode: entity.dossier.mode,
      },
    };
  }

  if (entity.entityType === 'research-run') {
    const resources = entity.researchRun.groupResults.flatMap(
      (groupResult) => groupResult.resources,
    );
    return {
      kind: 'task',
      id: `task_research_run_${entity.researchRun.id}`,
      sessionId: entity.researchRun.sessionId,
      createdAt: entity.researchRun.createdAt,
      payload: {
        action: 'research.run.appended',
        dossierId: entity.dossier.id,
        researchRunId: entity.researchRun.id,
        crossGroupSummary: entity.researchRun.crossGroupSummary,
        topicGroupCount: entity.researchRun.groupResults.length,
        resourceCount: resources.length,
        sourceProviders: collectSourceProviders(resources),
        mode: entity.researchRun.mode,
      },
    };
  }

  return {
    kind: 'task',
    id: `task_repo_assessment_${entity.repoAssessment.id}`,
    sessionId: entity.dossier.sessionId,
    createdAt: entity.repoAssessment.createdAt,
    payload: {
      action: 'repo.assessment.saved',
      dossierId: entity.dossier.id,
      repoAssessmentId: entity.repoAssessment.id,
      targetRepo: entity.repoAssessment.targetRepo.canonicalSlug,
      fitScore: entity.repoAssessment.fitScore,
      mode: entity.dossier.mode,
    },
  };
}

export function toGenieEvent(entity: GenieEntity): GenieTaskEvent {
  if (entity.entityType === 'dossier') {
    return {
      kind: 'event',
      id: `event_dossier_${entity.dossier.id}`,
      sessionId: entity.dossier.sessionId,
      createdAt: entity.dossier.createdAt,
      payload: {
        action: 'dossier.created',
        dossierId: entity.dossier.id,
        sessionId: entity.dossier.sessionId,
        topicGroups: entity.dossier.topicGroups.map((group) => group.label),
        noteCount: entity.dossier.notes.length,
      },
    };
  }

  if (entity.entityType === 'research-run') {
    return {
      kind: 'event',
      id: `event_research_run_${entity.researchRun.id}`,
      sessionId: entity.researchRun.sessionId,
      createdAt: entity.researchRun.createdAt,
      payload: {
        action: 'research.run.appended',
        dossierId: entity.dossier.id,
        researchRunId: entity.researchRun.id,
        topicGroupIds: entity.researchRun.groupResults.map(
          (groupResult) => groupResult.topicGroupId,
        ),
        noteCount: entity.researchRun.notes.length,
      },
    };
  }

  return {
    kind: 'event',
    id: `event_repo_assessment_${entity.repoAssessment.id}`,
    sessionId: entity.dossier.sessionId,
    createdAt: entity.repoAssessment.createdAt,
    payload: {
      action: 'repo.assessment.saved',
      dossierId: entity.dossier.id,
      repoAssessmentId: entity.repoAssessment.id,
      targetRepo: entity.repoAssessment.targetRepo.canonicalSlug,
      gapCount: entity.repoAssessment.gaps.length,
      riskCount: entity.repoAssessment.risks.length,
    },
  };
}

export function createGenieResearchStore(options: GenieResearchStoreOptions): GenieResearchStore {
  let statePromise: Promise<GenieStoreSnapshot> | null = null;
  let currentSessionId = options.sessionId;

  async function loadState(): Promise<GenieStoreSnapshot> {
    if (!statePromise) {
      statePromise = readJsonFile<GenieStoreSnapshot | LegacyGenieStoreSnapshot>(
        options.storePath,
        emptySnapshot(currentSessionId),
      ).then((snapshot) => normalizeSnapshot(snapshot, currentSessionId, options.mode));
    }
    return statePromise;
  }

  async function saveState(snapshot: GenieStoreSnapshot): Promise<void> {
    snapshot.updatedAt = new Date().toISOString();
    syncLegacyRecords(snapshot);
    statePromise = Promise.resolve(snapshot);
    await writeJsonFile(options.storePath, snapshot);
  }

  async function emitOutbox(entry: GenieTaskEvent): Promise<void> {
    if (options.mode === 'real') {
      await appendJsonLine(options.outboxPath, {
        ...entry,
        transport: 'genie-local-outbox',
        mappedTo: entry.kind === 'task' ? 'Genie task' : 'Genie event',
      });
    }
  }

  async function emitEntries(...entries: GenieTaskEvent[]): Promise<void> {
    for (const entry of entries) {
      await emitOutbox(entry);
    }
  }

  async function createDossierInternal(
    input: CreateDossierInput,
    emit = true,
  ): Promise<{ snapshot: GenieStoreSnapshot; dossier: IdeaDossier }> {
    const snapshot = await loadState();
    const now = new Date().toISOString();
    const dossier: IdeaDossier = {
      id: randomUUID(),
      sessionId: currentSessionId,
      createdAt: now,
      updatedAt: now,
      rawIdeaText: input.rawIdeaText,
      mainTopic: input.mainTopic,
      topicGroups:
        input.topicGroups && input.topicGroups.length > 0
          ? input.topicGroups.map(asTopicGroup)
          : createDefaultTopicGroups(input.rawIdeaText, input.mainTopic),
      researchRuns: [],
      repoAssessments: [],
      mode: options.mode,
      notes: input.notes ? [...input.notes] : [],
    };

    snapshot.dossiers.unshift(dossier);

    if (emit) {
      snapshot.tasks.unshift(toGenieTaskEvent({ entityType: 'dossier', dossier }));
      snapshot.events.unshift(toGenieEvent({ entityType: 'dossier', dossier }));
    }

    await saveState(snapshot);

    if (emit) {
      await emitEntries(snapshot.tasks[0], snapshot.events[0]);
    }

    return { snapshot, dossier };
  }

  async function appendResearchRunInternal(
    input: AppendResearchRunInput,
    emit = true,
  ): Promise<{ snapshot: GenieStoreSnapshot; dossier: IdeaDossier; researchRun: ResearchRun }> {
    const snapshot = await loadState();
    const dossier = snapshot.dossiers.find((candidate) => candidate.id === input.dossierId);

    if (!dossier) {
      throw new Error(`Unknown dossier: ${input.dossierId}`);
    }

    const researchRun: ResearchRun = {
      id: randomUUID(),
      dossierId: dossier.id,
      createdAt: input.createdAt || new Date().toISOString(),
      sessionId: dossier.sessionId,
      mode: dossier.mode,
      groupResults: input.groupResults.map(asResearchRunGroupResult),
      crossGroupSummary: input.crossGroupSummary,
      notes: input.notes ? [...input.notes] : [],
    };

    dossier.researchRuns.unshift(researchRun);
    dossier.updatedAt = researchRun.createdAt;

    if (emit) {
      snapshot.tasks.unshift(
        toGenieTaskEvent({ entityType: 'research-run', dossier, researchRun }),
      );
      snapshot.events.unshift(toGenieEvent({ entityType: 'research-run', dossier, researchRun }));
    }

    await saveState(snapshot);

    if (emit) {
      await emitEntries(snapshot.tasks[0], snapshot.events[0]);
    }

    return { snapshot, dossier, researchRun };
  }

  async function saveRepoAssessmentInternal(
    input: SaveRepoAssessmentInput,
    emit = true,
  ): Promise<{
    snapshot: GenieStoreSnapshot;
    dossier: IdeaDossier;
    repoAssessment: RepoAssessment;
  }> {
    const snapshot = await loadState();
    const dossier = snapshot.dossiers.find((candidate) => candidate.id === input.dossierId);

    if (!dossier) {
      throw new Error(`Unknown dossier: ${input.dossierId}`);
    }

    const repoAssessment: RepoAssessment = {
      id: randomUUID(),
      dossierId: dossier.id,
      createdAt: input.createdAt || new Date().toISOString(),
      targetRepo: asRepoTargetRef(input.targetRepo),
      githubReport: { ...input.githubReport },
      repomixReport: { ...input.repomixReport },
      fitSummary: input.fitSummary,
      fitScore: input.fitScore,
      strengths: input.strengths ? [...input.strengths] : [],
      gaps: input.gaps ? [...input.gaps] : [],
      risks: input.risks ? [...input.risks] : [],
      recommendedNextSteps: input.recommendedNextSteps ? [...input.recommendedNextSteps] : [],
      notes: input.notes ? [...input.notes] : [],
    };

    dossier.repoAssessments.unshift(repoAssessment);
    dossier.updatedAt = repoAssessment.createdAt;

    if (emit) {
      snapshot.tasks.unshift(
        toGenieTaskEvent({ entityType: 'repo-assessment', dossier, repoAssessment }),
      );
      snapshot.events.unshift(
        toGenieEvent({ entityType: 'repo-assessment', dossier, repoAssessment }),
      );
    }

    await saveState(snapshot);

    if (emit) {
      await emitEntries(snapshot.tasks[0], snapshot.events[0]);
    }

    return { snapshot, dossier, repoAssessment };
  }

  return {
    async createDossier(input): Promise<IdeaDossier> {
      const { dossier } = await createDossierInternal(input, true);
      return dossier;
    },

    async appendResearchRun(input): Promise<ResearchRun> {
      const { researchRun } = await appendResearchRunInternal(input, true);
      return researchRun;
    },

    async saveRepoAssessment(input): Promise<RepoAssessment> {
      const { repoAssessment } = await saveRepoAssessmentInternal(input, true);
      return repoAssessment;
    },

    async listRecentDossiers(limit = 5): Promise<IdeaDossier[]> {
      const snapshot = await loadState();
      return snapshot.dossiers.slice(0, limit);
    },

    async getDossier(dossierId: string): Promise<IdeaDossier | undefined> {
      const snapshot = await loadState();
      return snapshot.dossiers.find((dossier) => dossier.id === dossierId);
    },

    async recordResearch(input): Promise<ResearchRecord> {
      const { dossier } = await createDossierInternal(
        {
          rawIdeaText: input.query,
          mainTopic: input.query,
          notes: input.notes,
        },
        false,
      );
      const mainTopicGroup = dossier.topicGroups[0];
      const { researchRun } = await appendResearchRunInternal(
        {
          dossierId: dossier.id,
          crossGroupSummary: input.summary,
          groupResults: [
            {
              topicGroupId: mainTopicGroup.id,
              topicGroupLabel: mainTopicGroup.label,
              summary: input.summary,
              resources: toDossierResources(
                input.sources,
                mainTopicGroup.id,
                'compat-record-research',
              ),
              notes: input.notes,
            },
          ],
          notes: input.notes,
        },
        true,
      );

      return toLegacyResearchRecord(dossier, researchRun);
    },

    async listRecent(limit = 5): Promise<ResearchRecord[]> {
      const snapshot = await loadState();
      return snapshot.records.slice(0, limit);
    },

    async resetSession(): Promise<void> {
      const snapshot = await loadState();
      currentSessionId = randomUUID();
      snapshot.sessionId = currentSessionId;
      await saveState(snapshot);
    },

    async clearAll(): Promise<void> {
      await saveState(emptySnapshot(currentSessionId));
    },

    async snapshot(): Promise<GenieStoreSnapshot> {
      return loadState();
    },
  };
}
