import assert from 'node:assert/strict';
import test from 'node:test';
import type { DossierResourceCandidate } from '../src/adapters/arxiv.js';
import type {
  IdeaDossier,
  ResearchRun,
  ResearchRunGroupResult,
  ResearchSource,
} from '../src/types.js';
import { routeWhatsappMessage } from '../src/workflow.js';
import type { AppServices, WorkflowResult } from '../src/workflow.js';

function source(title: string, provider: ResearchSource['provider']): DossierResourceCandidate {
  return {
    provider,
    title,
    summary: `${title} summary`,
    url: `https://example.com/${provider}/${encodeURIComponent(title)}`,
    trustLevel: 'external-untrusted',
  };
}

function buildDossier(topic = 'Agentes de WhatsApp'): IdeaDossier {
  return {
    id: 'dossier-1',
    sessionId: 'session-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    rawIdeaText: topic,
    mainTopic: topic,
    topicGroups: [
      {
        id: 'group-1',
        label: 'Main topic',
        kind: 'main',
        topics: [topic],
      },
    ],
    researchRuns: [],
    repoAssessments: [],
    notes: [],
  };
}

function makeResearchServices() {
  const dossier = buildDossier();
  const researchRun: ResearchRun = {
    id: 'run-1',
    dossierId: dossier.id,
    createdAt: '2025-01-01T00:00:00.000Z',
    sessionId: dossier.sessionId,
    groupResults: [
      {
        topicGroupId: 'group-1',
        topicGroupLabel: 'Main topic',
        summary: 'Signals are promising.',
        resources: [
          {
            id: 'resource-1',
            provider: 'arxiv',
            title: 'Agent coordination',
            summary: 'Research on coordination patterns.',
            url: 'https://example.com/arxiv/1',
            topicGroupId: 'group-1',
            trustLevel: 'external-untrusted',
          },
          {
            id: 'resource-2',
            provider: 'x',
            title: 'WhatsApp agents in practice',
            summary: 'Operational notes from the field.',
            url: 'https://example.com/x/2',
            topicGroupId: 'group-1',
            trustLevel: 'external-untrusted',
          },
        ],
      },
    ] satisfies ResearchRunGroupResult[],
    crossGroupSummary: 'Overall demand looks real.',
    notes: ['provider:openrouter'],
  };

  const calls = {
    arxiv: [] as string[],
    hackernews: [] as string[],
    x: [] as string[],
    fieldtheory: [] as string[],
    grok: [] as string[],
    brainIngest: [] as string[],
    brainSearch: [] as string[],
    createDossier: [] as string[],
    appendResearchRun: [] as string[],
    resetSession: 0,
  };

  const services: AppServices = {
    config: {
      repoRoot: '/tmp/namastex',
      repoCacheRoot: '/tmp/namastex/cache',
      storePath: '/tmp/namastex/store.json',
      storeOutboxPath: '/tmp/namastex/outbox.jsonl',
      storeDriver: 'json',
      sessionId: 'session-1',
      conversationKey: 'local:test',
      conversationSource: 'local',
      hackerNewsApiBase: 'https://hn.algolia.com/api/v1',
      hackerNewsUserAgent: 'NamastexChallenge/0.1.0',
      defaultGithubOwner: 'openai',
      defaultGithubRepo: 'codex',
      githubApiBase: 'https://api.github.com',
      githubToken: 'token',
      llm: {
        primary: 'claude-cli',
        fallbacks: ['codex-cli'],
        openrouterKey: 'openrouter',
        xaiKey: 'xai',
      },
      xSearchModel: 'grok-4.20-reasoning',
      xSearchLimit: 5,
      genieBrainBin: 'genie',
      genieBrainIngestDir: '/tmp/namastex/brain',
      genieBrainSearchLimit: 5,
    },
    store: {
      createDossier: async (input) => {
        calls.createDossier.push(input.rawIdeaText);
        dossier.rawIdeaText = input.rawIdeaText;
        dossier.mainTopic = input.mainTopic;
        dossier.topicGroups = input.topicGroups || dossier.topicGroups;
        dossier.notes = input.notes || [];
        return dossier;
      },
      appendResearchRun: async (input) => {
        calls.appendResearchRun.push(input.crossGroupSummary);
        dossier.researchRuns = [
          {
            ...researchRun,
            dossierId: input.dossierId,
            crossGroupSummary: input.crossGroupSummary,
            groupResults: input.groupResults,
            notes: input.notes || [],
          },
        ];
        return dossier.researchRuns[0] as ResearchRun;
      },
      saveRepoAssessment: async () => {
        throw new Error('Unexpected repo assessment call in research test.');
      },
      listRecentDossiers: async () => [dossier],
      getDossier: async () => dossier,
      recordResearch: async () => {
        throw new Error('Unexpected recordResearch call.');
      },
      listRecent: async () => [],
      resetSession: async () => {
        calls.resetSession += 1;
      },
      clearAll: async () => {},
      snapshot: async () => ({
        version: 2 as const,
        sessionId: 'session-1',
        updatedAt: new Date().toISOString(),
        dossiers: [dossier],
        records: [],
        tasks: [],
        events: [],
      }),
    } as AppServices['store'],
    arxiv: {
      search: async (query) => {
        calls.arxiv.push(query);
        return [source('arxiv hit', 'arxiv')];
      },
    },
    hackernews: {
      search: async (query) => {
        calls.hackernews.push(query);
        return [source('hn hit', 'hackernews')];
      },
    },
    grok: {
      synthesize: async (query) => {
        calls.grok.push(query);
        return {
          summary: `Synthesized: ${query}`,
          caution: 'Synthetic caution',
          model: 'grok-4.1',
          provider: 'openrouter',
        };
      },
      compareIdeaToRepo: async () => {
        throw new Error('Unexpected repo comparison call in research test.');
      },
    },
    github: {
      validateRepository: async () => {
        throw new Error('Unexpected GitHub validation call.');
      },
      fetchReadme: async () => '',
      searchCode: async () => [],
      normalizeTarget: async () => {
        throw new Error('Unexpected GitHub normalizeTarget call.');
      },
      materializeRepository: async () => {
        throw new Error('Unexpected GitHub materializeRepository call.');
      },
    },
    repomix: {
      validateRepository: async () => {
        throw new Error('Unexpected Repomix call.');
      },
    },
    x: {
      search: async (query) => {
        calls.x.push(query);
        return {
          provider: 'xai',
          configured: true,
          posts: [source('x hit', 'x')],
          notes: ['x search ok'],
        };
      },
    },
    fieldtheory: {
      search: async (query) => {
        calls.fieldtheory.push(query);
        return {
          state: 'ready',
          sources: [source('bookmarked hit', 'fieldtheory')],
          notes: ['fieldtheory ok'],
        };
      },
    },
    genieBrain: {
      ingest: async (input) => {
        calls.brainIngest.push(input.dossierId);
        return {
          state: 'ready',
          notes: ['brain ingested'],
          ingestPath: `/tmp/brain/${input.dossierId}.md`,
        };
      },
      search: async (query) => {
        calls.brainSearch.push(query);
        return {
          state: 'ready',
          sources: [source('brain hit', 'genie-brain')],
          notes: ['brain search ok'],
        };
      },
      probe: async () => 'ready',
    },
  };

  return { services, calls, dossier };
}

