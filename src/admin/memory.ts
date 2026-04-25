import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadConfig } from '../config.js';
import { newSessionId } from '../lib/conversation.js';
import type { GenieStoreSnapshot } from '../store/genie-research-store.js';
import type { MonitorSubscription } from '../types.js';
import { readEnvValues } from './env.js';

export interface MemoryConversationSummary {
  conversationKey: string;
  activeSessionId?: string;
  dossierCount: number;
  researchRunCount: number;
  repoAssessmentCount: number;
  monitorCount: number;
  taskCount: number;
  eventCount: number;
  outboxCount: number;
  latestAt?: string;
  topics: string[];
}

export interface MemorySnapshot {
  driver: 'json' | 'postgres';
  available: boolean;
  storePath?: string;
  databaseConfigured?: boolean;
  updatedAt: string;
  conversations: MemoryConversationSummary[];
  raw?: unknown;
  error?: string;
}

export interface ReadMemorySnapshotOptions {
  includeRaw?: boolean;
}

function emptySummary(conversationKey: string): MemoryConversationSummary {
  return {
    conversationKey,
    dossierCount: 0,
    researchRunCount: 0,
    repoAssessmentCount: 0,
    monitorCount: 0,
    taskCount: 0,
    eventCount: 0,
    outboxCount: 0,
    topics: [],
  };
}

function touch(summary: MemoryConversationSummary, date?: string): void {
  if (!date) return;
  if (!summary.latestAt || date.localeCompare(summary.latestAt) > 0) {
    summary.latestAt = date;
  }
}

function addTopic(summary: MemoryConversationSummary, topic?: string): void {
  if (!topic) return;
  if (!summary.topics.includes(topic)) summary.topics.push(topic);
  summary.topics = summary.topics.slice(0, 8);
}

async function readJsonSnapshot(path: string): Promise<GenieStoreSnapshot | undefined> {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as GenieStoreSnapshot;
}

