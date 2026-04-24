import { randomUUID } from 'node:crypto';
import type {
  ArxivAdapter,
  DossierResourceCandidate,
  ResearchTopicContext,
} from './adapters/arxiv.js';
import type { FieldTheoryAdapter } from './adapters/fieldtheory.js';
import type { GenieBrainAdapter } from './adapters/genie-brain.js';
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
  genieBrain: GenieBrainAdapter;
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
  const url = resource.url ? `\n-> ${resource.url}` : '';
  return `${index + 1}. ${resource.title}${published}\n${resource.summary}${url}`;
}

function formatSourceWithContext(resource: ResearchSource, index: number): string {
  const url = resource.url ? ` -> ${resource.url}` : '';
  return `${index + 1}. ${resource.title}${url}\nPor que importa: ${resource.summary}`;
}

function formatProviderSection(label: string, resources: DossierResource[], limit = 5): string {
  const items = resources.slice(0, limit);
  if (items.length === 0) {
    return `${label}:\nNenhum resultado.`;
  }
  return [`${label}:`, ...items.map(formatResource)].join('\n\n');
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
  _summary: GrokSummary,
): string {
  const allResources = researchRun.groupResults.flatMap((group) => group.resources);
  const hn = allResources.filter((r) => r.provider === 'hackernews');
  const xPosts = allResources.filter((r) => r.provider === 'x');
  const arxivPapers = allResources.filter((r) => r.provider === 'arxiv');

  return [
    'Aqui está seu resumo:',
    '',
    formatProviderSection('Hacker News', hn),
    '',
    formatProviderSection('X/Tweets', xPosts),
    '',
    formatProviderSection('arXiv', arxivPapers),
    '',
    `Já salvei isso como dossiê: ${dossier.id}`,
    'Quer que eu aprofunde, explique melhor ou teste isso em um repositório seu?',
  ].join('\n');
}

function formatWikiReply(dossier: IdeaDossier): string {
  const latestRun = dossier.researchRuns[0];
  const highlights = latestRun
    ? latestRun.groupResults.map((g) => `- ${g.topicGroupLabel}: ${g.summary}`).slice(0, 3)
    : [];

  return [
    `Wiki: ${dossier.mainTopic}`,
    '',
    `Resumo: ${latestRun?.crossGroupSummary || 'Ainda sem pesquisa consolidada.'}`,
    ...(highlights.length > 0 ? ['', 'Destaques:', ...highlights] : []),
    '',
    `Próximo passo sugerido: /fontes ${dossier.mainTopic} para ver as fontes, ou /repo <owner/repo> para testar um repositório.`,
  ].join('\n');
}

function formatSourcesReply(dossier: IdeaDossier): string {
  const latestRun = dossier.researchRuns[0];
  if (!latestRun) {
    return `Fontes: ${dossier.mainTopic}\n\nAinda não existe pesquisa para este dossiê.`;
  }
  const allResources = latestRun.groupResults.flatMap((group) => group.resources);
  const hn = allResources.filter((r) => r.provider === 'hackernews');
  const xPosts = allResources.filter((r) => r.provider === 'x');
  const arxivPapers = allResources.filter((r) => r.provider === 'arxiv');

  const sections: string[] = [`Fontes: ${dossier.mainTopic}`];
  if (hn.length > 0) {
    sections.push('', 'Hacker News:', ...hn.slice(0, 5).map(formatSourceWithContext));
  }
  if (xPosts.length > 0) {
    sections.push('', 'X/Tweets:', ...xPosts.slice(0, 5).map(formatSourceWithContext));
  }
  if (arxivPapers.length > 0) {
    sections.push('', 'arXiv:', ...arxivPapers.slice(0, 5).map(formatSourceWithContext));
  }
  if (sections.length === 1) {
    sections.push('', 'Nenhuma fonte catalogada ainda.');
  }
  return sections.join('\n');
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
  _github: GitHubLabReport,
  _repomix: RepomixReport,
): string {
  const nextStep = assessment.recommendedNextSteps[0]
    ? `Próximo teste sugerido: ${assessment.recommendedNextSteps[0]}`
    : 'Próximo teste sugerido: revise o README e a estrutura do repositório antes de implementar.';

  return [
    `Repo: ${assessment.targetRepo.canonicalSlug}`,
    '',
    `Fit score: ${assessment.fitScore ?? 'n/a'}/100`,
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
    '',
    nextStep,
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

  const brainIngest = await services.genieBrain.ingest({
    dossierId: refreshedDossier.id,
    mainTopic: refreshedDossier.mainTopic,
    rawIdeaText: refreshedDossier.rawIdeaText,
    crossGroupSummary: researchRun.crossGroupSummary,
    groupResults: researchRun.groupResults.map((group) => ({
      label: group.topicGroupLabel,
      summary: group.summary,
      resourceTitles: group.resources.map((resource) => resource.title),
    })),
  });
  const brainNote =
    brainIngest.state === 'ready' && brainIngest.ingestPath
      ? 'Brain: dossiê ingerido'
      : brainIngest.state === 'ready'
        ? 'Brain: modo mock (ingest desativado)'
        : brainIngest.state === 'missing'
          ? 'Brain: não instalado'
          : 'Brain: não configurado';
  diagnostics.push(brainNote);

  return {
    chunks: chunkText(formatResearchReply(refreshedDossier, researchRun, summary)),
    metadata: {
      dossierId: refreshedDossier.id,
      researchRunId: researchRun.id,
      topicGroups: refreshedDossier.topicGroups,
      diagnostics,
      brain: {
        state: brainIngest.state,
        ingestPath: brainIngest.ingestPath,
        notes: brainIngest.notes,
      },
    },
  };
}

export async function runWikiWorkflow(
  topic: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const normalizedTopic = normalizeWhitespace(topic);
  const [dossier, brainResult] = await Promise.all([
    selectDossier(services, undefined, normalizedTopic),
    services.genieBrain.search(normalizedTopic || 'recente', services.config.genieBrainSearchLimit),
  ]);

  const baseText = dossier
    ? formatWikiReply(dossier)
    : 'Wiki: recente\n\nAinda não existe base local para esse tópico. Rode /pesquisar primeiro.';

  const brainSection =
    brainResult.sources.length > 0
      ? [
          '',
          'Brain:',
          ...brainResult.sources.slice(0, 3).map((source, index) => formatResource(source, index)),
        ].join('\n')
      : '';

  return {
    chunks: chunkText(`${baseText}${brainSection}`),
    metadata: {
      dossierId: dossier?.id,
      brain: {
        state: brainResult.state,
        count: brainResult.sources.length,
        notes: brainResult.notes,
      },
    },
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

  const formattedSources = result.sources.slice(0, 5).map((source, index) => {
    const url = source.url ? ` -> ${source.url}` : '';
    return `${index + 1}. ${source.title}${url}\nContexto prático: ${source.summary}`;
  });

  return {
    chunks: chunkText(
      [`Bookmarks: ${query}`, '', 'Achados locais:', ...formattedSources].join('\n'),
    ),
    metadata: { state: result.state, count: result.sources.length },
  };
}

export async function runResetWorkflow(services: AppServices): Promise<WorkflowResult> {
  await services.store.resetSession();
  return {
    chunks: ['Reset concluído. Sessão reiniciada. Dossiês preservados.'],
    metadata: {},
  };
}

export async function runUnknownWorkflow(command: string): Promise<WorkflowResult> {
  return {
    chunks: [
      [
        'Não reconheci esse comando.',
        '',
        'Tente: /pesquisar, /wiki, /fontes, /repo, /bookmarks ou /reset.',
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