test('routeWhatsappMessage dispatches natural research turns', async () => {
  const { services, calls } = makeResearchServices();
  const reply = await routeWhatsappMessage('pesquisa essa ideia de agentes de whatsapp', services);

  assert.equal(reply.command, 'research');
  assert.equal(reply.metadata?.intent, 'research');
  assert.equal(reply.metadata?.source, 'natural-language');
  assert.equal(calls.arxiv[0], 'agentes de whatsapp');
  assert.equal(calls.hackernews[0], 'agentes de whatsapp');
  assert.equal(calls.x[0], 'agentes de whatsapp');
  assert.equal(calls.fieldtheory[0], 'agentes de whatsapp');
  assert.equal(calls.grok[0], 'agentes de whatsapp');
  assert.equal(calls.brainIngest[0], 'dossier-1');
  assert.match(reply.chunks.join(' '), /Já salvei isso como dossiê: dossier-1/);
});

test('routeWhatsappMessage preserves legacy slash commands', async () => {
  const { services, calls, dossier } = makeResearchServices();
  const reply = await routeWhatsappMessage('/wiki agentes', services);

  assert.equal(reply.command, 'wiki');
  assert.equal(reply.metadata?.intent, 'wiki');
  assert.equal(reply.metadata?.source, 'legacy-command');
  assert.equal(calls.brainSearch[0], 'agentes');
  assert.equal((await services.store.getDossier(dossier.id))?.id, dossier.id);
});

test('routeWhatsappMessage clarifies ambiguous repo requests', async () => {
  const reply = await routeWhatsappMessage('analisa esse repo', {
    config: {
      repoRoot: '/tmp/namastex',
      repoCacheRoot: '/tmp/namastex/cache',
      storePath: '/tmp/namastex/store.json',
      storeOutboxPath: '/tmp/namastex/outbox.jsonl',
      storeDriver: 'json',
      sessionId: 'session-1',
      conversationKey: 'local:test',
      conversationSource: 'local',
      hackerNewsApiBase: 'https://hn.algolia.com/api/v1',
      hackerNewsUserAgent: 'NamastexChallenge/0.1.0',
      githubApiBase: 'https://api.github.com',
      githubToken: 'token',
      llm: {
        primary: 'claude-cli',
        fallbacks: ['codex-cli'],
        openrouterKey: 'openrouter',
        xaiKey: 'xai',
      },
      xSearchModel: 'grok-4.20-reasoning',
      xSearchLimit: 5,
      genieBrainBin: 'genie',
      genieBrainIngestDir: '/tmp/namastex/brain',
      genieBrainSearchLimit: 5,
    },
  } as AppServices);

  assert.equal(reply.command, 'clarify');
  assert.match(reply.chunks[0] || '', /GitHub URL/i);
});

