import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type LlmProvider,
  type LlmRequest,
  type ProviderFactoryOptions,
  claudePromptFile,
  toPromptText,
} from './provider.js';

const execFile = promisify(execFileCallback);

export function createClaudeCliProvider(options: ProviderFactoryOptions): LlmProvider {
  const runner =
    options.execFile || ((file, args, execOptions) => execFile(file, args, execOptions));
  const env = options.env || process.env;

  return {
    id: 'claude-cli',
    model: 'claude-cli',
    transport: 'claude-cli',
    async complete(req: LlmRequest) {
      const prompt = toPromptText(req);
      const args = ['--dangerously-skip-permissions'];
      if (req.metadata?.mode === 'turn') {
        args.push(
          '--append-system-prompt-file',
          req.metadata.appendSystemPromptFile || claudePromptFile(options.repoRoot),
        );
      }
      args.push(prompt);

      const { stdout, stderr } = await runner('claude', args, {
        cwd: req.metadata?.workingDirectory || options.repoRoot,
        env,
      });

      const content = stdout.trim();
      if (!content) {
        throw new Error(stderr.trim() || 'Claude CLI returned an empty response.');
      }

      return {
        content,
        model: 'claude-cli',
        providerId: 'claude-cli',
        transport: 'claude-cli',
      };
    },
  };
}
