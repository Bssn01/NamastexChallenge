import { randomUUID } from 'node:crypto';
import type {
  ArxivAdapter,
  DossierResourceCandidate,
  ResearchTopicContext,
} from './adapters/arxiv.js';
import type { FieldTheoryAdapter } from './adapters/fieldtheory.js';
import type { GitHubLabAdapter, GitHubLabReport } from './adapters/github.js';
import type { GrokAdapter, GrokSummary } from './adapters/grok.js';
import type { HackerNewsAdapter } from './adapters/hackernews.js';
import type { RepomixAdapter, RepomixReport } from './adapters/repomix.js';
import type { XSearchAdapter } from './adapters/x.js';
import { isSupportedCommand, parseCommand } from './lib/commands.js';
import { chunkText, normalizeWhitespace } from './lib/text.js';
import type { GenieResearchStore } from './store/genie-research-store.js';
import type {
  AppConfig,
  DossierResource,
  IdeaDossier,
  RepoAssessment,
  RepoTargetRef,
  ResearchRun,
  ResearchRunGroupResult,
  ResearchSource,
  TopicGroup,
  WhatsAppReply,
} from './types.js';

export interface AppServices {
  config: AppConfig;
  store: GenieResearchStore;
  arxiv: ArxivAdapter;
  hackernews: HackerNewsAdapter;
  grok: GrokAdapter;
  github: GitHubLabAdapter;
  repomix: RepomixAdapter;
  x: XSearchAdapter;
  fieldtheory: FieldTheoryAdapter;
}

export interface WorkflowResult {
  chunks: string[];
  metadata: Record<string, unknown>;
}

interface ParsedPesquisaInput {
  rawIdeaText: string;
  mainTopic: string;
  topicGroups: TopicGroup[];
}

interface RepoRequest {
  target?: string;
  dossierId?: string;
}

function buildTopicGroup(label: string, kind: TopicGroup['kind'], topics: string[]): TopicGroup {
  return {
    id: randomUUID(),
    label,
    kind,
    topics,
  };
}

