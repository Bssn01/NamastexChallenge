import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { newSessionId } from '../lib/conversation.js';
import type {
  IdeaDossier,
  MonitorSubscription,
  RepoAssessment,
  ResearchRecord,
  ResearchRun,
  ResearchSource,
} from '../types.js';
import type {
  AppendResearchRunInput,
  CreateDossierInput,
  GenieResearchStore,
  GenieStoreSnapshot,
  GenieTaskEvent,
  SaveRepoAssessmentInput,
} from './genie-research-store.js';
import { toGenieEvent, toGenieTaskEvent } from './genie-research-store.js';

export interface PostgresResearchStoreOptions {
  databaseUrl: string;
  sessionId: string;
  conversationKey: string;
}

type Sql = ReturnType<typeof postgres>;

function sortByCreatedAtDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

function toResearchRecord(dossier: IdeaDossier, researchRun: ResearchRun): ResearchRecord {
  return {
    id: researchRun.id,
    query: dossier.rawIdeaText,
    createdAt: researchRun.createdAt,
    summary: researchRun.crossGroupSummary,
    sources: flattenRunResources(researchRun),
    sessionId: researchRun.sessionId,
    conversationKey: dossier.conversationKey,
    notes: [...researchRun.notes],
    dossierId: dossier.id,
    researchRunId: researchRun.id,
  };
}

function asDossier(payload: unknown, conversationKey: string, sessionId: string): IdeaDossier {
  const dossier = payload as IdeaDossier;
  return {
    ...dossier,
    conversationKey: dossier.conversationKey || conversationKey,
    sessionId: dossier.sessionId || sessionId,
    researchRuns: sortByCreatedAtDesc(
      (dossier.researchRuns || []).map((run) => ({
        ...run,
        conversationKey: run.conversationKey || dossier.conversationKey || conversationKey,
        sessionId: run.sessionId || dossier.sessionId || sessionId,
        notes: run.notes || [],
      })),
    ),
    repoAssessments: sortByCreatedAtDesc(dossier.repoAssessments || []),
    notes: dossier.notes || [],
  };
}

function monitorSubscriptionsFromMetadata(metadata: unknown): MonitorSubscription[] {
  const value = metadata as { monitorSubscriptions?: MonitorSubscription[] } | undefined;
  return Array.isArray(value?.monitorSubscriptions) ? value.monitorSubscriptions : [];
}

