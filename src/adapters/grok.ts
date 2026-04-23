import { loadResearchSamples } from '../fixtures.js';
import type { ResearchSource, RuntimeMode } from '../types.js';

export interface GrokSummary {
  summary: string;
  caution: string;
  model: string;
  provider: 'openrouter' | 'xai' | 'mock';
}

export interface GrokAdapter {
  synthesize(query: string, sources: ResearchSource[]): Promise<GrokSummary>;
}

export interface GrokAdapterOptions {
  mode: RuntimeMode;
  fixturePath: string;
  openRouterApiKey?: string;
  xaiApiKey?: string;
  model: string;
}

function compactSourceList(sources: ResearchSource[]): string {
  return sources
    .slice(0, 6)
    .map((source) => `- ${source.provider}: ${source.title} :: ${source.summary}`)
    .join('\n');
}

async function callOpenRouter(
  options: GrokAdapterOptions,
  query: string,
  sources: ResearchSource[],
): Promise<string | null> {
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
      messages: [
        {
          role: 'system',
          content:
            'You are Grok in a research pipeline. Return a concise two-sentence synthesis in Portuguese, suitable for WhatsApp.',
        },
        {
          role: 'user',
          content: `Pergunta: ${query}\n\nFontes:\n${compactSourceList(sources)}`,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() || null;
}

async function callXai(
  options: GrokAdapterOptions,
  query: string,
  sources: ResearchSource[],
): Promise<string | null> {
  if (!options.xaiApiKey) return null;
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.xaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: 'system',
          content:
            'You are Grok in a research pipeline. Return a concise two-sentence synthesis in Portuguese, suitable for WhatsApp.',
        },
        {
          role: 'user',
          content: `Pergunta: ${query}\n\nFontes:\n${compactSourceList(sources)}`,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() || null;
}

export function createGrokAdapter(options: GrokAdapterOptions): GrokAdapter {
  return {
    async synthesize(query: string, sources: ResearchSource[]): Promise<GrokSummary> {
      if (options.mode === 'real') {
        const openRouter = await callOpenRouter(options, query, sources);
        if (openRouter) {
          return {
            summary: openRouter,
            caution: 'Synthesis produced by OpenRouter-backed Grok.',
            model: options.model,
            provider: 'openrouter',
          };
        }

        const xai = await callXai(options, query, sources);
        if (xai) {
          return {
            summary: xai,
            caution: 'Synthesis produced by xAI-backed Grok.',
            model: options.model,
            provider: 'xai',
          };
        }
      }

      const fixture = await loadResearchSamples(options.fixturePath);
      const topTitles = sources
        .slice(0, 3)
        .map((source) => source.title)
        .join('; ');
      return {
        summary: `${fixture.grok.summaryLead} Ponto focal: ${query}. Sinais úteis: ${topTitles || 'sem fontes ainda'}.`,
        caution: fixture.grok.caution,
        model: options.model,
        provider: 'mock',
      };
    },
  };
}
