import { randomUUID } from 'node:crypto';
import { appendJsonLine, readJsonFile, writeJsonFile } from '../lib/json.js';
import type { ResearchRecord, ResearchSource, RuntimeMode } from '../types.js';

export interface GenieTaskEvent {
  kind: 'task' | 'event';
  id: string;
  sessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface GenieStoreSnapshot {
  version: 1;
  sessionId: string;
  updatedAt: string;
  records: ResearchRecord[];
  tasks: GenieTaskEvent[];
  events: GenieTaskEvent[];
}

export interface GenieResearchStore {
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

const emptySnapshot = (sessionId: string): GenieStoreSnapshot => ({
  version: 1,
  sessionId,
  updatedAt: new Date().toISOString(),
  records: [],
  tasks: [],
  events: [],
});

export function toGenieTaskEvent(record: ResearchRecord): GenieTaskEvent {
  return {
    kind: 'task',
    id: `task_${record.id}`,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    payload: {
      query: record.query,
      summary: record.summary,
      sourceCount: record.sources.length,
      mode: record.mode,
      sourceProviders: record.sources.map((source) => source.provider),
    },
  };
}

export function toGenieEvent(record: ResearchRecord): GenieTaskEvent {
  return {
    kind: 'event',
    id: `event_${record.id}`,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    payload: {
      query: record.query,
      sessionId: record.sessionId,
      noteCount: record.notes.length,
    },
  };
}

export function createGenieResearchStore(options: GenieResearchStoreOptions): GenieResearchStore {
  let statePromise: Promise<GenieStoreSnapshot> | null = null;
  let currentSessionId = options.sessionId;

  async function loadState(): Promise<GenieStoreSnapshot> {
    if (!statePromise) {
      statePromise = readJsonFile<GenieStoreSnapshot>(
        options.storePath,
        emptySnapshot(currentSessionId),
      );
    }
    return statePromise;
  }

  async function saveState(snapshot: GenieStoreSnapshot): Promise<void> {
    snapshot.updatedAt = new Date().toISOString();
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

  return {
    async recordResearch(input): Promise<ResearchRecord> {
      const snapshot = await loadState();
      const record: ResearchRecord = {
        id: randomUUID(),
        query: input.query,
        createdAt: new Date().toISOString(),
        summary: input.summary,
        sources: input.sources,
        sessionId: currentSessionId,
        mode: options.mode,
        notes: input.notes || [],
      };
      const task = toGenieTaskEvent(record);
      const event = toGenieEvent(record);
      snapshot.records.unshift(record);
      snapshot.tasks.unshift(task);
      snapshot.events.unshift(event);
      await saveState(snapshot);
      await emitOutbox(task);
      await emitOutbox(event);
      return record;
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
