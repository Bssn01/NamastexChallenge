import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';
import type { MonitorProvider, MonitorSubscription, ResearchSource } from '../src/types.js';

interface UpdateNewsSnapshot {
  monitorSubscriptions?: MonitorSubscription[];
}

interface ProviderNewsResult {
  sources: ResearchSource[];
  notes: string[];
}

function todayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weekKey(date: Date): string {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return `${date.getUTCFullYear()}-W${Math.floor(day / 7) + 1}`;
}

function isDue(monitor: MonitorSubscription, now: Date): boolean {
  if (!monitor.enabled) return false;
  const [hour, minute] = monitor.time.split(':').map((value) => Number(value));
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes =
    (Number.isFinite(hour) ? hour : 9) * 60 + (Number.isFinite(minute) ? minute : 0);
  if (currentMinutes < targetMinutes) return false;
  if (!monitor.lastSentAt) return true;
  const last = new Date(monitor.lastSentAt);
  return monitor.cadence === 'daily'
    ? todayKey(last) !== todayKey(now)
    : weekKey(last) !== weekKey(now);
}

function sendOmni(instanceId: string, chatId: string, text: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'omni',
      ['send', '--instance', instanceId, '--to', chatId, '--text', text],
      {
        stdio: 'inherit',
      },
    );
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`omni send failed with exit code ${code}.`));
    });
  });
}

function formatSource(source: ResearchSource, index: number): string {
  const date = source.publishedAt ? ` • ${source.publishedAt.slice(0, 10)}` : '';
  const url = source.url ? `\n${source.url}` : '';
  return `${index + 1}. ${source.title}${date}\n${source.summary}${url}`;
}

async function collectProviderNews(
  provider: MonitorProvider,
  query: string,
  limit: number,
  env: NodeJS.ProcessEnv,
): Promise<ProviderNewsResult> {
  const runtime = createRuntime(env);
  if (provider === 'x') {
    const result = await runtime.x
      .search(query, limit, {
        rawIdeaText: query,
        mainTopic: query,
        topicGroupLabel: 'Update news',
      })
      .catch((error) => ({
        provider: 'unconfigured' as const,
        configured: false,
        posts: [],
        notes: [
          `X/Tweets search failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      }));
    return {
      sources: result.posts.slice(0, limit),
      notes: result.configured
        ? result.notes
        : [
            'X/Tweets search is not configured. A logged-in X account on the server/browser is not enough for this runtime; configure XAI_API_KEY or OPENROUTER_API_KEY.',
          ],
    };
  }
  if (provider === 'hackernews') {
    const sources = await runtime.hackernews
      .search(query, limit, {
        rawIdeaText: query,
        mainTopic: query,
        topicGroupLabel: 'Update news',
      })
      .catch((error) => {
        return {
          error: `Hacker News search failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      });
    if (!Array.isArray(sources)) {
      return { sources: [], notes: [sources.error] };
    }
    return {
      sources,
      notes: [],
    };
  }
  const sources = await runtime.arxiv
    .search(query, limit, {
      rawIdeaText: query,
      mainTopic: query,
      topicGroupLabel: 'Update news',
    })
    .catch((error) => {
      return {
        error: `arXiv search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    });
  if (!Array.isArray(sources)) {
    return { sources: [], notes: [sources.error] };
  }
  return {
    sources,
    notes: [],
  };
}

async function buildUpdateNewsMessage(
  monitor: MonitorSubscription,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const topic = monitor.topics.join(', ');
  const sections: string[] = [
    `Update news ${monitor.cadence === 'daily' ? 'diário' : 'semanal'}: ${topic}`,
  ];
  for (const provider of monitor.providers) {
    const result = await collectProviderNews(provider, topic, monitor.topN, env);
    const title =
      provider === 'x' ? 'X/Tweets' : provider === 'hackernews' ? 'Hacker News' : 'arXiv';
    sections.push(
      [
        `${title}:`,
        result.sources.length
          ? result.sources.map(formatSource).join('\n\n')
          : 'Nenhum resultado relevante encontrado agora.',
        result.notes.length ? `Notas: ${result.notes.join(' ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return sections.join('\n\n');
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.storeDriver !== 'json') {
    throw new Error(
      'update-news:due currently reads the local JSON store. Use JSON mode for local hosting.',
    );
  }

  const storePath = resolve(config.storePath);
  const snapshot = JSON.parse(await readFile(storePath, 'utf8')) as UpdateNewsSnapshot;
  const monitors = snapshot.monitorSubscriptions || [];
  const now = new Date();

  for (const monitor of monitors) {
    if (!isDue(monitor, now)) continue;
    if (!monitor.instanceId || !monitor.chatId) continue;

    const env = {
      ...process.env,
      OMNI_INSTANCE: monitor.instanceId,
      OMNI_CHAT: monitor.chatId,
    };
    await sendOmni(monitor.instanceId, monitor.chatId, await buildUpdateNewsMessage(monitor, env));
    monitor.lastSentAt = now.toISOString();
    monitor.updatedAt = now.toISOString();
  }

  await writeFile(storePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
