import { loadResearchSamples } from '../fixtures.js';
import { normalizeWhitespace } from '../lib/text.js';
import type { ResearchSource, RuntimeMode } from '../types.js';

export interface HackerNewsAdapter {
  search(query: string, limit?: number): Promise<ResearchSource[]>;
}

export interface HackerNewsAdapterOptions {
  mode: RuntimeMode;
  fixturePath: string;
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

function toSource(hit: AlgoliaHit, index: number): ResearchSource {
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

function scoreAgainstQuery(source: ResearchSource, query: string): number {
  const haystack = normalizeWhitespace(
    `${source.title} ${source.summary} ${(source.tags || []).join(' ')}`,
  ).toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function sortByQueryMatch(items: ResearchSource[], query: string): ResearchSource[] {
  return [...items].sort(
    (left, right) => scoreAgainstQuery(right, query) - scoreAgainstQuery(left, query),
  );
}

export function createHackerNewsAdapter(options: HackerNewsAdapterOptions): HackerNewsAdapter {
  const apiBase = options.apiBase || 'https://hn.algolia.com/api/v1';
  const userAgent = options.userAgent || 'NamastexChallenge/0.1.0';

  return {
    async search(query: string, limit = 4): Promise<ResearchSource[]> {
      if (options.mode !== 'real') {
        const fixture = await loadResearchSamples(options.fixturePath);
        return sortByQueryMatch(fixture.hackernews, query).slice(0, limit);
      }

      try {
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
        return hits.slice(0, limit).map(toSource);
      } catch (error) {
        console.warn(
          `[hackernews] fallback to fixture: ${error instanceof Error ? error.message : String(error)}`,
        );
        const fixture = await loadResearchSamples(options.fixturePath);
        return sortByQueryMatch(fixture.hackernews, query)
          .slice(0, limit)
          .map((source) => ({
            ...source,
            tags: [...(source.tags || []), 'fixture-fallback'],
          }));
      }
    },
  };
}