test('routeWhatsappMessage resets the active session from natural language', async () => {
  const { services, calls } = makeResearchServices();
  const reply = await routeWhatsappMessage('reseta', services);

  assert.equal(reply.command, 'reset');
  assert.equal(calls.resetSession, 1);
});

test('routeWhatsappMessage compares wiki idea against an explicit repo target', async () => {
  const { services, dossier } = makeResearchServices();
  dossier.researchRuns = [
    {
      id: 'run-1',
      dossierId: dossier.id,
      createdAt: '2025-01-01T00:00:00.000Z',
      sessionId: dossier.sessionId,
      crossGroupSummary: 'Demand looks real.',
      notes: [],
      groupResults: [
        {
          topicGroupId: 'group-1',
          topicGroupLabel: 'Main topic',
          summary: 'Strong evidence.',
          resources: [],
        },
      ],
    },
  ];

  let savedAssessment: {
    dossierId: string;
    fitSummary: string;
    canonicalSlug: string;
  } | null = null;
  services.store.saveRepoAssessment = async (input) => {
    savedAssessment = {
      dossierId: input.dossierId,
      fitSummary: input.fitSummary,
      canonicalSlug:
        typeof input.targetRepo === 'string' ? input.targetRepo : input.targetRepo.canonicalSlug,
    };
    return {
      id: 'assessment-1',
      dossierId: input.dossierId,
      createdAt: '2025-01-01T00:00:00.000Z',
      targetRepo:
        typeof input.targetRepo === 'string'
          ? { canonicalSlug: input.targetRepo }
          : input.targetRepo,
      githubReport: input.githubReport,
      repomixReport: input.repomixReport,
      fitSummary: input.fitSummary,
      fitScore: input.fitScore,
      strengths: input.strengths || [],
      gaps: input.gaps || [],
      risks: input.risks || [],
      recommendedNextSteps: input.recommendedNextSteps || [],
      notes: input.notes || [],
    };
  };
  services.github.materializeRepository = async () => ({
    owner: 'openai',
    repo: 'codex',
    canonicalSlug: 'openai/codex',
    sourceUrl: 'https://github.com/openai/codex',
    normalizedFrom: 'url',
    notes: ['materialized'],
    cacheRoot: '/tmp/cache',
    localPath: '/tmp/cache/openai/codex',
  });
  services.github.validateRepository = async () => ({
    provider: 'github',
    accessible: true,
    owner: 'openai',
    repo: 'codex',
    defaultBranch: 'main',
    readme: 'README',
    issues: [],
    codeSearchable: true,
    canonicalSlug: 'openai/codex',
    sourceUrl: 'https://github.com/openai/codex',
    localPath: '/tmp/cache/openai/codex',
    notes: ['validated'],
  });
  services.repomix.validateRepository = async () => ({
    provider: 'repomix',
    accessible: true,
    path: '/tmp/cache/openai/codex',
    summary: 'pack ok',
    pack: 'Repository pack snapshot:\n- src/index.ts',
    sources: [],
    generatedFrom: 'repomix',
    notes: ['packed'],
  });
  services.grok.compareIdeaToRepo = async () => ({
    summary: 'Aplicar a ideia pode gerar ganho real no pipeline de automação.',
    verdict: 'ganho-real',
    concreteFiles: ['src/index.ts', 'src/workflow.ts'],
    risks: ['Aumenta o custo operacional.'],
    betterTopic: 'Observabilidade do agente',
    provider: 'openrouter:moonshotai/kimi-k2',
    model: 'moonshotai/kimi-k2',
  });

  const reply = await routeWhatsappMessage(
    'testa essa ideia no meu repo https://github.com/openai/codex',
    services,
  );

  if (!savedAssessment) {
    throw new Error('Expected the repo assessment to be saved.');
  }
  const capturedAssessment = savedAssessment as {
    dossierId: string;
    fitSummary: string;
    canonicalSlug: string;
  };

  assert.equal(reply.command, 'repo');
  assert.match(reply.chunks.join(' '), /openai\/codex/);
  assert.equal(capturedAssessment.dossierId, dossier.id);
  assert.equal(capturedAssessment.canonicalSlug, 'openai/codex');
  assert.match(capturedAssessment.fitSummary, /ganho real/i);
});
