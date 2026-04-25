import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
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
import { DOCKER_COMPOSE_VERSION_CHECK } from '../admin/docker-compose.js';

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
  docker: boolean;
  dockerCompose: boolean;
}

interface OmniInstance {
  id?: string;
  name?: string;
  channel?: string;
  status?: string;
  agentId?: string | null;
  isActive?: boolean;
}

async function ensureAccessible(command: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    child.on('close', (code) => resolvePromise(code === 0));
    child.on('error', () => resolvePromise(false));
  });
}

async function ensureDockerComposeAccessible(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn('sh', ['-lc', DOCKER_COMPOSE_VERSION_CHECK], { stdio: 'ignore' });
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function markerBlock(command: string): string {
  return [
    '# BEGIN NAMASTEX UPDATE NEWS',
    `*/5 * * * * ${command}`,
    '# END NAMASTEX UPDATE NEWS',
  ].join('\n');
}

async function readCrontab(): Promise<string> {
  return new Promise((resolvePromise) => {
    const child = spawn('crontab', ['-l'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('close', (code) => {
      resolvePromise(code === 0 ? stdout : '');
    });
    child.on('error', () => resolvePromise(''));
  });
}

async function writeCrontab(contents: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('crontab', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(stderr.trim() || `crontab failed with exit code ${code}.`));
    });
    child.stdin.end(contents);
  });
}

