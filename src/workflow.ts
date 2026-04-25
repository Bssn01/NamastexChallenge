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
import { resolveIntent } from './lib/intents.js';
import { chunkText, normalizeWhitespace } from './lib/text.js';
import type { GenieResearchStore } from './store/genie-research-store.js';
import type {
  AppConfig,
  DossierResource,
  IdeaDossier,
  MonitorCadence,
  MonitorProvider,
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
  dossierHint?: string;
}

interface MonitorRequest {
  cadence: MonitorCadence;
  time: string;
  topics: string[];
  providers: MonitorProvider[];
  topN: number;
}

const STOPWORDS = new Set([
  'a',
  'as',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'essa',
  'esse',
  'esta',
  'este',
  'isso',
  'isto',
  'o',
  'os',
  'uma',
  'um',
  'umas',
  'uns',
  'para',
  'por',
  'que',
  'quero',
  'me',
  'nos',
  'nossa',
  'nosso',
  'sobre',
  'sobre',
  'pra',
  'pro',
  'com',
  'sem',
  'temos',
  'salvo',
  'salva',
  'salvos',
  'salvas',
  'mostra',
  'resuma',
  'resume',
  'analisa',
  'analise',
  'pesquisa',
  'pesquisar',
  'procura',
  'procurar',
  'valida',
  'validar',
  'investiga',
  'investigar',
  'estuda',
  'estudar',
  'revisa',
  'revisar',
]);

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function tokenizeHint(value: string): string[] {
  return stripAccents(normalizeWhitespace(value).toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function scoreHintAgainstText(hint: string, text: string): number {
  const tokens = tokenizeHint(hint);
  if (tokens.length === 0) return 0;
  const haystack = stripAccents(normalizeWhitespace(text).toLowerCase());
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
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
  const dossierHint = normalizeWhitespace(
    parts.filter((part) => part !== target && !part.startsWith('idea:')).join(' '),
  );
  return {
    target,
    dossierId: dossierToken ? dossierToken.slice('idea:'.length) : undefined,
    dossierHint,
  };
}

function parseTime(text: string): string {
  const match = text.match(/\b(?:as|às|at)\s*(\d{1,2})(?::|h)?(\d{2})?\b/i);
  if (!match) return '09:00';
  const hour = Math.min(Math.max(Number(match[1]), 0), 23);
  const minute = match[2] ? Math.min(Math.max(Number(match[2]), 0), 59) : 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseMonitorRequest(text: string): MonitorRequest {
  const normalized = stripAccents(normalizeWhitespace(text).toLowerCase());
  const cadence: MonitorCadence = /\b(semanalmente|weekly|toda semana)\b/i.test(normalized)
    ? 'weekly'
    : 'daily';
  const providers: MonitorProvider[] = [];
  if (/\b(tweet|tweets|x|twitter)\b/i.test(normalized)) providers.push('x');
  if (/\b(hacker ?news|hn)\b/i.test(normalized)) providers.push('hackernews');
  if (/\b(arxiv|paper|papers|artigos academicos|artigos acadêmicos)\b/i.test(normalized)) {
    providers.push('arxiv');
  }
  const topMatch = normalized.match(/\btop\s*(\d{1,2})\b/);
  const topN = topMatch ? Math.min(Math.max(Number(topMatch[1]), 1), 10) : 5;
  const topicMatch =
    text.match(/\bsobre\s+(.+)$/i) || text.match(/\b(?:de|do|da|para|em)\s+(.+)$/i);
  const rawTopic = normalizeWhitespace(
    (topicMatch?.[1] || '')
      .replace(/\b(?:todo dia|diariamente|daily|semanalmente|weekly|toda semana)\b.*$/i, '')
      .replace(/\b(?:as|às|at)\s*\d{1,2}(?::|h)?\d{0,2}\b/gi, ''),
  );
  return {
    cadence,
    time: parseTime(text),
    providers: providers.length > 0 ? [...new Set(providers)] : ['x', 'hackernews', 'arxiv'],
    topN,
    topics: rawTopic ? [rawTopic] : [],
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
    'Próximo passo sugerido: peça para eu mostrar as fontes deste dossiê ou envie um GitHub URL/owner/repo para avaliar um repositório.',
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
    `Resumo: ${assessment.fitSummary}`,
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

function summarizeDossierForRepoComparison(dossier: IdeaDossier): string {
  const latestRun = dossier.researchRuns[0];
  const topicGroups = dossier.topicGroups
    .map((group) => `- ${group.label}: ${group.topics.join(', ')}`)
    .join('\n');
  const highlights = latestRun
    ? latestRun.groupResults
        .map((group) => `- ${group.topicGroupLabel}: ${group.summary}`)
        .slice(0, 6)
        .join('\n')
    : '- Ainda não há rodada de pesquisa consolidada.';

  return [
    `Dossier ID: ${dossier.id}`,
    `Ideia: ${dossier.rawIdeaText}`,
    `Tema principal: ${dossier.mainTopic}`,
    '',
    'Grupos:',
    topicGroups || '- sem grupos',
    '',
    'Última síntese:',
    latestRun?.crossGroupSummary || 'Sem síntese consolidada.',
    '',
    'Sinais recentes:',
    highlights,
  ].join('\n');
}

function fitScoreFromVerdict(
  verdict: 'ganho-real' | 'complexidade-sem-retorno' | 'incerto',
): number {
  if (verdict === 'ganho-real') return 78;
  if (verdict === 'complexidade-sem-retorno') return 32;
  return 55;
}

async function compareWikiIdeaToRepo(
  dossier: IdeaDossier,
  repoTarget: string,
  services: AppServices,
): Promise<{
  assessment: RepoAssessment;
  github: GitHubLabReport;
  repomix: RepomixReport;
}> {
  const materialized = await services.github.materializeRepository(repoTarget);
  const github = await services.github.validateRepository(repoTarget);
  github.localPath = materialized.localPath;
  const repomix = await services.repomix.validateRepository(materialized.localPath);
  const comparison = await services.grok.compareIdeaToRepo({
    dossierSummary: summarizeDossierForRepoComparison(dossier),
    repoPack: repomix.pack,
    repoLabel: github.canonicalSlug,
    ideaLabel: dossier.mainTopic,
  });

  const strengths: string[] = [
    `Veredito do modelo: ${comparison.verdict}.`,
    ...comparison.concreteFiles.map((file) => `Ponto concreto de aplicação: ${file}.`),
  ];
  const risks =
    comparison.risks.length > 0 ? comparison.risks : ['Sem riscos adicionais especificados.'];
  const recommendedNextSteps = comparison.betterTopic
    ? [`Alternativa sugerida do wiki: ${comparison.betterTopic}`]
    : ['Revise os módulos citados antes de implementar qualquer camada nova.'];

  const assessment = await services.store.saveRepoAssessment({
    dossierId: dossier.id,
    targetRepo: {
      canonicalSlug: github.canonicalSlug,
      owner: github.owner,
      repo: github.repo,
      sourceUrl: github.sourceUrl,
      localPath: github.localPath || materialized.localPath,
      defaultBranch: github.defaultBranch,
      notes: [...github.notes, ...repomix.notes],
    },
    githubReport: github as unknown as Record<string, unknown>,
    repomixReport: repomix as unknown as Record<string, unknown>,
    fitSummary: comparison.summary,
    fitScore: fitScoreFromVerdict(comparison.verdict),
    strengths,
    gaps:
      repomix.generatedFrom === 'repomix'
        ? []
        : ['Repomix não executou do caminho ideal; a análise usou fallback local.'],
    risks,
    recommendedNextSteps,
    notes: [
      ...github.notes,
      ...repomix.notes,
      `Compared against dossier ${dossier.id}.`,
      `provider:${comparison.provider}`,
      `model:${comparison.model}`,
    ],
  });

  return { assessment, github, repomix };
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

  const scored = dossiers
    .map((dossier) => ({
      dossier,
      score:
        scoreHintAgainstText(topicHint, dossier.mainTopic) +
        scoreHintAgainstText(topicHint, dossier.rawIdeaText),
    }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.score ? scored[0].dossier : dossiers[0];
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

  const [arxivResult, hackernewsResult, xResult, fieldTheoryResult] = await Promise.all([
    services.arxiv
      .search(query, 5, context)
      .then((sources) => ({ sources, notes: [] as string[] }))
      .catch((error) => ({
        sources: [] as DossierResourceCandidate[],
        notes: [`arXiv unavailable: ${error instanceof Error ? error.message : String(error)}`],
      })),
    services.hackernews
      .search(query, 5, context)
      .then((sources) => ({ sources, notes: [] as string[] }))
      .catch((error) => ({
        sources: [] as DossierResourceCandidate[],
        notes: [
          `Hacker News unavailable: ${error instanceof Error ? error.message : String(error)}`,
        ],
      })),
    services.x.search(query, services.config.xSearchLimit, context).catch((error) => ({
      provider: 'unconfigured' as const,
      configured: false,
      posts: [],
      notes: [`X search unavailable: ${error instanceof Error ? error.message : String(error)}`],
    })),
    services.fieldtheory.search(query, 5, context).catch((error) => ({
      state: 'unconfigured' as const,
      sources: [],
      notes: [`FieldTheory unavailable: ${error instanceof Error ? error.message : String(error)}`],
    })),
  ]);

  const topResources = rankCandidates(
    [...arxivResult.sources, ...hackernewsResult.sources, ...fieldTheoryResult.sources],
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
    ...arxivResult.notes,
    ...hackernewsResult.notes,
    ...xResult.notes,
    ...fieldTheoryResult.notes,
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
    notes: ['Created from a research turn.'],
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
    : 'Wiki: recente\n\nAinda não existe base local para esse tópico. Faça uma pesquisa primeiro.';

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
  const dossier = await selectDossier(services, request.dossierId, request.dossierHint);
  if (!dossier) {
    return {
      chunks: [
        'Repo:\n\nNenhum dossiê disponível. Faça uma pesquisa antes de avaliar um repositório.',
      ],
      metadata: {},
    };
  }

  const defaultTarget =
    services.config.defaultGithubOwner && services.config.defaultGithubRepo
      ? `${services.config.defaultGithubOwner}/${services.config.defaultGithubRepo}`
      : undefined;
  const target = request.target || defaultTarget;

  if (!target) {
    return {
      chunks: [
        'Repo:\n\nMe envie um GitHub URL ou `owner/repo` para eu comparar com o que está salvo no wiki.',
      ],
      metadata: { dossierId: dossier.id },
    };
  }

  const { assessment, github, repomix } = await compareWikiIdeaToRepo(dossier, target, services);

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
  const searchQuery = normalizeWhitespace(query) || 'recente';
  const result = await services.fieldtheory.search(searchQuery, 5, {
    mainTopic: searchQuery,
    rawIdeaText: query,
  });

  if (result.state === 'missing') {
    const platformNote =
      process.platform === 'darwin'
        ? 'Neste Mac, instale/configure o FieldTheory CLI (`ft`) e o `FT_DATA_DIR` para pesquisar seus bookmarks locais.'
        : 'Neste host, só consigo usar FieldTheory se o binário `ft` estiver instalado e funcionando. Login de X no navegador/servidor não é lido diretamente por este agente.';
    return {
      chunks: [
        `Bookmarks:\n\nfieldtheory-cli não está instalado neste ambiente.\n\n${platformNote}`,
      ],
      metadata: { state: result.state },
    };
  }

  if (result.state === 'unconfigured') {
    return {
      chunks: [
        [
          'Bookmarks:',
          '',
          'fieldtheory-cli está instalado, mas não está configurado com um acervo local pesquisável.',
          'Se houver uma conta X logada no servidor/navegador, isso ainda não basta: preciso do índice local do FieldTheory ou das chaves XAI_API_KEY/OPENROUTER_API_KEY para busca em X.',
        ].join('\n'),
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

export async function runClarificationWorkflow(question: string): Promise<WorkflowResult> {
  return {
    chunks: [question],
    metadata: {},
  };
}

export async function runGreetingWorkflow(): Promise<WorkflowResult> {
  return {
    chunks: [
      [
        'Oi! Sou o agente de pesquisa da Namastex.',
        '',
        'Posso te ajudar a:',
        '- pesquisar e validar uma ideia de produto ou mercado',
        '- resumir o que já está salvo na nossa memória',
        '- mostrar fontes e evidências de um dossiê',
        '- comparar uma ideia com um repositório GitHub',
        '- procurar sinais em bookmarks locais, se estiver configurado',
        '',
        'Me manda uma ideia ou pergunta e eu sigo daqui.',
      ].join('\n'),
    ],
    metadata: {},
  };
}

export async function runCapabilitiesWorkflow(): Promise<WorkflowResult> {
  return {
    chunks: [
      [
        'Posso te ajudar assim:',
        '',
        '- pesquisar uma ideia, mercado, nicho ou hipótese quando você pedir em linguagem natural',
        '- salvar dossiês com tópicos, nichos, fontes e evidências',
        '- listar quais tópicos e nichos você já tem salvos',
        '- mostrar fontes de um dossiê',
        '- listar seus repositórios do GitHub e testar uma ideia contra um repo para dizer se vale a pena',
        '- acompanhar temas e te mandar update news diário ou semanal com top posts/tweets/papers',
        '',
        'Exemplos:',
        '“pesquisa agentes de WhatsApp para suporte financeiro”',
        '“quais tópicos eu tenho salvos?”',
        '“me manda todo dia às 9 top 5 tweets, Hacker News e arXiv sobre agentes B2B”',
        '“testa essa ideia no repo Bssn01/NamastexChallenge”',
      ].join('\n'),
    ],
    metadata: {},
  };
}

function collectSavedTopics(dossiers: IdeaDossier[]): {
  topics: string[];
  niches: string[];
} {
  const topics = new Set<string>();
  const niches = new Set<string>();
  for (const dossier of dossiers) {
    if (dossier.mainTopic) topics.add(dossier.mainTopic);
    for (const group of dossier.topicGroups || []) {
      for (const topic of group.topics || []) {
        if (group.kind === 'niche') {
          niches.add(topic);
        } else {
          topics.add(topic);
        }
      }
    }
  }
  return {
    topics: [...topics],
    niches: [...niches],
  };
}

export async function runSavedTopicsWorkflow(services: AppServices): Promise<WorkflowResult> {
  const dossiers = await services.store.listRecentDossiers(25);
  const { topics, niches } = collectSavedTopics(dossiers);
  if (topics.length === 0 && niches.length === 0) {
    return {
      chunks: [
        'Ainda não tenho tópicos ou nichos salvos nesta conversa. Me mande uma ideia para pesquisar e eu salvo o dossiê.',
      ],
      metadata: { topicCount: 0, nicheCount: 0 },
    };
  }

  return {
    chunks: chunkText(
      [
        'Tópicos e nichos salvos nesta conversa:',
        '',
        topics.length ? `Tópicos:\n${topics.map((topic) => `- ${topic}`).join('\n')}` : '',
        niches.length ? `Nichos:\n${niches.map((niche) => `- ${niche}`).join('\n')}` : '',
        '',
        'Você pode pedir fontes, resumo, comparar com um repo, ou ativar update news diário/semanal para esses temas.',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    metadata: { topicCount: topics.length, nicheCount: niches.length },
  };
}

export async function runMonitorWorkflow(
  text: string,
  services: AppServices,
): Promise<WorkflowResult> {
  const request = parseMonitorRequest(text);
  const dossiers = await services.store.listRecentDossiers(25);
  const saved = collectSavedTopics(dossiers);
  const topics = request.topics.length > 0 ? request.topics : saved.topics.slice(0, 5);
  const niches = saved.niches.slice(0, 10);

  if (topics.length === 0) {
    return {
      chunks: [
        'Consigo criar um update news diário ou semanal, mas preciso de pelo menos um tema. Exemplo: “me manda todo dia às 9 top 5 tweets, Hacker News e arXiv sobre agentes de WhatsApp”.',
      ],
      metadata: { state: 'missing-topic' },
    };
  }

  const monitor = await services.store.upsertMonitorSubscription({
    instanceId: services.config.omniInstanceId,
    chatId: services.config.omniChatId,
    cadence: request.cadence,
    time: request.time,
    timezone: 'America/Sao_Paulo',
    topics,
    niches,
    providers: request.providers,
    topN: request.topN,
    enabled: true,
  });

  return {
    chunks: [
      [
        `Fechado. Salvei um update news ${monitor.cadence === 'daily' ? 'diário' : 'semanal'} às ${monitor.time}.`,
        `Vou acompanhar top ${monitor.topN} em: ${monitor.providers.join(', ')}.`,
        `Tópicos: ${monitor.topics.join(', ')}`,
        monitor.niches.length
          ? `Nichos salvos usados como contexto: ${monitor.niches.join(', ')}`
          : '',
        '',
        'No host local, deixe o agendador chamando `npm run update-news:due` para eu enviar automaticamente no horário.',
      ]
        .filter(Boolean)
        .join('\n'),
    ],
    metadata: { monitorId: monitor.id },
  };
}

export async function runGithubReposWorkflow(services: AppServices): Promise<WorkflowResult> {
  const repos = await services.github.listUserRepositories(10);
  if (repos.length === 0) {
    return {
      chunks: [
        [
          'Não consegui listar seus repositórios agora.',
          '',
          'Confere se o `GITHUB_TOKEN` está configurado e tem acesso de leitura aos repositórios que você quer usar.',
        ].join('\n'),
      ],
      metadata: { count: 0 },
    };
  }

  const lines = repos.map((repo, index) => {
    const visibility = repo.private ? 'privado' : 'público';
    const archived = repo.archived ? ', arquivado' : '';
    const description = repo.description ? `\n   ${repo.description}` : '';
    return `${index + 1}. ${repo.fullName} (${visibility}${archived})\n   ${repo.htmlUrl}${description}`;
  });

  return {
    chunks: chunkText(
      [
        'Repos que seu token do GitHub consegue acessar, ordenados por atualização recente:',
        '',
        lines.join('\n\n'),
        '',
        'Me manda um deles no formato `owner/repo` se quiser que eu compare com uma ideia salva.',
      ].join('\n'),
    ),
    metadata: { count: repos.length },
  };
}

export async function routeWhatsappMessage(
  text: string,
  services: AppServices,
): Promise<WhatsAppReply> {
  const defaultRepoSlug =
    services.config.defaultGithubOwner && services.config.defaultGithubRepo
      ? `${services.config.defaultGithubOwner}/${services.config.defaultGithubRepo}`
      : undefined;
  const intent = resolveIntent(text, { defaultRepoSlug });

  if (intent.kind === 'clarify') {
    return {
      command: 'clarify',
      chunks: [intent.clarification || 'Preciso de mais contexto para ajudar.'],
      metadata: {
        intent: 'clarify',
        source: intent.source,
      },
    };
  }

  const handlers: Record<
    Exclude<typeof intent.kind, 'clarify'>,
    (input: string, runtime: AppServices) => Promise<WorkflowResult>
  > = {
    greeting: async () => runGreetingWorkflow(),
    capabilities: async () => runCapabilitiesWorkflow(),
    'github-repos': async (_input, runtime) => runGithubReposWorkflow(runtime),
    'saved-topics': async (_input, runtime) => runSavedTopicsWorkflow(runtime),
    monitor: runMonitorWorkflow,
    research: runPesquisaWorkflow,
    wiki: runWikiWorkflow,
    sources: runSourcesWorkflow,
    repo: runRepoWorkflow,
    bookmarks: runBookmarksWorkflow,
    reset: async (_input, runtime) => runResetWorkflow(runtime),
  };

  const result = await handlers[intent.kind](intent.payload, services);
  return {
    command: intent.kind,
    chunks: result.chunks,
    metadata: {
      ...result.metadata,
      intent: intent.kind,
      source: intent.source,
      legacyCommand: intent.legacyCommand,
    },
  };
}
