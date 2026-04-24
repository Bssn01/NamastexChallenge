import { createAnthropicApiProvider } from './anthropic-api.js';
import { createClaudeCliProvider } from './claude-cli.js';
import { createCodexCliProvider } from './codex-cli.js';
import { createMoonshotProvider } from './moonshot.js';
import { createOpenRouterProvider } from './openrouter.js';
import {
  type LlmConfig,
  type LlmProvider,
  type ProviderFactoryOptions,
  defaultProviderSpecs,
  parseProviderSpec,
} from './provider.js';
import { createXaiProvider } from './xai.js';

export function resolveProviders(
  config: LlmConfig,
  options: ProviderFactoryOptions,
): LlmProvider[] {
  return defaultProviderSpecs(config).map((specValue) => {
    const spec = parseProviderSpec(specValue);
    switch (spec.transport) {
      case 'claude-cli':
        return createClaudeCliProvider(options);
      case 'codex-cli':
        return createCodexCliProvider(options);
      case 'openrouter':
        return createOpenRouterProvider({
          ...options,
          spec,
          apiKey: config.openrouterKey,
        });
      case 'anthropic':
        return createAnthropicApiProvider({
          ...options,
          spec,
          apiKey: config.anthropicKey,
        });
      case 'moonshot':
        return createMoonshotProvider({
          ...options,
          spec,
          apiKey: config.moonshotKey,
        });
      case 'xai':
        return createXaiProvider({
          ...options,
          spec,
          apiKey: config.xaiKey,
        });
      default:
        throw new Error(`Unsupported provider transport: ${String(spec.transport)}`);
    }
  });
}

export * from './provider.js';
