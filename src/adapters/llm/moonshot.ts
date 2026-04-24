import type {
  FetchLike,
  LlmProvider,
  LlmRequest,
  ParsedProviderSpec,
  ProviderFactoryOptions,
} from './provider.js';

export interface MoonshotProviderOptions extends ProviderFactoryOptions {
  spec: ParsedProviderSpec;
  apiKey?: string;
  apiBase?: string;
}

function defaultFetch(url: string, init?: Parameters<FetchLike>[1]) {
  return fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;
}

export function createMoonshotProvider(options: MoonshotProviderOptions): LlmProvider {
  const fetcher = options.fetch || defaultFetch;
  const apiBase = options.apiBase || 'https://api.moonshot.ai/v1';

  return {
    id: options.spec.raw,
    model: options.spec.model,
    transport: 'moonshot',
    async complete(req: LlmRequest) {
      if (!options.apiKey) {
        throw new Error('MOONSHOT_API_KEY is required for Moonshot providers.');
      }

      const response = await fetcher(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.spec.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Moonshot error ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('Moonshot returned an empty response.');
      }

      return {
        content,
        model: options.spec.model,
        providerId: options.spec.raw,
        transport: 'moonshot',
      };
    },
  };
}