async function migrate(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      conversation_key TEXT PRIMARY KEY,
      active_session_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS research_dossiers (
      id TEXT PRIMARY KEY,
      conversation_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS research_dossiers_conversation_updated_idx
    ON research_dossiers (conversation_key, updated_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS genie_outbox (
      id TEXT PRIMARY KEY,
      conversation_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )
  `;
}

export function createPostgresResearchStore(
  options: PostgresResearchStoreOptions,
): GenieResearchStore {
  const sql = postgres(options.databaseUrl, { idle_timeout: 1, max: 5 });
  let migrated: Promise<void> | undefined;
  let currentSessionId = options.sessionId;

  async function ensureReady(): Promise<void> {
    if (!migrated) {
      migrated = migrate(sql).then(async () => {
        const rows = await sql<{ active_session_id: string }[]>`
          INSERT INTO conversation_sessions (conversation_key, active_session_id)
          VALUES (${options.conversationKey}, ${currentSessionId})
          ON CONFLICT (conversation_key) DO UPDATE
          SET updated_at = conversation_sessions.updated_at
          RETURNING active_session_id
        `;
        currentSessionId = rows[0]?.active_session_id || currentSessionId;
      });
    }
    await migrated;
  }

  async function saveDossier(dossier: IdeaDossier): Promise<void> {
    await sql`
      INSERT INTO research_dossiers (
        id,
        conversation_key,
        session_id,
        payload,
        created_at,
        updated_at
      )
      VALUES (
        ${dossier.id},
        ${options.conversationKey},
        ${dossier.sessionId},
        ${sql.json(dossier as never)},
        ${dossier.createdAt},
        ${dossier.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE
      SET
        conversation_key = EXCLUDED.conversation_key,
        session_id = EXCLUDED.session_id,
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at
    `;
  }

  async function emitOutbox(entry: GenieTaskEvent): Promise<void> {
    await sql`
      INSERT INTO genie_outbox (id, conversation_key, session_id, kind, payload, created_at)
      VALUES (
        ${entry.id},
        ${options.conversationKey},
        ${entry.sessionId},
        ${entry.kind},
        ${sql.json({
          ...entry,
          transport: 'genie-postgres-outbox',
          mappedTo: entry.kind === 'task' ? 'Genie task' : 'Genie event',
        } as never)},
        ${entry.createdAt}
      )
      ON CONFLICT (id) DO UPDATE
      SET payload = EXCLUDED.payload
    `;
  }

  async function getDossierInternal(dossierId: string): Promise<IdeaDossier | undefined> {
    await ensureReady();
    const rows = await sql<{ payload: unknown }[]>`
      SELECT payload
      FROM research_dossiers
      WHERE id = ${dossierId}
        AND conversation_key = ${options.conversationKey}
      LIMIT 1
    `;
    const payload = rows[0]?.payload;
    return payload ? asDossier(payload, options.conversationKey, currentSessionId) : undefined;
  }

  async function readConversationMetadata(): Promise<Record<string, unknown>> {
    await ensureReady();
    const rows = await sql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata
      FROM conversation_sessions
      WHERE conversation_key = ${options.conversationKey}
      LIMIT 1
    `;
    return rows[0]?.metadata || {};
  }

  async function writeConversationMetadata(metadata: Record<string, unknown>): Promise<void> {
    await ensureReady();
    await sql`
      UPDATE conversation_sessions
      SET metadata = ${sql.json(metadata as never)},
          updated_at = now()
      WHERE conversation_key = ${options.conversationKey}
    `;
  }

  return {
    async createDossier(input: CreateDossierInput): Promise<IdeaDossier> {
      await ensureReady();
      const now = new Date().toISOString();
      const dossier: IdeaDossier = {
        id: randomUUID(),
        sessionId: currentSessionId,
        conversationKey: options.conversationKey,
        createdAt: now,
        updatedAt: now,
        rawIdeaText: input.rawIdeaText,
        mainTopic: input.mainTopic,
        topicGroups:
          input.topicGroups && input.topicGroups.length > 0
            ? input.topicGroups
            : [
                {
                  id: randomUUID(),
                  label: 'Main topic',
                  kind: 'main',
                  topics: [input.mainTopic || input.rawIdeaText],
                },
              ],
        researchRuns: [],
        repoAssessments: [],
        notes: input.notes ? [...input.notes] : [],
      };

      await saveDossier(dossier);
      await emitOutbox(toGenieTaskEvent({ entityType: 'dossier', dossier }));
      await emitOutbox(toGenieEvent({ entityType: 'dossier', dossier }));
      return dossier;
    },

    async appendResearchRun(input: AppendResearchRunInput): Promise<ResearchRun> {
      const dossier = await getDossierInternal(input.dossierId);
      if (!dossier) throw new Error(`Unknown dossier: ${input.dossierId}`);

      const researchRun: ResearchRun = {
        id: randomUUID(),
        dossierId: dossier.id,
        createdAt: input.createdAt || new Date().toISOString(),
        sessionId: dossier.sessionId,
        conversationKey: dossier.conversationKey,
        groupResults: input.groupResults,
        crossGroupSummary: input.crossGroupSummary,
        notes: input.notes ? [...input.notes] : [],
      };

      dossier.researchRuns = [researchRun, ...dossier.researchRuns];
      dossier.updatedAt = researchRun.createdAt;
      await saveDossier(dossier);
      await emitOutbox(toGenieTaskEvent({ entityType: 'research-run', dossier, researchRun }));
      await emitOutbox(toGenieEvent({ entityType: 'research-run', dossier, researchRun }));
      return researchRun;
    },

    async saveRepoAssessment(input: SaveRepoAssessmentInput): Promise<RepoAssessment> {
      const dossier = await getDossierInternal(input.dossierId);
      if (!dossier) throw new Error(`Unknown dossier: ${input.dossierId}`);

      const repoAssessment: RepoAssessment = {
        id: randomUUID(),
        dossierId: dossier.id,
        createdAt: input.createdAt || new Date().toISOString(),
        targetRepo:
          typeof input.targetRepo === 'string'
            ? { canonicalSlug: input.targetRepo }
            : {
                ...input.targetRepo,
                notes: input.targetRepo.notes ? [...input.targetRepo.notes] : [],
              },
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

      dossier.repoAssessments = [repoAssessment, ...dossier.repoAssessments];
      dossier.updatedAt = repoAssessment.createdAt;
      await saveDossier(dossier);
      await emitOutbox(
        toGenieTaskEvent({ entityType: 'repo-assessment', dossier, repoAssessment }),
      );
      await emitOutbox(toGenieEvent({ entityType: 'repo-assessment', dossier, repoAssessment }));
      return repoAssessment;
    },

    async listRecentDossiers(limit = 5): Promise<IdeaDossier[]> {
      await ensureReady();
      const rows = await sql<{ payload: unknown }[]>`
        SELECT payload
        FROM research_dossiers
        WHERE conversation_key = ${options.conversationKey}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => asDossier(row.payload, options.conversationKey, currentSessionId));
    },

    getDossier: getDossierInternal,

    async upsertMonitorSubscription(input): Promise<MonitorSubscription> {
      const metadata = await readConversationMetadata();
      const monitors = monitorSubscriptionsFromMetadata(metadata);
      const now = new Date().toISOString();
      const existingIndex = monitors.findIndex(
        (monitor) =>
          monitor.conversationKey === options.conversationKey && monitor.cadence === input.cadence,
      );
      const existing = existingIndex >= 0 ? monitors[existingIndex] : undefined;
      const monitor: MonitorSubscription = {
        id: existing?.id || randomUUID(),
        conversationKey: options.conversationKey,
        sessionId: currentSessionId,
        instanceId: input.instanceId,
        chatId: input.chatId,
        cadence: input.cadence,
        time: input.time,
        timezone: input.timezone,
        topics: [...input.topics],
        niches: input.niches ? [...input.niches] : [],
        providers: [...input.providers],
        topN: input.topN,
        enabled: input.enabled ?? true,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        lastSentAt: existing?.lastSentAt,
      };
      if (existingIndex >= 0) {
        monitors[existingIndex] = monitor;
      } else {
        monitors.unshift(monitor);
      }
      await writeConversationMetadata({ ...metadata, monitorSubscriptions: monitors });
      return monitor;
    },

    async listMonitorSubscriptions(): Promise<MonitorSubscription[]> {
      const metadata = await readConversationMetadata();
      return monitorSubscriptionsFromMetadata(metadata).filter(
        (monitor) => monitor.conversationKey === options.conversationKey,
      );
    },

    async recordResearch(input): Promise<ResearchRecord> {
      const dossier = await this.createDossier({
        rawIdeaText: input.query,
        mainTopic: input.query,
        notes: input.notes,
      });
      const mainTopicGroup = dossier.topicGroups[0];
      const researchRun = await this.appendResearchRun({
        dossierId: dossier.id,
        crossGroupSummary: input.summary,
        groupResults: [
          {
            topicGroupId: mainTopicGroup.id,
            topicGroupLabel: mainTopicGroup.label,
            summary: input.summary,
            resources: input.sources.map((source, index) => ({
              ...source,
              id: source.id || `${mainTopicGroup.id}-${index + 1}`,
              topicGroupId: mainTopicGroup.id,
              origin: 'compat-record-research',
              trustLevel: 'external-untrusted',
            })),
            notes: input.notes,
          },
        ],
        notes: input.notes,
      });
      return toResearchRecord(dossier, researchRun);
    },

    async listRecent(limit = 5): Promise<ResearchRecord[]> {
      const dossiers = await this.listRecentDossiers(limit);
      return sortByCreatedAtDesc(
        dossiers.flatMap((dossier) =>
          dossier.researchRuns.map((researchRun) => toResearchRecord(dossier, researchRun)),
        ),
      ).slice(0, limit);
    },

    async resetSession(): Promise<void> {
      await ensureReady();
      currentSessionId = newSessionId(options.conversationKey);
      await sql`
        UPDATE conversation_sessions
        SET active_session_id = ${currentSessionId},
            updated_at = now()
        WHERE conversation_key = ${options.conversationKey}
      `;
    },

    async clearAll(): Promise<void> {
      await ensureReady();
      await sql`DELETE FROM research_dossiers WHERE conversation_key = ${options.conversationKey}`;
      await sql`DELETE FROM genie_outbox WHERE conversation_key = ${options.conversationKey}`;
    },

    async snapshot(): Promise<GenieStoreSnapshot> {
      const dossiers = await this.listRecentDossiers(100);
      return {
        version: 2,
        sessionId: currentSessionId,
        updatedAt: new Date().toISOString(),
        dossiers,
        monitorSubscriptions: await this.listMonitorSubscriptions(),
        records: sortByCreatedAtDesc(
          dossiers.flatMap((dossier) =>
            dossier.researchRuns.map((researchRun) => toResearchRecord(dossier, researchRun)),
          ),
        ),
        tasks: [],
        events: [],
      };
    },
  };
}
