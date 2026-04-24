import type {
  FetchLike,
  LlmProvider,
  LlmRequest,
  ParsedProviderSpec,
  ProviderFactoryOptions,
} from './provider.js';

export interface XaiProviderOptions extends ProviderFactoryOptions {
  spec: ParsedProviderSpec;
  apiKey?: string;
}

function defaultFetch(url: string, init?: Parameters<FetchLike>[1]) {
  return fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;
}

export function createXaiProvider(options: XaiProviderOptions): LlmProvider {
  const fetcher = options.fetch || defaultFetch;

  return {
    id: options.spec.raw,
    model: options.spec.model,
    transport: 'xai',
    async complete(req: LlmRequest) {
      if (!options.apiKey) {
        throw new Error('XAI_API_KEY is required for xAI providers.');
      }

      const response = await fetcher('https://api.x.ai/v1/chat/completions', {
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
        throw new Error(`xAI error ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('xAI returned an empty response.');
      }

      return {
        content,
        model: options.spec.model,
        providerId: options.spec.raw,
        transport: 'xai',
      };
    },
  };
}
