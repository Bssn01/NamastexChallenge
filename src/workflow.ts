import type { ArxivAdapter } from './adapters/arxiv.js';
import type { GitHubLabAdapter, GitHubLabReport } from './adapters/github.js';
import type { GrokAdapter, GrokSummary } from './adapters/grok.js';
import type { HackerNewsAdapter } from './adapters/hackernews.js';
import type { RepomixAdapter, RepomixReport } from './adapters/repomix.js';
import { chunkText, normalizeWhitespace } from './lib/text.js';
import type { GenieResearchStore } from './store/genie-research-store.js';
import type { AppConfig, ResearchRecord, ResearchSource, WhatsAppReply } from './types.js';

export interface AppServices {
  config: AppConfig;
  store: GenieResearchStore;
  arxiv: ArxivAdapter;
  hackernews: HackerNewsAdapter;
  grok: GrokAdapter;
  github: GitHubLabAdapter;
  repomix: RepomixAdapter;
}

export interface WorkflowResult {
  record?: ResearchRecord;
  chunks: string[];
  metadata: Record<string, unknown>;
}

function formatSource(source: ResearchSource, index: number): string {
  const prefix = `${index + 1}. ${source.provider.toUpperCase()}`;
  const published = source.publishedAt ? ` • ${source.publishedAt}` : '';
  const url = source.url ? `\n   ${source.url}` : '';
  return `${prefix}: ${source.title}${published}\n   ${source.summary}${url}`;
}

function formatResearchReply(
  query: string,
  summary: GrokSummary,
  sources: ResearchSource[],
  record: ResearchRecord,
  diagnostics: string[],
): string {
  const topSources = sources.slice(0, 4).map(formatSource).join('\n');
  const lines = [
    `Pesquisa: ${query}`,
    '',
    `Resumo: ${summary.summary}`,
    '',
    `Fontes (${sources.length}):`,
    topSources || '- sem fontes',
    '',
    `Registro: ${record.id}`,
    `Sinal: ${summary.caution}`,
  ];
  if (diagnostics.length > 0) {
    lines.push(`Avisos: ${diagnostics.join(' | ')}`);
  }
  return lines.join('\n');
}

function formatWikiReply(topic: string, recent: ResearchRecord[]): string {
  const current =
    recent.find((record) => record.query.toLowerCase().includes(topic.toLowerCase())) || recent[0];
  if (!current) {
    return `Wiki: ${topic}\n\nAinda não existe base local para esse tópico. Rode /pesquisar primeiro.`;
  }
  const sourceSummary = current.sources
    .slice(0, 3)
    .map((source) => `- ${source.provider}: ${source.title}`)
    .join('\n');
  return [
    `Wiki: ${topic}`,
    '',
    `Tese: ${current.summary}`,
    '',
    'Fontes indexadas:',
    sourceSummary || '- sem fontes',
    '',
    `Última pesquisa: ${current.query}`,
  ].join('\n');
}

function formatSourcesReply(topic: string, sources: ResearchSource[]): string {
  if (sources.length === 0) {
    return `Fontes: ${topic}\n\nNenhuma fonte encontrada.`;
  }
  return [`Fontes: ${topic}`, '', ...sources.map(formatSource)].join('\n');
}

function formatRepoReply(repo: string, github: GitHubLabReport, repomix: RepomixReport): string {
  const issueLines = github.issues
    .map((issue) => `- ${issue.state.toUpperCase()}: ${issue.title}`)
    .join('\n');
  const packPreview = repomix.pack.split(/\r?\n/).slice(0, 12).join('\n');
  return [
    `Repo: ${repo}`,
    '',
    `GitHub: ${github.accessible ? 'ok' : 'fallback'}`,
    `README chars: ${github.readme.length}`,
    `Issues: ${github.issues.length}`,
    '',
    issueLines || '- sem issues nos fixtures',
    '',
    `Repomix: ${repomix.accessible ? 'ok' : 'fallback'}`,
    'Pack preview:',
    packPreview,
  ].join('\n');
}

