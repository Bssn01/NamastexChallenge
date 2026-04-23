import { resolve } from 'node:path';
import { readJsonFile } from './lib/json.js';
import type { ResearchSource } from './types.js';

export interface ResearchSamples {
  arxiv: ResearchSource[];
  hackernews: ResearchSource[];
  grok: {
    summaryLead: string;
    caution: string;
  };
}

export interface GitHubLabFixture {
  owner: string;
  repo: string;
  defaultBranch: string;
  readme: string;
  issues: Array<{ title: string; url: string; state: 'open' | 'closed' }>;
  codeSearchable: boolean;
}

const defaultResearchSamples: ResearchSamples = {
  arxiv: [
    {
      provider: 'arxiv',
      title: 'Agentic workflows for message-first research systems',
      url: 'https://arxiv.org/abs/2401.00001',
      summary:
        'A concise pattern for separating retrieval, synthesis, and delivery in chat-driven agents.',
      publishedAt: '2025-01-18',
      tags: ['agents', 'retrieval', 'messaging'],
      id: 'arxiv-1',
    },
    {
      provider: 'arxiv',
      title: 'Low-latency orchestration for collaborative LLM swarms',
      url: 'https://arxiv.org/abs/2401.00002',
      summary:
        'Shows how bounded concurrency and explicit handoff contracts reduce chat tool drift.',
      publishedAt: '2025-02-04',
      tags: ['orchestration', 'latency', 'swarm'],
      id: 'arxiv-2',
    },
  ],
  hackernews: [
    {
      provider: 'hackernews',
      title: 'Practical lessons from building WhatsApp-native assistants',
      url: 'https://news.ycombinator.com/item?id=44000001',
      summary: '142 points • 87 comments • by pg',
      publishedAt: '2025-03-02',
      tags: ['hackernews', 'agents', 'whatsapp'],
      id: 'hn-1',
    },
    {
      provider: 'hackernews',
      title: 'What made our multi-agent setup reliable in production',
      url: 'https://news.ycombinator.com/item?id=44000002',
      summary: '98 points • 41 comments • by tptacek',
      publishedAt: '2025-03-10',
      tags: ['hackernews', 'multi-agent', 'reliability'],
      id: 'hn-2',
    },
  ],
  grok: {
    summaryLead:
      'Grok synthesis says the safest MVP is one that always research-checks three layers: academic signal, practitioner signal, and a short synthesis pass.',
    caution:
      'Keep the response short enough for WhatsApp and persist the evidence trail before any handoff.',
  },
};

const defaultGitHubFixture: GitHubLabFixture = {
  owner: 'Bssn01',
  repo: 'NamastexChallenge',
  defaultBranch: 'main',
  readme: '# NamastexChallenge\n\nMock README fixture for the validation lab.',
  issues: [
    {
      title: 'Wire the research workflow',
      url: 'https://github.com/Bssn01/NamastexChallenge/issues/1',
      state: 'open',
    },
    {
      title: 'Document auth setup',
      url: 'https://github.com/Bssn01/NamastexChallenge/issues/2',
      state: 'closed',
    },
  ],
  codeSearchable: true,
};

export async function loadResearchSamples(path: string): Promise<ResearchSamples> {
  return readJsonFile(path, defaultResearchSamples);
}

export async function loadGitHubFixture(path: string): Promise<GitHubLabFixture> {
  return readJsonFile(path, defaultGitHubFixture);
}

export function defaultResearchFixturePath(repoRoot: string): string {
  return resolve(repoRoot, 'fixtures', 'mock', 'research-samples.json');
}
