import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { LlmProvider, LlmRequest, ProviderFactoryOptions } from './provider.js';
import { toPromptText } from './provider.js';

const execFile = promisify(execFileCallback);

export function createCodexCliProvider(options: ProviderFactoryOptions): LlmProvider {
  const runner =
    options.execFile || ((file, args, execOptions) => execFile(file, args, execOptions));
  const env = options.env || process.env;

  return {
    id: 'codex-cli',
    model: 'codex-cli',
    transport: 'codex-cli',
    async complete(req: LlmRequest) {
      const { stdout, stderr } = await runner(
        'codex',
        [
          'exec',
          '--dangerously-bypass-approvals-and-sandbox',
          '--cd',
          options.repoRoot,
          toPromptText(req),
        ],
        {
          cwd: req.metadata?.workingDirectory || options.repoRoot,
          env,
        },
      );

      const content = stdout.trim();
      if (!content) {
        throw new Error(stderr.trim() || 'Codex CLI returned an empty response.');
      }

      return {
        content,
        model: 'codex-cli',
        providerId: 'codex-cli',
        transport: 'codex-cli',
      };
    },
  };
}
