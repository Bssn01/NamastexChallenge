import type {
  FetchLike,
  LlmProvider,
  LlmRequest,
  ParsedProviderSpec,
  ProviderFactoryOptions,
} from './provider.js';

export interface AnthropicProviderOptions extends ProviderFactoryOptions {
  spec: ParsedProviderSpec;
  apiKey?: string;
}

function defaultFetch(url: string, init?: Parameters<FetchLike>[1]) {
  return fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;
}

function splitMessages(req: LlmRequest) {
  const system = req.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const messages = req.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: message.content }],
    }));
  return { system, messages };
}

export function createAnthropicApiProvider(options: AnthropicProviderOptions): LlmProvider {
  const fetcher = options.fetch || defaultFetch;

  return {
    id: options.spec.raw,
    model: options.spec.model,
    transport: 'anthropic',
    async complete(req: LlmRequest) {
      if (!options.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for Anthropic providers.');
      }

      const { system, messages } = splitMessages(req);
      const response = await fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: options.spec.model,
          system,
          messages,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 2048,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Anthropic error ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      }

      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const content = payload.content
        ?.filter((item) => item.type === 'text' && item.text)
        .map((item) => item.text)
        .join('\n')
        .trim();

      if (!content) {
        throw new Error('Anthropic returned an empty response.');
      }

      return {
        content,
        model: options.spec.model,
        providerId: options.spec.raw,
        transport: 'anthropic',
      };
    },
  };
}
