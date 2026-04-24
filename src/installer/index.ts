import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { LLM_PROVIDER_CATALOG } from '../adapters/llm/provider.js';

interface InstallerState {
  repoRoot: string;
  envPath: string;
  values: Record<string, string>;
}

interface DetectedTools {
  omni: boolean;
  genie: boolean;
  claude: boolean;
  codex: boolean;
}

async function ensureAccessible(command: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    child.on('close', (code) => resolvePromise(code === 0));
    child.on('error', () => resolvePromise(false));
  });
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = { cwd: process.cwd() },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const textChunk = String(chunk);
      stdout += textChunk;
      if (!options.quiet) process.stdout.write(textChunk);
    });
    child.stderr.on('data', (chunk) => {
      const textChunk = String(chunk);
      stderr += textChunk;
      if (!options.quiet) process.stderr.write(textChunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
}

function parseEnvFile(contents: string): Record<string, string> {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce<Record<string, string>>((acc, line) => {
      const separator = line.indexOf('=');
      if (separator < 0) return acc;
      acc[line.slice(0, separator)] = line.slice(separator + 1);
      return acc;
    }, {});
}

function serializeEnv(values: Record<string, string>): string {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
    .concat('\n');
}

async function readEnvFile(envPath: string): Promise<Record<string, string>> {
  try {
    const contents = await readFile(envPath, 'utf8');
    return parseEnvFile(contents);
  } catch {
    return {};
  }
}

async function writeEnvFile(envPath: string, values: Record<string, string>): Promise<void> {
  const tempPath = `${envPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, serializeEnv(values), 'utf8');
  await rename(tempPath, envPath);
}

async function maybePromptSecret(
  state: InstallerState,
  key: string,
  label: string,
  required = false,
): Promise<void> {
  const existing = state.values[key];
  const shouldUse = await select({
    message: `${label}?`,
    options: [
      { label: existing ? 'Keep current value' : 'Use', value: 'keep' },
      { label: existing ? 'Replace' : 'Skip', value: 'replace' },
    ],
  });
  if (isCancel(shouldUse)) process.exit(1);

  if (shouldUse === 'keep') {
    if (required && !existing) {
      await maybePromptSecret(state, key, label, required);
    }
    return;
  }

  const secret = await password({
    message: `Enter ${label}`,
    validate(value) {
      if (required && !value.trim()) return `${label} is required.`;
      return undefined;
    },
  });
  if (isCancel(secret)) process.exit(1);
  if (secret) {
    state.values[key] = secret;
  } else if (required) {
    await maybePromptSecret(state, key, label, required);
  }
}

function extractInstanceId(output: string): string | undefined {
  const match = output.match(/\b([0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24,})\b/i);
  return match?.[1];
}

async function detectTools(repoRoot: string): Promise<DetectedTools> {
  const s = spinner();
  s.start('Checking local CLI availability');
  const [omni, genie, claude, codex] = await Promise.all([
    ensureAccessible('omni'),
    ensureAccessible('genie'),
    ensureAccessible('claude'),
    ensureAccessible('codex'),
  ]);
  s.stop(
    [
      `Omni ${omni ? 'found' : 'missing'}`,
      `Genie ${genie ? 'found' : 'missing'}`,
      `Claude CLI ${claude ? 'found' : 'missing'}`,
      `Codex CLI ${codex ? 'found' : 'missing'}`,
    ].join(', '),
  );
  return { omni, genie, claude, codex };
}

async function bootstrapIfNeeded(repoRoot: string, detected: DetectedTools) {
  if (detected.omni && detected.genie) return;

  const mode = await select({
    message: 'Omni or Genie is missing. How should setup continue?',
    options: [
      { label: 'Automatic bootstrap', value: 'auto' },
      { label: 'Manual instructions', value: 'manual' },
    ],
  });
  if (isCancel(mode)) process.exit(1);

  if (mode === 'manual') {
    note(
      [
        'Run these commands manually:',
        '',
        'npm run deps:bootstrap',
        'genie setup --quick',
        'genie init agent namastex-research',
        'genie dir sync',
      ].join('\n'),
      'Manual bootstrap',
    );
    process.exit(0);
  }

  await runCommand('npm', ['run', 'deps:bootstrap'], { cwd: repoRoot });
}

async function configureClaudeAuth(state: InstallerState, detected: DetectedTools) {
  const authMode = await select({
    message: 'Claude authentication',
    options: [
      {
        label: detected.claude
          ? 'Use local Claude CLI login'
          : 'Use local Claude CLI after I log in',
        value: 'claude-cli',
      },
      { label: 'Use Anthropic API key', value: 'anthropic-api' },
      { label: 'Skip Claude for now', value: 'skip' },
    ],
  });
  if (isCancel(authMode)) process.exit(1);

  if (authMode === 'claude-cli') {
    state.values.NAMASTEX_LLM_PRIMARY = 'claude-cli';
    state.values.ANTHROPIC_API_KEY ||= '';
    state.values.CLAUDE_CODE_OAUTH_TOKEN ||= '';

    if (!detected.claude) {
      note(
        [
          'Install and authenticate Claude Code before starting the local host flow:',
          '',
          'npm install -g @anthropic-ai/claude-code',
          'claude',
          '',
          'After the browser login finishes, run `npm run setup` again.',
        ].join('\n'),
        'Claude CLI login',
      );
    }
    return;
  }

  if (authMode === 'anthropic-api') {
    await maybePromptSecret(state, 'ANTHROPIC_API_KEY', 'Anthropic API key', true);
    state.values.NAMASTEX_LLM_PRIMARY = 'anthropic:claude-opus-4-1';
    return;
  }

  state.values.ANTHROPIC_API_KEY ||= '';
  state.values.CLAUDE_CODE_OAUTH_TOKEN ||= '';
}

async function configureSecrets(state: InstallerState, detected: DetectedTools) {
  await maybePromptSecret(state, 'GITHUB_TOKEN', 'GitHub token', true);
  await configureClaudeAuth(state, detected);
  await maybePromptSecret(state, 'OPENROUTER_API_KEY', 'OpenRouter API key');
  await maybePromptSecret(state, 'XAI_API_KEY', 'xAI API key');
  await maybePromptSecret(state, 'MOONSHOT_API_KEY', 'Moonshot API key');
}

async function chooseProviders(state: InstallerState, detected: DetectedTools) {
  const configured = [
    state.values.NAMASTEX_LLM_PRIMARY,
    ...(state.values.NAMASTEX_LLM_FALLBACKS || '').split(',').filter(Boolean),
  ].filter(Boolean);
  const initialValues =
    configured.length > 0
      ? configured
      : [detected.claude ? 'claude-cli' : undefined, detected.codex ? 'codex-cli' : undefined]
          .filter((value): value is string => Boolean(value));

  const selected = await multiselect({
    message: 'Choose provider order',
    initialValues: initialValues.length > 0 ? initialValues : ['claude-cli', 'codex-cli'],
    options: LLM_PROVIDER_CATALOG.map((entry) => ({
      label: entry.label,
      value: entry.value,
    })),
    required: true,
  });
  if (isCancel(selected)) process.exit(1);

  const [primary, ...fallbacks] = selected as string[];
  state.values.NAMASTEX_LLM_PRIMARY = primary;
  state.values.NAMASTEX_LLM_FALLBACKS = fallbacks.join(',');
}

async function bootstrapAgent(repoRoot: string) {
  await runCommand('genie', ['setup', '--quick'], { cwd: repoRoot });
  await runCommand('genie', ['init', 'agent', 'namastex-research'], { cwd: repoRoot });
  await runCommand('genie', ['dir', 'sync'], { cwd: repoRoot });
}

async function startServices(repoRoot: string) {
  await runCommand('omni', ['start'], { cwd: repoRoot });
  await runCommand('genie', ['serve', 'start', '--daemon'], { cwd: repoRoot });
  await runCommand('omni', ['status'], { cwd: repoRoot });
  await runCommand('genie', ['doctor'], { cwd: repoRoot });
}

async function createWhatsappInstance(repoRoot: string): Promise<string | undefined> {
  const shouldCreate = await confirm({
    message: 'Create and pair a WhatsApp instance now?',
    initialValue: true,
  });
  if (isCancel(shouldCreate)) process.exit(1);
  if (!shouldCreate) return undefined;

  const instanceName = await text({
    message: 'Omni instance name',
    initialValue: 'namastex-whatsapp',
  });
  if (isCancel(instanceName)) process.exit(1);

  const result = await runCommand(
    'omni',
    ['instances', 'create', '--name', String(instanceName), '--channel', 'whatsapp-baileys'],
    { cwd: repoRoot },
  );
  const instanceId = extractInstanceId(result.stdout + result.stderr);
  if (!instanceId) {
    note(
      'Could not parse the instance id automatically. Run `omni instances list` and then `omni instances qr <instance-id>`.',
      'Pairing',
    );
    return undefined;
  }

  await runCommand('omni', ['instances', 'qr', instanceId], { cwd: repoRoot });
  return instanceId;
}

async function connectInstance(repoRoot: string, instanceId?: string) {
  const resolved =
    instanceId ||
    (await text({
      message: 'Omni instance id to connect',
      placeholder: 'paste the instance id if it was not auto-detected',
    }));
  if (isCancel(resolved)) process.exit(1);
  if (!String(resolved).trim()) return;

  await runCommand(
    'omni',
    ['connect', String(resolved).trim(), 'namastex-research', '--reply-filter', 'filtered'],
    { cwd: repoRoot },
  );
}

async function main() {
  const repoRoot = process.cwd();
  const envPath = resolve(repoRoot, '.env');
  intro('Namastex setup');

  const detected = await detectTools(repoRoot);
  await bootstrapIfNeeded(repoRoot, detected);

  const mode = await select({
    message: 'Configuration mode',
    options: [
      { label: 'Automatic', value: 'auto' },
      { label: 'Manual', value: 'manual' },
    ],
  });
  if (isCancel(mode)) process.exit(1);

  if (mode === 'manual') {
    note(
      [
        'Use `npm run setup` again and choose Automatic when you want Codex to configure the repo.',
        'Manual docs are in README.md under "Manual setup (advanced)".',
      ].join('\n'),
      'Manual mode',
    );
    outro('Setup finished without modifying files.');
    return;
  }

  const state: InstallerState = {
    repoRoot,
    envPath,
    values: await readEnvFile(envPath),
  };

  await configureSecrets(state, detected);
  await chooseProviders(state, detected);
  await writeEnvFile(envPath, state.values);

  await bootstrapAgent(repoRoot);
  await startServices(repoRoot);
  const instanceId = await createWhatsappInstance(repoRoot);
  await connectInstance(repoRoot, instanceId);

  outro('Namastex setup complete.');
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