async function installUpdateNewsScheduler(repoRoot: string): Promise<void> {
  const shouldInstall = await confirm({
    message:
      'Install local update news scheduler? It will check due WhatsApp updates every 5 minutes.',
    initialValue: true,
  });
  if (isCancel(shouldInstall)) process.exit(1);
  if (!shouldInstall) {
    note('You can install it later by running `npm run setup` again.', 'Update news');
    return;
  }

  const command = [
    `cd ${shellQuote(repoRoot)}`,
    'mkdir -p data',
    '/usr/bin/env npm run update-news:due >> data/update-news-scheduler.log 2>&1',
  ].join(' && ');
  const block = markerBlock(command);
  const current = await readCrontab();
  const withoutOldBlock = current
    .replace(/# BEGIN NAMASTEX UPDATE NEWS[\s\S]*?# END NAMASTEX UPDATE NEWS\n?/g, '')
    .trimEnd();
  const next = `${withoutOldBlock ? `${withoutOldBlock}\n\n` : ''}${block}\n`;
  await writeCrontab(next);
  note(
    [
      'Installed crontab entry:',
      '',
      block,
      '',
      'Logs will go to data/update-news-scheduler.log.',
    ].join('\n'),
    'Update news scheduler',
  );
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mergeProcessEnvFallbacks(values: Record<string, string>): Record<string, string> {
  const merged = { ...values };
  for (const key of [
    'GITHUB_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY',
    'XAI_API_KEY',
    'MOONSHOT_API_KEY',
  ]) {
    if (!merged[key] && process.env[key]) {
      merged[key] = String(process.env[key]);
    }
  }
  return merged;
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
  if (required && !existing) {
    const secret = await password({
      message: `Enter ${label}`,
      validate(value) {
        if (!value.trim()) return `${label} is required.`;
        return undefined;
      },
    });
    if (isCancel(secret)) process.exit(1);
    state.values[key] = secret;
    return;
  }

  const shouldUse = await select({
    message: `${label}?`,
    options: [
      { label: 'Keep current value', value: 'keep' },
      { label: existing ? 'Replace' : 'Enter value', value: 'replace' },
      ...(!required ? [{ label: 'Skip', value: 'skip' }] : []),
    ],
  });
  if (isCancel(shouldUse)) process.exit(1);

  if (shouldUse === 'skip') return;

  if (shouldUse === 'keep') {
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

function parseJsonArray<T>(contents: string): T[] {
  try {
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function pickReusableWhatsappInstance(
  instances: OmniInstance[],
  preferredName: string,
): OmniInstance | undefined {
  return (
    instances.find((instance) => instance.name === preferredName && instance.agentId) ||
    instances.find((instance) => instance.name === preferredName) ||
    instances.find((instance) => instance.channel === 'whatsapp-baileys' && instance.agentId) ||
    instances.find((instance) => instance.channel === 'whatsapp-baileys')
  );
}

async function listOmniInstances(repoRoot: string): Promise<OmniInstance[]> {
  try {
    const result = await runCommand('omni', ['instances', 'list', '--json'], {
      cwd: repoRoot,
      quiet: true,
    });
    return parseJsonArray<OmniInstance>(result.stdout);
  } catch {
    return [];
  }
}

async function hasOmniConnection(repoRoot: string, instanceId: string): Promise<boolean> {
  const instance = (await listOmniInstances(repoRoot)).find(
    (candidate) => candidate.id === instanceId,
  );
  if (instance?.agentId) return true;

  try {
    const result = await runCommand('omni', ['providers', 'list', '--json'], {
      cwd: repoRoot,
      quiet: true,
    });
    const providers = parseJsonArray<Record<string, unknown>>(result.stdout);
    return providers.some((provider) => {
      const serialized = JSON.stringify(provider);
      return serialized.includes('namastex-research') && serialized.includes(instanceId);
    });
  } catch {
    return false;
  }
}

async function isOmniHealthy(repoRoot: string): Promise<boolean> {
  try {
    const result = await runCommand('omni', ['status'], { cwd: repoRoot, quiet: true });
    return /apiStatus\s+healthy|Version: .*✓|healthy/i.test(result.stdout + result.stderr);
  } catch {
    return false;
  }
}

async function detectTools(repoRoot: string): Promise<DetectedTools> {
  const s = spinner();
  s.start('Checking local CLI availability');
  const [omni, genie, claude, codex, docker, dockerCompose] = await Promise.all([
    ensureAccessible('omni'),
    ensureAccessible('genie'),
    ensureAccessible('claude'),
    ensureAccessible('codex'),
    ensureAccessible('docker'),
    ensureDockerComposeAccessible(),
  ]);
  s.stop(
    [
      `Omni ${omni ? 'found' : 'missing'}`,
      `Genie ${genie ? 'found' : 'missing'}`,
      `Claude CLI ${claude ? 'found' : 'missing'}`,
      `Codex CLI ${codex ? 'found' : 'missing'}`,
      `Docker ${docker ? 'found' : 'missing'}`,
      `Docker Compose ${dockerCompose ? 'found' : 'missing'}`,
    ].join(', '),
  );
  return { omni, genie, claude, codex, docker, dockerCompose };
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
      : [
          detected.claude ? 'claude-cli' : undefined,
          detected.codex ? 'codex-cli' : undefined,
        ].filter((value): value is string => Boolean(value));

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

async function detectSetupRuntime(
  repoRoot: string,
  detected: DetectedTools,
): Promise<'local' | 'docker'> {
  if (!detected.docker || !detected.dockerCompose) return 'local';
  try {
    const result = await runCommand('docker', ['compose', 'ps', '--format', 'json'], {
      cwd: repoRoot,
      quiet: true,
    });
    if (/"Service"\s*:\s*"(genie|omni)"[\s\S]*"State"\s*:\s*"running"/i.test(result.stdout)) {
      return 'docker';
    }
  } catch {
    return 'local';
  }
  return 'local';
}

async function offerProviderAuthLaunch(
  repoRoot: string,
  state: InstallerState,
  detected: DetectedTools,
): Promise<void> {
  const providers = [
    state.values.NAMASTEX_LLM_PRIMARY,
    ...(state.values.NAMASTEX_LLM_FALLBACKS || '').split(','),
  ]
    .map((provider) => provider.trim())
    .filter(Boolean);
  const mode = await detectSetupRuntime(repoRoot, detected);

  const needsClaude =
    providers.includes('claude-cli') &&
    ((mode === 'local' && !detected.claude) ||
      (mode === 'docker' &&
        !state.values.CLAUDE_CODE_OAUTH_TOKEN &&
        !state.values.ANTHROPIC_API_KEY));
  if (needsClaude) {
    const shouldLaunch = await confirm({
      message: `Launch Claude login terminal for ${mode} runtime?`,
      initialValue: true,
    });
    if (isCancel(shouldLaunch)) process.exit(1);
    if (shouldLaunch) {
      await runCommand('npm', ['run', 'auth:claude', '--', '--mode', mode], { cwd: repoRoot });
    }
  }

  const needsCodex = providers.includes('codex-cli') && (mode === 'docker' || !detected.codex);
  if (needsCodex) {
    const shouldLaunch = await confirm({
      message: `Launch Codex login terminal for ${mode} runtime?`,
      initialValue: true,
    });
    if (isCancel(shouldLaunch)) process.exit(1);
    if (shouldLaunch) {
      await runCommand('npm', ['run', 'auth:codex', '--', '--mode', mode], { cwd: repoRoot });
    }
  }

  const needsKimi =
    providers.some((provider) => provider.includes('kimi')) &&
    !state.values.OPENROUTER_API_KEY &&
    !state.values.MOONSHOT_API_KEY;
  if (needsKimi) {
    const shouldConfigure = await confirm({
      message: 'Kimi is selected but no OpenRouter/Moonshot key is configured. Configure it now?',
      initialValue: true,
    });
    if (isCancel(shouldConfigure)) process.exit(1);
    if (shouldConfigure) {
      await runCommand('npm', ['run', 'auth:kimi'], { cwd: repoRoot });
    }
  }
}

async function bootstrapAgent(repoRoot: string) {
  await runCommand('genie', ['setup', '--quick'], { cwd: repoRoot });
  await configureGenieOmniExecutor();
  const agentDir = resolve(repoRoot, 'agents', 'namastex-research');
  if (await pathExists(agentDir)) {
    note(`Using existing agent directory: ${agentDir}`, 'Agent');
  } else {
    await runCommand('genie', ['init', 'agent', 'namastex-research'], { cwd: repoRoot });
  }
  await runCommand('genie', ['dir', 'sync'], { cwd: repoRoot });
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const contents = await readFile(path, 'utf8');
    const parsed = JSON.parse(contents);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function configureGenieOmniExecutor(): Promise<void> {
  const genieConfigPath = resolve(homedir(), '.genie', 'config.json');
  const omniConfigPath = resolve(homedir(), '.omni', 'config.json');
  const [genieConfig, omniConfig] = await Promise.all([
    readJsonFile(genieConfigPath),
    readJsonFile(omniConfigPath),
  ]);
  const currentOmni =
    genieConfig.omni && typeof genieConfig.omni === 'object' && !Array.isArray(genieConfig.omni)
      ? (genieConfig.omni as Record<string, unknown>)
      : {};
  const apiUrl =
    typeof currentOmni.apiUrl === 'string'
      ? currentOmni.apiUrl
      : typeof omniConfig.apiUrl === 'string'
        ? omniConfig.apiUrl
        : 'http://localhost:8882';
  const nextOmni: Record<string, unknown> = {
    ...currentOmni,
    apiUrl,
    executor: 'sdk',
  };
  if (!nextOmni.apiKey && typeof omniConfig.apiKey === 'string') {
    nextOmni.apiKey = omniConfig.apiKey;
  }
  const nextConfig = {
    ...genieConfig,
    omni: nextOmni,
  };
  await writeFile(genieConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
  note(
    'Configured Genie Omni bridge to use SDK executor so restarts do not block on Claude tmux permission prompts.',
    'Genie',
  );
}

async function startServices(repoRoot: string) {
  if (await isOmniHealthy(repoRoot)) {
    note('Omni is already running and healthy.', 'Omni');
  } else {
    try {
      await runCommand('omni', ['start'], { cwd: repoRoot });
    } catch (error) {
      if (!(await isOmniHealthy(repoRoot))) {
        throw error;
      }
      note('Omni was already running; continuing with the healthy service.', 'Omni');
    }
  }
  await runCommand('genie', ['serve', 'start', '--daemon', '--headless'], { cwd: repoRoot });
  await runCommand('omni', ['status'], { cwd: repoRoot });
  await runCommand('genie', ['serve', 'status'], { cwd: repoRoot });
  await runCommand('genie', ['doctor'], { cwd: repoRoot });
}

async function createWhatsappInstance(
  repoRoot: string,
  state: InstallerState,
): Promise<string | undefined> {
  const shouldCreate = await confirm({
    message: 'Create or reuse and pair a WhatsApp instance now?',
    initialValue: true,
  });
  if (isCancel(shouldCreate)) process.exit(1);
  if (!shouldCreate) return undefined;

  const defaultInstanceName = state.values.OMNI_DEFAULT_INSTANCE_NAME || 'namastex-wa';
  const instanceName = await text({
    message: 'Omni instance name',
    initialValue: defaultInstanceName,
  });
  if (isCancel(instanceName)) process.exit(1);
  const resolvedName = String(instanceName).trim() || defaultInstanceName;

  const existing = pickReusableWhatsappInstance(await listOmniInstances(repoRoot), resolvedName);
  if (existing?.id) {
    note(
      `Using existing WhatsApp instance: ${existing.name || resolvedName} (${existing.id})`,
      'Omni',
    );
    const shouldShowQr = await confirm({
      message: 'Show pairing QR for this instance?',
      initialValue: !existing.agentId,
    });
    if (isCancel(shouldShowQr)) process.exit(1);
    if (shouldShowQr) {
      await runCommand('omni', ['instances', 'qr', existing.id], { cwd: repoRoot });
    }
    return existing.id;
  }

  const result = await runCommand(
    'omni',
    ['instances', 'create', '--name', resolvedName, '--channel', 'whatsapp-baileys'],
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

async function connectInstance(repoRoot: string, inputInstanceId?: string) {
  const resolved =
    inputInstanceId ||
    (await text({
      message: 'Omni instance id to connect',
      placeholder: 'paste the instance id if it was not auto-detected',
    }));
  if (isCancel(resolved)) process.exit(1);
  if (!String(resolved).trim()) return;
  const resolvedInstanceId = String(resolved).trim();

  if (await hasOmniConnection(repoRoot, resolvedInstanceId)) {
    note(`Omni instance is already connected to namastex-research: ${resolvedInstanceId}`, 'Omni');
    return;
  }

  try {
    await runCommand(
      'omni',
      ['connect', resolvedInstanceId, 'namastex-research', '--reply-filter', 'filtered'],
      { cwd: repoRoot },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already|exists|duplicate/i.test(message)) {
      note(`Omni connection already exists for instance: ${resolvedInstanceId}`, 'Omni');
      return;
    }
    throw error;
  }
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
    values: mergeProcessEnvFallbacks(await readEnvFile(envPath)),
  };

  await configureSecrets(state, detected);
  await chooseProviders(state, detected);
  await writeEnvFile(envPath, state.values);
  await offerProviderAuthLaunch(repoRoot, state, detected);

  await bootstrapAgent(repoRoot);
  await startServices(repoRoot);
  const instanceId = await createWhatsappInstance(repoRoot, state);
  await connectInstance(repoRoot, instanceId);
  await installUpdateNewsScheduler(repoRoot);

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