function normalizeTopicList(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function parsePesquisaInput(payload: string): ParsedPesquisaInput {
  const rawIdeaText = payload;
  const lines = rawIdeaText.split(/\r?\n/);
  let currentSection: 'idea' | 'main' | 'groups' | null = null;
  const ideaLines: string[] = [];
  const groupLines: string[] = [];
  let mainTopic = '';

  for (const line of lines) {
    if (/^IDEIA\s*:/i.test(line)) {
      currentSection = 'idea';
      const value = line.replace(/^IDEIA\s*:/i, '').trim();
      if (value) ideaLines.push(value);
      continue;
    }
    if (/^TOPICO PRINCIPAL\s*:/i.test(line) || /^TÓPICO PRINCIPAL\s*:/i.test(line)) {
      currentSection = 'main';
      mainTopic = line.replace(/^T[OÓ]PICO PRINCIPAL\s*:/i, '').trim();
      continue;
    }
    if (/^GRUPOS NICHO\s*:/i.test(line)) {
      currentSection = 'groups';
      continue;
    }

    if (currentSection === 'idea') {
      ideaLines.push(line);
    } else if (currentSection === 'groups') {
      groupLines.push(line);
    } else if (currentSection === 'main' && !mainTopic) {
      mainTopic = line.trim();
    }
  }

  const normalizedIdea = (ideaLines.join('\n').trim() || rawIdeaText).trim();
  const effectiveMainTopic = normalizeWhitespace(mainTopic || lines[0] || rawIdeaText) || 'ideia';
  const topicGroups: TopicGroup[] = [buildTopicGroup('Main topic', 'main', [effectiveMainTopic])];

  for (const rawLine of groupLines) {
    const line = rawLine.trim();
    if (!line) continue;
    const bulletLine = line.replace(/^[-*]\s*/, '');
    const colonIndex = bulletLine.indexOf(':');
    if (colonIndex < 0) continue;
    const label = normalizeWhitespace(bulletLine.slice(0, colonIndex));
    const topics = normalizeTopicList(bulletLine.slice(colonIndex + 1));
    if (!label || topics.length === 0) continue;
    topicGroups.push(buildTopicGroup(label, 'niche', topics));
  }

  return {
    rawIdeaText: normalizedIdea,
    mainTopic: effectiveMainTopic,
    topicGroups,
  };
}

function parseRepoRequest(payload: string): RepoRequest {
  const parts = payload.split(/\s+/).filter(Boolean);
  const dossierToken = parts.find((part) => part.startsWith('idea:'));
  const target = parts.find((part) => !part.startsWith('idea:'));
  return {
    target,
    dossierId: dossierToken ? dossierToken.slice('idea:'.length) : undefined,
  };
}

function toDossierResource(
  candidate: DossierResourceCandidate,
  topicGroupId: string,
): DossierResource {
  return {
    provider: candidate.provider,
    title: candidate.title,
    url: candidate.url,
    summary: candidate.summary,
    publishedAt: candidate.publishedAt,
    tags: candidate.tags,
    id: candidate.id || randomUUID(),
    topicGroupId,
    score: candidate.score,
    origin: candidate.origin,
    trustLevel: candidate.trustLevel || 'external-untrusted',
  };
}

function rankCandidates(
  candidates: DossierResourceCandidate[],
  limit: number,
): DossierResourceCandidate[] {
  return [...candidates]
    .sort((left, right) => (right.score || 0) - (left.score || 0))
    .slice(0, limit);
}

function formatResource(resource: ResearchSource, index: number): string {
  const published = resource.publishedAt ? ` • ${resource.publishedAt}` : '';
  const url = resource.url ? `\n   ${resource.url}` : '';
  return `${index + 1}. ${resource.provider.toUpperCase()}: ${resource.title}${published}\n   ${resource.summary}${url}`;
}

function formatGroupResult(group: ResearchRunGroupResult): string {
  const resourceLines = group.resources
    .filter((resource) => resource.provider !== 'x')
    .slice(0, 5)
    .map(formatResource)
    .join('\n');
  const xLines = group.resources
    .filter((resource) => resource.provider === 'x')
    .slice(0, 5)
    .map(formatResource)
    .join('\n');

  return [
    `${group.topicGroupLabel}:`,
    `Resumo: ${group.summary}`,
    '',
    'Recursos:',
    resourceLines || '- sem recursos',
    '',
    'X:',
    xLines || '- sem posts',
  ].join('\n');
}

function formatResearchReply(
  dossier: IdeaDossier,
  researchRun: ResearchRun,
  summary: GrokSummary,
  diagnostics: string[],
): string {
  const groups = researchRun.groupResults.map(formatGroupResult).join('\n\n');
  return [
    `Pesquisa: ${dossier.mainTopic}`,
    '',
    `Resumo geral: ${researchRun.crossGroupSummary}`,
    `Sinal: ${summary.caution}`,
    '',
    `Dossiê: ${dossier.id}`,
    `Grupos: ${dossier.topicGroups.length}`,
    '',
    groups,
    ...(diagnostics.length > 0 ? ['', `Avisos: ${diagnostics.join(' | ')}`] : []),
  ].join('\n');
}

function formatWikiReply(dossier: IdeaDossier): string {
  const latestRun = dossier.researchRuns[0];
  return [
    `Wiki: ${dossier.mainTopic}`,
    '',
    `Ideia: ${dossier.rawIdeaText}`,
    '',
    `Resumo: ${latestRun?.crossGroupSummary || 'Ainda sem pesquisa consolidada.'}`,
    '',
    'Grupos:',
    ...dossier.topicGroups.map((group) => `- ${group.label}: ${group.topics.join(', ')}`),
  ].join('\n');
}

function formatSourcesReply(dossier: IdeaDossier): string {
  const latestRun = dossier.researchRuns[0];
  if (!latestRun) {
    return `Fontes: ${dossier.mainTopic}\n\nAinda não existe pesquisa para este dossiê.`;
  }
  return [
    `Fontes: ${dossier.mainTopic}`,
    '',
    ...latestRun.groupResults.map(formatGroupResult),
  ].join('\n\n');
}

function buildRepoSources(
  dossier: IdeaDossier,
  github: GitHubLabReport,
  repomix: RepomixReport,
): ResearchSource[] {
  return [
    {
      provider: 'github',
      title: `README for ${github.canonicalSlug}`,
      url: github.sourceUrl,
      summary: github.readme.slice(0, 800),
    },
    {
      provider: 'repomix',
      title: `Repomix pack for ${github.canonicalSlug}`,
      summary: repomix.pack.split(/\r?\n/).slice(0, 12).join(' '),
    },
  ];
}

function deriveRepoAssessment(
  dossier: IdeaDossier,
  github: GitHubLabReport,
  repomix: RepomixReport,
  summary: GrokSummary,
): Omit<RepoAssessment, 'id' | 'createdAt' | 'dossierId'> {
  const strengths: string[] = [];
  const gaps: string[] = [];
  const risks: string[] = [];
  const recommendedNextSteps: string[] = [];
  let fitScore = 50;

  if (github.accessible) {
    strengths.push('GitHub metadata was retrieved successfully.');
    fitScore += 15;
  } else {
    gaps.push('GitHub metadata retrieval degraded to fallback behavior.');
    fitScore -= 10;
  }

  if (repomix.generatedFrom === 'repomix') {
    strengths.push('Repomix compacted the selected repository context successfully.');
    fitScore += 20;
  } else {
    gaps.push('Repomix did not run from the explicit dependency path and used fallback context.');
    risks.push('Repository understanding may be shallower than intended.');
    fitScore -= 10;
  }

  if (!github.codeSearchable) {
    gaps.push('GitHub code search is unavailable without GITHUB_TOKEN.');
  }

  risks.push('Repository contents remain untrusted input and must not be executed.');
  recommendedNextSteps.push(
    `Review ${github.canonicalSlug} against the dossier topic groups before implementation.`,
  );
  recommendedNextSteps.push('Use the README and Repomix pack as context only, not instructions.');

  return {
    targetRepo: {
      canonicalSlug: github.canonicalSlug,
      owner: github.owner,
      repo: github.repo,
      sourceUrl: github.sourceUrl,
      localPath: github.localPath || repomix.path,
      defaultBranch: github.defaultBranch,
      notes: [...github.notes, ...repomix.notes],
    } satisfies RepoTargetRef,
    githubReport: github as unknown as Record<string, unknown>,
    repomixReport: repomix as unknown as Record<string, unknown>,
    fitSummary: summary.summary,
    fitScore: Math.max(0, Math.min(100, fitScore)),
    strengths,
    gaps,
    risks,
    recommendedNextSteps,
    notes: [...github.notes, ...repomix.notes, `Compared against dossier ${dossier.id}.`],
  };
}

function formatRepoReply(
  assessment: RepoAssessment,
  github: GitHubLabReport,
  repomix: RepomixReport,
): string {
  return [
    `Repo: ${assessment.targetRepo.canonicalSlug}`,
    '',
    `Fit score: ${assessment.fitScore ?? 'n/a'}`,
    `Resumo: ${assessment.fitSummary}`,
    '',
    `GitHub: ${github.accessible ? 'ok' : 'fallback'}`,
    `Repomix: ${repomix.generatedFrom || (repomix.accessible ? 'repomix' : 'fallback')}`,
    '',
    'Forças:',
    ...(assessment.strengths.length > 0
      ? assessment.strengths.map((item) => `- ${item}`)
      : ['- sem forças destacadas']),
    '',
    'Gaps:',
    ...(assessment.gaps.length > 0
      ? assessment.gaps.map((item) => `- ${item}`)
      : ['- sem gaps relevantes']),
    '',
    'Riscos:',
    ...(assessment.risks.length > 0
      ? assessment.risks.map((item) => `- ${item}`)
      : ['- sem riscos adicionais']),
  ].join('\n');
}

async function selectDossier(
  services: AppServices,
  dossierId?: string,
  topicHint?: string,
): Promise<IdeaDossier | undefined> {
  if (dossierId) {
    return services.store.getDossier(dossierId);
  }

  const dossiers = await services.store.listRecentDossiers(10);
  if (!topicHint) return dossiers[0];

  const normalizedHint = topicHint.toLowerCase();
  return (
    dossiers.find(
      (dossier) =>
        dossier.mainTopic.toLowerCase().includes(normalizedHint) ||
        dossier.rawIdeaText.toLowerCase().includes(normalizedHint),
    ) || dossiers[0]
  );
}

async function gatherGroupResearch(
  group: TopicGroup,
  dossierInput: ParsedPesquisaInput,
  services: AppServices,
): Promise<{
  result: ResearchRunGroupResult;
  diagnostics: string[];
}> {
  const query = normalizeWhitespace(group.topics.join(' '));
  const context: ResearchTopicContext = {
    topicGroupId: group.id,
    topicGroupLabel: group.label,
    rawIdeaText: dossierInput.rawIdeaText,
    mainTopic: dossierInput.mainTopic,
  };

  const [arxiv, hackernews, xResult, fieldTheoryResult] = await Promise.all([
    services.arxiv.search(query, 5, context),
    services.hackernews.search(query, 5, context),
    services.x.search(query, services.config.xSearchLimit, context),
    services.fieldtheory.search(query, 5, context),
  ]);

  const topResources = rankCandidates(
    [...arxiv, ...hackernews, ...fieldTheoryResult.sources],
    5,
  ).map((candidate) => toDossierResource(candidate, group.id));
  const topXPosts = rankCandidates(xResult.posts, services.config.xSearchLimit).map((candidate) =>
    toDossierResource(candidate, group.id),
  );
  const allResources = [...topResources, ...topXPosts];

  const groupSummary = await services.grok.synthesize(query, allResources, {
    rawIdeaText: dossierInput.rawIdeaText,
    mainTopic: dossierInput.mainTopic,
    topicGroupId: group.id,
    topicGroupLabel: group.label,
    topicGroups: dossierInput.topicGroups.map((topicGroup) => ({
      id: topicGroup.id,
      label: topicGroup.label,
      topics: topicGroup.topics,
    })),
  });

  const diagnostics = [
    ...xResult.notes,
    ...fieldTheoryResult.notes,
    ...(services.config.mode === 'real' && groupSummary.provider === 'mock'
      ? ['Grok caiu para síntese mock por falta/falha de chave']
      : []),
  ];

  return {
    result: {
      topicGroupId: group.id,
      topicGroupLabel: group.label,
      summary: groupSummary.summary,
      resources: allResources,
      notes: diagnostics,
    },
    diagnostics,
  };
}

export async function runPesquisaWorkflow(
  payload: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const parsed = parsePesquisaInput(payload);
  const dossier = await services.store.createDossier({
    rawIdeaText: parsed.rawIdeaText,
    mainTopic: parsed.mainTopic,
    topicGroups: parsed.topicGroups,
    notes: ['Created from /pesquisar.'],
  });

  const groupData = await Promise.all(
    dossier.topicGroups.map((group) => gatherGroupResearch(group, parsed, services)),
  );
  const groupResults = groupData.map((item) => item.result);
  const allResources = groupResults.flatMap((group) => group.resources);
  const summary = await services.grok.synthesize(parsed.rawIdeaText, allResources, {
    rawIdeaText: parsed.rawIdeaText,
    mainTopic: parsed.mainTopic,
    topicGroups: dossier.topicGroups.map((group) => ({
      id: group.id,
      label: group.label,
      topics: group.topics,
    })),
  });

  const researchRun = await services.store.appendResearchRun({
    dossierId: dossier.id,
    crossGroupSummary: summary.summary,
    groupResults,
    notes: [summary.caution, `provider:${summary.provider}`, `model:${summary.model}`],
  });

  const refreshedDossier = (await services.store.getDossier(dossier.id)) || dossier;
  const diagnostics = groupData.flatMap((item) => item.diagnostics);
  return {
    chunks: chunkText(formatResearchReply(refreshedDossier, researchRun, summary, diagnostics)),
    metadata: {
      dossierId: refreshedDossier.id,
      researchRunId: researchRun.id,
      topicGroups: refreshedDossier.topicGroups,
      diagnostics,
    },
  };
}

export async function runWikiWorkflow(
  topic: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const dossier = await selectDossier(services, undefined, normalizeWhitespace(topic));
  const text = dossier
    ? formatWikiReply(dossier)
    : 'Wiki: recente\n\nAinda não existe base local para esse tópico. Rode /pesquisar primeiro.';
  return {
    chunks: chunkText(text),
    metadata: { dossierId: dossier?.id },
  };
}

export async function runSourcesWorkflow(
  topic: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const dossier = await selectDossier(services, undefined, normalizeWhitespace(topic));
  const text = dossier
    ? formatSourcesReply(dossier)
    : 'Fontes: recente\n\nNenhuma fonte encontrada.';
  return {
    chunks: chunkText(text),
    metadata: { dossierId: dossier?.id },
  };
}

export async function runRepoWorkflow(
  payload: string | undefined,
  services: AppServices,
): Promise<WorkflowResult> {
  const request = parseRepoRequest(payload || '');
  const dossier = await selectDossier(services, request.dossierId);
  if (!dossier) {
    return {
      chunks: [
        'Repo:\n\nNenhum dossiê disponível. Rode /pesquisar antes de avaliar um repositório.',
      ],
      metadata: {},
    };
  }

  const target =
    request.target ||
    `${services.config.githubOwner || 'unknown'}/${services.config.githubRepo || 'unknown'}`;
  const materialized = await services.github.materializeRepository(target);
  const github = await services.github.validateRepository(target);
  github.localPath = materialized.localPath;
  const repomix = await services.repomix.validateRepository(materialized.localPath);

  const repoSources = buildRepoSources(dossier, github, repomix);
  const repoSummary = await services.grok.synthesize(dossier.rawIdeaText, repoSources, {
    rawIdeaText: dossier.rawIdeaText,
    mainTopic: dossier.mainTopic,
    topicGroups: dossier.topicGroups.map((group) => ({
      id: group.id,
      label: group.label,
      topics: group.topics,
    })),
  });

  const assessmentInput = deriveRepoAssessment(dossier, github, repomix, repoSummary);
  const assessment = await services.store.saveRepoAssessment({
    dossierId: dossier.id,
    ...assessmentInput,
  });

  return {
    chunks: chunkText(formatRepoReply(assessment, github, repomix)),
    metadata: {
      dossierId: dossier.id,
      repoAssessmentId: assessment.id,
      canonicalSlug: assessment.targetRepo.canonicalSlug,
    },
  };
}

export async function runBookmarksWorkflow(
  query: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const result = await services.fieldtheory.search(normalizeWhitespace(query), 5, {
    mainTopic: normalizeWhitespace(query),
    rawIdeaText: query,
  });

  if (result.state === 'missing') {
    return {
      chunks: ['Bookmarks:\n\nfieldtheory-cli não está instalado neste ambiente.'],
      metadata: { state: result.state },
    };
  }

  if (result.state === 'unconfigured') {
    return {
      chunks: [
        'Bookmarks:\n\nfieldtheory-cli está instalado, mas não está configurado com um acervo local pesquisável.',
      ],
      metadata: { state: result.state },
    };
  }

  return {
    chunks: chunkText(
      [`Bookmarks: ${query}`, '', ...result.sources.slice(0, 5).map(formatResource)].join('\n'),
    ),
    metadata: { state: result.state, count: result.sources.length },
  };
}

export async function runResetWorkflow(services: AppServices): Promise<WorkflowResult> {
  await services.store.resetSession();
  return {
    chunks: [
      'Reset concluído. A sessão local foi reiniciada; os dossiês persistentes foram preservados.',
    ],
    metadata: {},
  };
}

export async function runUnknownWorkflow(command: string): Promise<WorkflowResult> {
  return {
    chunks: [
      [
        `Comando: ${command}`,
        '',
        'Use apenas /pesquisar, /wiki, /fontes, /repo, /bookmarks ou /reset.',
      ].join('\n'),
    ],
    metadata: {},
  };
}

export async function routeWhatsappCommand(
  text: string,
  services: AppServices,
): Promise<WhatsAppReply> {
  const { command, payload } = parseCommand(text);

  if (!isSupportedCommand(command)) {
    const result = await runUnknownWorkflow(command || normalizeWhitespace(text));
    return {
      command: command || normalizeWhitespace(text),
      chunks: result.chunks,
      metadata: result.metadata,
    };
  }

  const handlers: Record<string, (input: string, runtime: AppServices) => Promise<WorkflowResult>> =
    {
      '/pesquisar': runPesquisaWorkflow,
      '/wiki': runWikiWorkflow,
      '/fontes': runSourcesWorkflow,
      '/repo': runRepoWorkflow,
      '/bookmarks': runBookmarksWorkflow,
      '/reset': async (_input, runtime) => runResetWorkflow(runtime),
    };

  const result = await handlers[command](payload, services);
  return { command, chunks: result.chunks, metadata: result.metadata };
}
