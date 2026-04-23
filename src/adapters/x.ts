import { loadResearchSamples } from '../fixtures.js';
import { TRUST_BOUNDARY_NOTICE, formatUntrustedEvidence } from '../lib/security.js';
import type { RuntimeMode } from '../types.js';
import type { DossierResourceCandidate, ResearchTopicContext } from './arxiv.js';

export interface XSearchResult {
  provider: 'xai' | 'openrouter' | 'mock' | 'unconfigured';
  configured: boolean;
  posts: DossierResourceCandidate[];
  notes: string[];
}

export interface XSearchAdapter {
  search(query: string, limit?: number, context?: ResearchTopicContext): Promise<XSearchResult>;
}

export interface XSearchAdapterOptions {
  mode: RuntimeMode;
  fixturePath: string;
  xaiApiKey?: string;
  openRouterApiKey?: string;
  model: string;
}

interface XResultCandidate {
  title?: string;
  url?: string;
  summary?: string;
  publishedAt?: string;
  score?: number;
  tags?: string[];
}

function toPost(
  candidate: XResultCandidate,
  query: string,
  context?: ResearchTopicContext,
): DossierResourceCandidate {
  return {
    provider: 'x',
    title: candidate.title || `X post about ${query}`,
    url: candidate.url,
    summary: candidate.summary || 'Relevant X post returned by Grok X search.',
    publishedAt: candidate.publishedAt,
    tags: Array.from(
      new Set([
        ...(candidate.tags || []),
        'x',
        'external-untrusted',
        ...(context?.topicGroupLabel ? [context.topicGroupLabel] : []),
      ]),
    ),
    origin: candidate.url || 'https://x.com',
    trustLevel: 'external-untrusted',
    score: candidate.score,
    topicGroupId: context?.topicGroupId,
    topicGroupLabel: context?.topicGroupLabel,
    query,
  };
}

function buildPrompt(query: string, limit: number, context?: ResearchTopicContext): string {
  return [
    TRUST_BOUNDARY_NOTICE,
    `Return strict JSON only: an array of up to ${limit} objects.`,
    'Each object must have keys: title, url, summary, publishedAt, score, tags.',
    'Find only the most relevant and highest-signal X posts for this topic. Prefer posts with strong implementation value and clear engagement.',
    context?.rawIdeaText ? formatUntrustedEvidence('IDEA', context.rawIdeaText) : '',
    context?.mainTopic ? `Main topic: ${context.mainTopic}` : '',
    context?.topicGroupLabel ? `Topic group: ${context.topicGroupLabel}` : '',
    `Search query: ${query}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function parseJsonArray(raw: string): XResultCandidate[] | null {
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = normalized.indexOf('[');
  const end = normalized.lastIndexOf(']');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(normalized.slice(start, end + 1)) as XResultCandidate[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function callXai(
  options: XSearchAdapterOptions,
  query: string,
  limit: number,
  context?: ResearchTopicContext,
): Promise<XResultCandidate[] | null> {
  if (!options.xaiApiKey) return null;

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.xaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      input: buildPrompt(query, limit, context),
      tools: [{ type: 'x_search' }],
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const text =
    payload.output_text ||
    payload.output
      ?.flatMap((entry) => entry.content || [])
      .map((item) => item.text || '')
      .join('\n') ||
    '';
  return parseJsonArray(text);
}

async function callOpenRouter(
  options: XSearchAdapterOptions,
  query: string,
  limit: number,
  context?: ResearchTopicContext,
): Promise<XResultCandidate[] | null> {
  if (!options.openRouterApiKey) return null;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'NamastexChallenge',
    },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: 'user', content: buildPrompt(query, limit, context) }],
      plugins: [{ id: 'web' }],
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseJsonArray(payload.choices?.[0]?.message?.content || '');
}

export function createXSearchAdapter(options: XSearchAdapterOptions): XSearchAdapter {
  return {
    async search(query: string, limit = 5, context?: ResearchTopicContext): Promise<XSearchResult> {
      if (options.mode !== 'real') {
        const fixture = await loadResearchSamples(options.fixturePath);
        return {
          provider: 'mock',
          configured: true,
          posts: (fixture.x || []).slice(0, limit).map((post) => toPost(post, query, context)),
          notes: ['Mock X search results loaded from fixtures.'],
        };
      }

      const xai = await callXai(options, query, limit, context);
      if (xai && xai.length > 0) {
        return {
          provider: 'xai',
          configured: true,
          posts: xai.slice(0, limit).map((post) => toPost(post, query, context)),
          notes: ['X search completed with xAI native x_search.'],
        };
      }

      const openRouter = await callOpenRouter(options, query, limit, context);
      if (openRouter && openRouter.length > 0) {
        return {
          provider: 'openrouter',
          configured: true,
          posts: openRouter.slice(0, limit).map((post) => toPost(post, query, context)),
          notes: ['X search completed with OpenRouter xAI search.'],
        };
      }

      return {
        provider: 'unconfigured',
        configured: false,
        posts: [],
        notes: ['X search is not configured. Set XAI_API_KEY or OPENROUTER_API_KEY.'],
      };
    },
  };
}
