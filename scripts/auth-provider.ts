import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCancel, note, outro, password, select } from '@clack/prompts';
import {
  type ProviderAuthTarget,
  authCommandToShell,
  buildProviderAuthCommand,
  buildTerminalLaunchCommand,
} from '../src/admin/auth.js';
import { type AdminModeRequest, detectAdminMode } from '../src/admin/commands.js';
import { upsertEnvValue } from '../src/admin/env.js';

function parseArgs(argv: string[]): { provider: ProviderAuthTarget; mode: AdminModeRequest } {
  const provider = argv.find((arg) => !arg.startsWith('--')) as ProviderAuthTarget | undefined;
  let mode: AdminModeRequest = 'auto';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      const next = argv[index + 1];
      if (next === 'local' || next === 'docker' || next === 'auto') mode = next;
      index += 1;
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value === 'local' || value === 'docker' || value === 'auto') mode = value;
    }
  }
  if (provider !== 'claude' && provider !== 'codex' && provider !== 'kimi') {
    throw new Error('Usage: npm run auth:claude|auth:codex|auth:kimi');
  }
  return { provider, mode };
}

async function configureKimi(repoRoot: string): Promise<void> {
  const provider = await select({
    message: 'Kimi provider',
    options: [
      { label: 'OpenRouter moonshotai/kimi-k2', value: 'OPENROUTER_API_KEY' },
      { label: 'Moonshot kimi-k2.6', value: 'MOONSHOT_API_KEY' },
    ],
  });
  if (isCancel(provider)) process.exit(1);

  const key = await password({
    message: `Enter ${provider}`,
    validate(value) {
      if (!value.trim()) return `${provider} is required.`;
      return undefined;
    },
  });
  if (isCancel(key)) process.exit(1);

  await upsertEnvValue(resolve(repoRoot, '.env'), String(provider), String(key));
  note(
    provider === 'OPENROUTER_API_KEY'
      ? 'Stored OpenRouter key. Use provider spec openrouter:moonshotai/kimi-k2.'
      : 'Stored Moonshot key. Use provider spec moonshot:kimi-k2.6.',
    'Kimi auth',
  );
}

function launch(command: { file: string; args: string[] }): void {
  const child = spawn(command.file, command.args, {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
  });
  child.unref();
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const { provider, mode: requestedMode } = parseArgs(process.argv.slice(2));

  if (provider === 'kimi') {
    await configureKimi(repoRoot);
    outro('Kimi API configuration saved.');
    return;
  }

  const { mode } = await detectAdminMode(repoRoot, requestedMode);
  const authCommand = buildProviderAuthCommand(provider, mode);
  if (!authCommand) throw new Error(`No interactive command for ${provider}.`);
  const shellCommand = authCommandToShell(authCommand, repoRoot);
  const launchCommand = buildTerminalLaunchCommand(process.platform, shellCommand);
  if (!launchCommand) {
    note(shellCommand, `${provider} auth`);
    return;
  }
  launch(launchCommand);
  note(shellCommand, `${provider} auth terminal`);
  outro('A terminal was opened for the provider login.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
