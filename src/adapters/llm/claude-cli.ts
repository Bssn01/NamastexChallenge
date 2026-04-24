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
const DEFAULT_CLAUDE_CODE_MODEL = 'claude-sonnet-4-6';

export function createClaudeCliProvider(options: ProviderFactoryOptions): LlmProvider {
  const runner =
    options.execFile || ((file, args, execOptions) => execFile(file, args, execOptions));
  const env = options.env || process.env;
  const model = env.NAMASTEX_CLAUDE_CODE_MODEL || DEFAULT_CLAUDE_CODE_MODEL;

  return {
    id: 'claude-cli',
    model,
    transport: 'claude-cli',
    async complete(req: LlmRequest) {
      const prompt = toPromptText(req);
      const args = ['--dangerously-skip-permissions', '--model', model];
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
        model,
        providerId: 'claude-cli',
        transport: 'claude-cli',
      };
    },
  };
}