export async function runPesquisaWorkflow(
  query: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const cleanQuery = normalizeWhitespace(query);
  const [arxiv, hackernews] = await Promise.all([
    services.arxiv.search(cleanQuery, 3),
    services.hackernews.search(cleanQuery, 3),
  ]);
  const sources = [...arxiv, ...hackernews];
  const grok = await services.grok.synthesize(cleanQuery, sources);
  const fallbackProviders = Array.from(
    new Set(
      sources
        .filter((source) => source.tags?.includes('fixture-fallback'))
        .map((source) => source.provider),
    ),
  );
  const diagnostics = [
    ...fallbackProviders.map((provider) => `${provider} caiu para fixture local`),
    ...(services.config.mode === 'real' && grok.provider === 'mock'
      ? ['Grok caiu para síntese mock por falta/falha de chave']
      : []),
  ];
  const record = await services.store.recordResearch({
    query: cleanQuery,
    summary: grok.summary,
    sources,
    notes: [grok.caution, `provider:${grok.provider}`, `model:${grok.model}`, ...diagnostics],
  });
  const text = formatResearchReply(cleanQuery, grok, sources, record, diagnostics);
  return {
    record,
    chunks: chunkText(text),
    metadata: {
      sources,
      grok,
      diagnostics,
    },
  };
}

export async function runWikiWorkflow(
  topic: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const cleanTopic = normalizeWhitespace(topic);
  const recent = await services.store.listRecent(10);
  const text = formatWikiReply(cleanTopic || 'tema recente', recent);
  return {
    chunks: chunkText(text),
    metadata: { recentCount: recent.length },
  };
}

export async function runSourcesWorkflow(
  topic: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const cleanTopic = normalizeWhitespace(topic);
  const recent = await services.store.listRecent(10);
  const matched =
    recent.find((record) => record.query.toLowerCase().includes(cleanTopic.toLowerCase())) ||
    recent[0];
  const sources = matched?.sources || [];
  const text = formatSourcesReply(cleanTopic || matched?.query || 'pesquisa recente', sources);
  return {
    chunks: chunkText(text),
    metadata: { sourceCount: sources.length },
  };
}

export async function runRepoWorkflow(
  target: string | undefined,
  services: AppServices,
): Promise<WorkflowResult> {
  const repo = normalizeWhitespace(
    target ||
      `${services.config.githubOwner || 'unknown'}/${services.config.githubRepo || 'unknown'}`,
  );
  const [github, repomix] = await Promise.all([
    services.github.validateRepository(repo),
    services.repomix.validateRepository(services.config.repoRoot),
  ]);
  const text = formatRepoReply(repo, github, repomix);
  return {
    chunks: chunkText(text),
    metadata: { github, repomix },
  };
}

export async function runResetWorkflow(services: AppServices): Promise<WorkflowResult> {
  await services.store.resetSession();
  return {
    chunks: ['Reset concluído. A sessão local foi reiniciada; a wiki persistente foi preservada.'],
    metadata: {},
  };
}

export async function runUnknownWorkflow(command: string): Promise<WorkflowResult> {
  return {
    chunks: [
      [`Comando: ${command}`, '', 'Use /pesquisar, /wiki, /fontes, /repo ou /reset.'].join('\n'),
    ],
    metadata: {},
  };
}

export async function routeWhatsappCommand(
  text: string,
  services: AppServices,
): Promise<WhatsAppReply> {
  const raw = normalizeWhitespace(text);
  const [command, ...rest] = raw.split(' ');
  const payload = rest.join(' ').trim();

  switch (command.toLowerCase()) {
    case '/pesquisar': {
      const result = await runPesquisaWorkflow(payload, services);
      return { command, chunks: result.chunks, metadata: result.metadata };
    }
    case '/wiki': {
      const result = await runWikiWorkflow(payload, services);
      return { command, chunks: result.chunks, metadata: result.metadata };
    }
    case '/fontes': {
      const result = await runSourcesWorkflow(payload, services);
      return { command, chunks: result.chunks, metadata: result.metadata };
    }
    case '/repo': {
      const result = await runRepoWorkflow(payload, services);
      return { command, chunks: result.chunks, metadata: result.metadata };
    }
    case '/reset': {
      const result = await runResetWorkflow(services);
      return { command, chunks: result.chunks, metadata: result.metadata };
    }
    default: {
      const result = await runUnknownWorkflow(command || raw);
      return { command: command || raw, chunks: result.chunks, metadata: result.metadata };
    }
  }
}
