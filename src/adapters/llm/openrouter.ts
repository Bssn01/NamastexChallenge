import type {
  FetchLike,
  LlmProvider,
  LlmRequest,
  ParsedProviderSpec,
  ProviderFactoryOptions,
} from './provider.js';

export interface OpenRouterProviderOptions extends ProviderFactoryOptions {
  spec: ParsedProviderSpec;
  apiKey?: string;
}

function defaultFetch(url: string, init?: Parameters<FetchLike>[1]) {
  return fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions): LlmProvider {
  const fetcher = options.fetch || defaultFetch;

  return {
    id: options.spec.raw,
    model: options.spec.model,
    transport: 'openrouter',
    async complete(req: LlmRequest) {
      if (!options.apiKey) {
        throw new Error('OPENROUTER_API_KEY is required for OpenRouter providers.');
      }

      const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'NamastexChallenge',
        },
        body: JSON.stringify({
          model: options.spec.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens,
          response_format: req.responseFormat === 'json' ? { type: 'json_object' } : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenRouter error ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('OpenRouter returned an empty response.');
      }

      return {
        content,
        model: options.spec.model,
        providerId: options.spec.raw,
        transport: 'openrouter',
      };
    },
  };
}
