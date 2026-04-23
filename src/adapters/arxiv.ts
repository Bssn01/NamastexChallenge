import { loadResearchSamples } from '../fixtures.js';
import { normalizeWhitespace } from '../lib/text.js';
import type { ResearchSource, RuntimeMode } from '../types.js';

export interface ArxivAdapter {
  search(query: string, limit?: number): Promise<ResearchSource[]>;
}

export interface ArxivAdapterOptions {
  mode: RuntimeMode;
  fixturePath: string;
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

async function parseArxivFeed(feed: string): Promise<ResearchSource[]> {
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

export function createArxivAdapter(options: ArxivAdapterOptions): ArxivAdapter {
  return {
    async search(query: string, limit = 4): Promise<ResearchSource[]> {
      if (options.mode !== 'real') {
        const fixture = await loadResearchSamples(options.fixturePath);
        return sortByQueryMatch(fixture.arxiv, query).slice(0, limit);
      }

      try {
        const url = new URL('https://export.arxiv.org/api/query');
        url.searchParams.set('search_query', `all:${query}`);
        url.searchParams.set('start', '0');
        url.searchParams.set('max_results', String(limit));
        url.searchParams.set('sortBy', 'relevance');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`arXiv request failed: ${response.status}`);
        const feed = await response.text();
        return (await parseArxivFeed(feed)).slice(0, limit);
      } catch {
        const fixture = await loadResearchSamples(options.fixturePath);
        return sortByQueryMatch(fixture.arxiv, query)
          .slice(0, limit)
          .map((source) => ({
            ...source,
            tags: [...(source.tags || []), 'fixture-fallback'],
          }));
      }
    },
  };
}