async function writeJsonSnapshot(path: string, snapshot: GenieStoreSnapshot): Promise<void> {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

function summarizeJsonStore(snapshot: GenieStoreSnapshot | undefined): MemoryConversationSummary[] {
  const summaries = new Map<string, MemoryConversationSummary>();
  const getSummary = (conversationKey: string) => {
    const existing = summaries.get(conversationKey);
    if (existing) return existing;
    const next = emptySummary(conversationKey);
    summaries.set(conversationKey, next);
    return next;
  };

  for (const dossier of snapshot?.dossiers || []) {
    const key = dossier.conversationKey || 'local:demo';
    const summary = getSummary(key);
    summary.activeSessionId ||= dossier.sessionId;
    summary.dossierCount += 1;
    summary.researchRunCount += dossier.researchRuns.length;
    summary.repoAssessmentCount += dossier.repoAssessments.length;
    touch(summary, dossier.updatedAt || dossier.createdAt);
    addTopic(summary, dossier.mainTopic);
  }

  for (const monitor of snapshot?.monitorSubscriptions || []) {
    const summary = getSummary(monitor.conversationKey);
    summary.activeSessionId ||= monitor.sessionId;
    summary.monitorCount += 1;
    touch(summary, monitor.updatedAt || monitor.createdAt);
    for (const topic of monitor.topics) addTopic(summary, topic);
  }

  for (const task of snapshot?.tasks || []) {
    const key = task.conversationKey || task.sessionId || 'local:demo';
    const summary = getSummary(key);
    summary.taskCount += 1;
    touch(summary, task.createdAt);
  }

  for (const event of snapshot?.events || []) {
    const key = event.conversationKey || event.sessionId || 'local:demo';
    const summary = getSummary(key);
    summary.eventCount += 1;
    touch(summary, event.createdAt);
  }

  return [...summaries.values()].sort((left, right) =>
    (right.latestAt || '').localeCompare(left.latestAt || ''),
  );
}

async function summarizePostgres(databaseUrl: string): Promise<MemoryConversationSummary[]> {
  const sql = postgres(databaseUrl, { idle_timeout: 1, max: 2 });
  try {
    const sessions = await sql<
      {
        conversation_key: string;
        active_session_id: string;
        metadata: { monitorSubscriptions?: MonitorSubscription[] };
        updated_at: Date;
      }[]
    >`
      SELECT conversation_key, active_session_id, metadata, updated_at
      FROM conversation_sessions
      ORDER BY updated_at DESC
    `;
    const dossiers = await sql<
      {
        conversation_key: string;
        payload: {
          mainTopic?: string;
          updatedAt?: string;
          createdAt?: string;
          researchRuns?: unknown[];
          repoAssessments?: unknown[];
        };
      }[]
    >`
      SELECT conversation_key, payload
      FROM research_dossiers
    `;
    const outbox = await sql<{ conversation_key: string; count: string }[]>`
      SELECT conversation_key, count(*)::text AS count
      FROM genie_outbox
      GROUP BY conversation_key
    `;

    const summaries = new Map<string, MemoryConversationSummary>();
    const getSummary = (conversationKey: string) => {
      const existing = summaries.get(conversationKey);
      if (existing) return existing;
      const next = emptySummary(conversationKey);
      summaries.set(conversationKey, next);
      return next;
    };

    for (const session of sessions) {
      const summary = getSummary(session.conversation_key);
      summary.activeSessionId = session.active_session_id;
      touch(summary, session.updated_at.toISOString());
      const monitors = Array.isArray(session.metadata?.monitorSubscriptions)
        ? session.metadata.monitorSubscriptions
        : [];
      summary.monitorCount += monitors.length;
      for (const monitor of monitors) {
        for (const topic of monitor.topics || []) addTopic(summary, topic);
        touch(summary, monitor.updatedAt || monitor.createdAt);
      }
    }

    for (const dossier of dossiers) {
      const summary = getSummary(dossier.conversation_key);
      summary.dossierCount += 1;
      summary.researchRunCount += Array.isArray(dossier.payload.researchRuns)
        ? dossier.payload.researchRuns.length
        : 0;
      summary.repoAssessmentCount += Array.isArray(dossier.payload.repoAssessments)
        ? dossier.payload.repoAssessments.length
        : 0;
      addTopic(summary, dossier.payload.mainTopic);
      touch(summary, dossier.payload.updatedAt || dossier.payload.createdAt);
    }

    for (const row of outbox) {
      getSummary(row.conversation_key).outboxCount = Number(row.count || 0);
    }

    return [...summaries.values()].sort((left, right) =>
      (right.latestAt || '').localeCompare(left.latestAt || ''),
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function readPostgresRaw(databaseUrl: string): Promise<Record<string, unknown>> {
  const sql = postgres(databaseUrl, { idle_timeout: 1, max: 2 });
  try {
    const sessions = await sql`
      SELECT *
      FROM conversation_sessions
      ORDER BY updated_at DESC
    `;
    const dossiers = await sql`
      SELECT *
      FROM research_dossiers
      ORDER BY updated_at DESC
    `;
    const outbox = await sql`
      SELECT *
      FROM genie_outbox
      ORDER BY created_at DESC
      LIMIT 500
    `;
    return { sessions, dossiers, outbox };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function readMemorySnapshot(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ReadMemorySnapshotOptions = {},
): Promise<MemorySnapshot> {
  const values = await readEnvValues(repoRoot, env);
  const config = loadConfig(
    { ...values, NAMASTEX_REPO_ROOT: values.NAMASTEX_REPO_ROOT || repoRoot },
    {
      allowPartial: true,
    },
  );
  const updatedAt = new Date().toISOString();

  if (config.storeDriver === 'postgres') {
    if (!config.databaseUrl) {
      return {
        driver: 'postgres',
        available: false,
        databaseConfigured: false,
        updatedAt,
        conversations: [],
        error: 'NAMASTEX_DATABASE_URL or DATABASE_URL is not configured.',
      };
    }
    try {
      return {
        driver: 'postgres',
        available: true,
        databaseConfigured: true,
        updatedAt,
        conversations: await summarizePostgres(config.databaseUrl),
        raw: options.includeRaw ? await readPostgresRaw(config.databaseUrl) : undefined,
      };
    } catch (error) {
      return {
        driver: 'postgres',
        available: false,
        databaseConfigured: true,
        updatedAt,
        conversations: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const snapshot = await readJsonSnapshot(config.storePath);
  return {
    driver: 'json',
    available: Boolean(snapshot),
    storePath: config.storePath,
    updatedAt,
    conversations: summarizeJsonStore(snapshot),
    raw: options.includeRaw ? snapshot : undefined,
  };
}

export async function resetMemoryConversation(
  repoRoot: string,
  conversationKey: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ sessionId: string }> {
  const values = await readEnvValues(repoRoot, env);
  const config = loadConfig(
    { ...values, NAMASTEX_REPO_ROOT: values.NAMASTEX_REPO_ROOT || repoRoot },
    {
      allowPartial: true,
    },
  );
  const sessionId = newSessionId(conversationKey);

  if (config.storeDriver === 'postgres') {
    if (!config.databaseUrl) throw new Error('Postgres database URL is not configured.');
    const sql = postgres(config.databaseUrl, { idle_timeout: 1, max: 2 });
    try {
      await sql`
        INSERT INTO conversation_sessions (conversation_key, active_session_id)
        VALUES (${conversationKey}, ${sessionId})
        ON CONFLICT (conversation_key) DO UPDATE
        SET active_session_id = EXCLUDED.active_session_id,
            updated_at = now()
      `;
    } finally {
      await sql.end({ timeout: 1 });
    }
    return { sessionId };
  }

  const snapshot =
    (await readJsonSnapshot(config.storePath)) ||
    ({
      version: 2,
      sessionId,
      updatedAt: new Date().toISOString(),
      dossiers: [],
      monitorSubscriptions: [],
      records: [],
      tasks: [],
      events: [],
    } satisfies GenieStoreSnapshot);
  snapshot.sessionId = sessionId;
  snapshot.updatedAt = new Date().toISOString();
  await writeJsonSnapshot(config.storePath, snapshot);
  return { sessionId };
}

export async function clearMemoryConversation(
  repoRoot: string,
  conversationKey: string,
  confirm: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ cleared: boolean }> {
  if (confirm !== 'CLEAR MEMORY') {
    throw new Error('Clearing memory requires the exact confirmation text CLEAR MEMORY.');
  }
  const values = await readEnvValues(repoRoot, env);
  const config = loadConfig(
    { ...values, NAMASTEX_REPO_ROOT: values.NAMASTEX_REPO_ROOT || repoRoot },
    {
      allowPartial: true,
    },
  );

  if (config.storeDriver === 'postgres') {
    if (!config.databaseUrl) throw new Error('Postgres database URL is not configured.');
    const sql = postgres(config.databaseUrl, { idle_timeout: 1, max: 2 });
    try {
      await sql`DELETE FROM research_dossiers WHERE conversation_key = ${conversationKey}`;
      await sql`DELETE FROM genie_outbox WHERE conversation_key = ${conversationKey}`;
      await sql`
        UPDATE conversation_sessions
        SET metadata = '{}'::jsonb,
            updated_at = now()
        WHERE conversation_key = ${conversationKey}
      `;
    } finally {
      await sql.end({ timeout: 1 });
    }
    return { cleared: true };
  }

  const snapshot = await readJsonSnapshot(config.storePath);
  if (!snapshot) return { cleared: true };
  snapshot.dossiers = snapshot.dossiers.filter(
    (dossier) => (dossier.conversationKey || 'local:demo') !== conversationKey,
  );
  snapshot.monitorSubscriptions = snapshot.monitorSubscriptions.filter(
    (monitor) => monitor.conversationKey !== conversationKey,
  );
  snapshot.records = snapshot.records.filter(
    (record) => (record.conversationKey || 'local:demo') !== conversationKey,
  );
  snapshot.tasks = snapshot.tasks.filter(
    (task) => (task.conversationKey || task.sessionId) !== conversationKey,
  );
  snapshot.events = snapshot.events.filter(
    (event) => (event.conversationKey || event.sessionId) !== conversationKey,
  );
  snapshot.updatedAt = new Date().toISOString();
  await writeJsonSnapshot(config.storePath, snapshot);
  return { cleared: true };
}

export function defaultMemoryStorePath(repoRoot: string): string {
  return resolve(repoRoot, 'data', 'genie-research-store.json');
}
