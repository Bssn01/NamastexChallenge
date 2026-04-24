import { normalizeWhitespace } from '../lib/text.js';
import type { DossierResourceCandidate, ResearchTopicContext } from './arxiv.js';

export interface HackerNewsAdapter {
  search(
    query: string,
    limit?: number,
    context?: ResearchTopicContext,
  ): Promise<DossierResourceCandidate[]>;
}

export interface HackerNewsAdapterOptions {
  apiBase?: string;
  userAgent?: string;
}

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  created_at?: string | null;
  story_text?: string | null;
  points?: number | null;
  num_comments?: number | null;
}

function toSource(hit: AlgoliaHit, index: number): DossierResourceCandidate {
  const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const summary = normalizeWhitespace(
    hit.story_text ||
      `${hit.points ?? 0} points • ${hit.num_comments ?? 0} comments${hit.author ? ` • by ${hit.author}` : ''}`,
  );

  return {
    provider: 'hackernews',
    title: hit.title || `Hacker News result ${index + 1}`,
    url,
    summary,
    publishedAt: hit.created_at || undefined,
    tags: ['hackernews', ...(hit.author ? [hit.author] : [])],
    id: hit.objectID,
  };
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
  source: DossierResourceCandidate,
  query: string,
  context?: ResearchTopicContext,
): DossierResourceCandidate {
  return {
    ...source,
    topicGroupId: context?.topicGroupId,
    topicGroupLabel: context?.topicGroupLabel,
    origin: source.url || 'https://hn.algolia.com/api/v1/search',
    trustLevel: 'external-untrusted',
    score: scoreAgainstQuery(source, query),
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

export function createHackerNewsAdapter(options: HackerNewsAdapterOptions): HackerNewsAdapter {
  const apiBase = options.apiBase || 'https://hn.algolia.com/api/v1';
  const userAgent = options.userAgent || 'NamastexChallenge/0.1.0';

  return {
    async search(
      query: string,
      limit = 5,
      context?: ResearchTopicContext,
    ): Promise<DossierResourceCandidate[]> {
      const url = new URL(`${apiBase}/search`);
      url.searchParams.set('query', query);
      url.searchParams.set('tags', 'story');
      url.searchParams.set('hitsPerPage', String(limit));

      const response = await fetch(url, {
        headers: { 'User-Agent': userAgent },
      });

      if (!response.ok) {
        throw new Error(`Hacker News request failed: ${response.status}`);
      }

      const payload = (await response.json()) as { hits?: AlgoliaHit[] };
      const hits = payload.hits || [];
      return hits
        .slice(0, limit)
        .map((hit, index) => annotateResource(toSource(hit, index), query, context));
    },
  };
}
