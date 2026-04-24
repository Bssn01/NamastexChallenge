import { normalizeWhitespace } from '../lib/text.js';
import type { ResearchSource } from '../types.js';

export interface ResearchTopicContext {
  topicGroupId?: string;
  topicGroupLabel?: string;
  rawIdeaText?: string;
  mainTopic?: string;
}

export type DossierResourceCandidate = ResearchSource & {
  topicGroupId?: string;
  topicGroupLabel?: string;
  origin?: string;
  trustLevel?: 'external-untrusted';
  score?: number;
  query?: string;
};

export interface ArxivAdapter {
  search(
    query: string,
    limit?: number,
    context?: ResearchTopicContext,
  ): Promise<DossierResourceCandidate[]>;
}

function scoreAgainstQuery(source: DossierResourceCandidate, query: string): number {
  const haystack = normalizeWhitespace(
    `${source.title} ${source.summary} ${(source.tags || []).join(' ')}`,
  ).toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function sortByQueryMatch(
  items: DossierResourceCandidate[],
  query: string,
): DossierResourceCandidate[] {
  return [...items].sort(
    (left, right) => scoreAgainstQuery(right, query) - scoreAgainstQuery(left, query),
  );
}

function annotateResource(
  source: ResearchSource,
  query: string,
  context?: ResearchTopicContext,
): DossierResourceCandidate {
  const score = scoreAgainstQuery(source, query);
  return {
    ...source,
    topicGroupId: context?.topicGroupId,
    topicGroupLabel: context?.topicGroupLabel,
    origin: source.url || 'https://export.arxiv.org/api/query',
    trustLevel: 'external-untrusted',
    score,
    query,
    tags: Array.from(
      new Set([
        ...(source.tags || []),
        'external-untrusted',
        ...(context?.topicGroupLabel ? [context.topicGroupLabel] : []),
      ]),
    ),
  };
}

async function parseArxivFeed(feed: string): Promise<DossierResourceCandidate[]> {
  const entries = feed
    .split(/<entry>/)
    .slice(1)
    .map((chunk) => chunk.split('</entry>')[0]);
  return entries.map((entry, index) => {
    const title =
      entry
        .match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]
        ?.trim()
        .replace(/\s+/g, ' ') ?? `ArXiv result ${index + 1}`;
    const summary =
      entry
        .match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]
        ?.trim()
        .replace(/\s+/g, ' ') ?? '';
    const url = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim();
    const publishedAt = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim();
    return {
      provider: 'arxiv',
      title,
      url,
      summary,
      publishedAt,
      tags: ['arxiv'],
    };
  });
}

export function createArxivAdapter(): ArxivAdapter {
  return {
    async search(
      query: string,
      limit = 5,
      context?: ResearchTopicContext,
    ): Promise<DossierResourceCandidate[]> {
      const url = new URL('https://export.arxiv.org/api/query');
      url.searchParams.set('search_query', `all:${query}`);
      url.searchParams.set('start', '0');
      url.searchParams.set('max_results', String(limit));
      url.searchParams.set('sortBy', 'relevance');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`arXiv request failed: ${response.status}`);
      const feed = await response.text();
      return (await parseArxivFeed(feed))
        .slice(0, limit)
        .map((source) => annotateResource(source, query, context));
    },
  };
}
