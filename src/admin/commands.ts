import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readEnvValues } from './env.js';

export type AdminMode = 'local' | 'docker';
export type AdminModeRequest = AdminMode | 'auto';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandExecutor {
  run(
    file: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<ExecResult>;
}

export interface PlannedCommand {
  label: string;
  file: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}

export interface CommandResult extends PlannedCommand {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: unknown;
}

export interface ToolStatus {
  installed: boolean;
  detail?: string;
}

export interface ProviderStatus {
  generatedAt: string;
  mode: AdminMode;
  tools: Record<'genie' | 'omni' | 'claude' | 'codex' | 'docker', ToolStatus>;
  apiProviders: {
    kimiConfigured: boolean;
    openrouterConfigured: boolean;
    moonshotConfigured: boolean;
    anthropicConfigured: boolean;
    xaiConfigured: boolean;
  };
}

export interface OperationsSnapshot {
  mode: AdminMode;
  dockerDetected: boolean;
  providerStatus: ProviderStatus;
  commands: Record<string, CommandResult>;
}

export type AdminActionId =
  | 'genie.serve.start'
  | 'genie.serve.stop'
  | 'genie.serve.restart'
  | 'omni.service.start'
  | 'omni.service.stop'
  | 'omni.service.restart'
  | 'genie.agent.stop'
  | 'genie.agent.resume'
  | 'genie.agent.kill'
  | 'omni.instance.restart'
  | 'omni.instance.disconnect'
  | 'omni.turn.close'
  | 'omni.turn.closeAll'
  | 'omni.instance.qr';

export class NodeCommandExecutor implements CommandExecutor {
  async run(
    file: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<ExecResult> {
    return new Promise((resolvePromise) => {
      const child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              child.kill('SIGTERM');
              resolvePromise({
                stdout,
                stderr: `${stderr}\nCommand timed out after ${options.timeoutMs}ms.`.trim(),
                exitCode: 124,
              });
            }, options.timeoutMs)
          : undefined;

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        if (timer) clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolvePromise({ stdout, stderr: error.message, exitCode: 127 });
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
      });
    });
  }
}

export function parseMaybeJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsedLines: unknown[] = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line));
      } catch {
        return trimmed;
      }
    }
    return parsedLines;
  }
}

export async function runPlannedCommand(
  executor: CommandExecutor,
  command: PlannedCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  const result = await executor.run(command.file, command.args, {
    cwd: command.cwd,
    env,
    timeoutMs: command.timeoutMs,
  });
  return {
    ...command,
    ok: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    parsed: parseMaybeJson(result.stdout),
  };
}

function dockerCompose(repoRoot: string, args: string[], label: string): PlannedCommand {
  return {
    label,
    file: 'docker',
    args: ['compose', ...args],
    cwd: repoRoot,
    timeoutMs: 20_000,
  };
}

function dockerExec(
  repoRoot: string,
  command: string,
  args: string[],
  label: string,
): PlannedCommand {
  return dockerCompose(repoRoot, ['exec', '-T', '-u', 'appuser', 'genie', command, ...args], label);
}

function localCommand(
  repoRoot: string,
  command: string,
  args: string[],
  label: string,
): PlannedCommand {
  return {
    label,
    file: command,
    args,
    cwd: repoRoot,
    timeoutMs: 20_000,
  };
}

export function toolCommand(
  repoRoot: string,
  mode: AdminMode,
  command: 'genie' | 'omni',
  args: string[],
  label: string,
): PlannedCommand {
  return mode === 'docker'
    ? dockerExec(repoRoot, command, args, label)
    : localCommand(repoRoot, command, args, label);
}

function serviceCommand(
  repoRoot: string,
  mode: AdminMode,
  service: 'genie' | 'omni',
  verb: 'start' | 'stop' | 'restart',
): PlannedCommand[] {
  if (mode === 'docker') {
    if (verb === 'start')
      return [dockerCompose(repoRoot, ['up', '-d', service], `${service} start`)];
    return [dockerCompose(repoRoot, [verb, service], `${service} ${verb}`)];
  }

  if (service === 'genie') {
    if (verb === 'start') {
      return [
        localCommand(
          repoRoot,
          'genie',
          ['serve', 'start', '--daemon', '--headless'],
          'genie serve start',
        ),
      ];
    }
    if (verb === 'stop') {
      return [localCommand(repoRoot, 'genie', ['serve', 'stop'], 'genie serve stop')];
    }
    return [
      localCommand(repoRoot, 'genie', ['serve', 'stop'], 'genie serve stop'),
      localCommand(
        repoRoot,
        'genie',
        ['serve', 'start', '--daemon', '--headless'],
        'genie serve start',
      ),
    ];
  }

  return [localCommand(repoRoot, 'omni', [verb], `omni ${verb}`)];
}

function payloadValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Action requires ${key}.`);
  }
  return value.trim();
}

export function buildAdminActionCommands(
  repoRoot: string,
  mode: AdminMode,
  action: AdminActionId,
  payload: Record<string, unknown> = {},
): PlannedCommand[] {
  switch (action) {
    case 'genie.serve.start':
      return serviceCommand(repoRoot, mode, 'genie', 'start');
    case 'genie.serve.stop':
      return serviceCommand(repoRoot, mode, 'genie', 'stop');
    case 'genie.serve.restart':
      return serviceCommand(repoRoot, mode, 'genie', 'restart');
    case 'omni.service.start':
      return serviceCommand(repoRoot, mode, 'omni', 'start');
    case 'omni.service.stop':
      return serviceCommand(repoRoot, mode, 'omni', 'stop');
    case 'omni.service.restart':
      return serviceCommand(repoRoot, mode, 'omni', 'restart');
    case 'genie.agent.stop':
      return [
        toolCommand(
          repoRoot,
          mode,
          'genie',
          ['agent', 'stop', payloadValue(payload, 'name')],
          action,
        ),
      ];
    case 'genie.agent.resume':
      return [
        toolCommand(
          repoRoot,
          mode,
          'genie',
          ['agent', 'resume', payloadValue(payload, 'name')],
          action,
        ),
      ];
    case 'genie.agent.kill':
      return [
        toolCommand(
          repoRoot,
          mode,
          'genie',
          ['agent', 'kill', payloadValue(payload, 'name')],
          action,
        ),
      ];
    case 'omni.instance.restart':
      return [
        toolCommand(
          repoRoot,
          mode,
          'omni',
          ['instances', 'restart', payloadValue(payload, 'id')],
          action,
        ),
      ];
    case 'omni.instance.disconnect':
      return [
        toolCommand(
          repoRoot,
          mode,
          'omni',
          ['instances', 'disconnect', payloadValue(payload, 'id')],
          action,
        ),
      ];
    case 'omni.turn.close':
      return [
        toolCommand(
          repoRoot,
          mode,
          'omni',
          ['turns', 'close', payloadValue(payload, 'id')],
          action,
        ),
      ];
    case 'omni.turn.closeAll':
      if (payload.confirm !== 'CLOSE ALL') {
        throw new Error('Closing all turns requires the exact confirmation text CLOSE ALL.');
      }
      return [toolCommand(repoRoot, mode, 'omni', ['turns', 'close-all', '--confirm'], action)];
    case 'omni.instance.qr':
      return [
        toolCommand(
          repoRoot,
          mode,
          'omni',
          ['instances', 'qr', payloadValue(payload, 'id')],
          action,
        ),
      ];
    default:
      throw new Error(`Unsupported action: ${String(action)}`);
  }
}

async function commandExists(
  repoRoot: string,
  executor: CommandExecutor,
  command: string,
): Promise<ToolStatus> {
  const result = await executor.run(process.platform === 'win32' ? 'where' : 'which', [command], {
    cwd: repoRoot,
    timeoutMs: 5_000,
  });
  return {
    installed: result.exitCode === 0,
    detail: result.stdout.trim() || result.stderr.trim() || undefined,
  };
}

async function dockerToolExists(
  repoRoot: string,
  executor: CommandExecutor,
  command: string,
): Promise<ToolStatus> {
  const result = await runPlannedCommand(
    executor,
    dockerExec(repoRoot, 'which', [command], `which ${command}`),
  );
  return {
    installed: result.ok,
    detail: result.stdout.trim() || result.stderr.trim() || undefined,
  };
}

async function readDockerProviderStatus(
  repoRoot: string,
  executor: CommandExecutor,
): Promise<Partial<ProviderStatus> | undefined> {
  const result = await runPlannedCommand(
    executor,
    dockerExec(repoRoot, 'cat', ['/workspace/app/data/provider-status.json'], 'provider status'),
  );
  if (!result.ok || typeof result.parsed !== 'object' || !result.parsed) return undefined;
  return result.parsed as Partial<ProviderStatus>;
}

async function dockerStackRunning(repoRoot: string, executor: CommandExecutor): Promise<boolean> {
  const result = await runPlannedCommand(
    executor,
    dockerCompose(repoRoot, ['ps', '--format', 'json'], 'docker compose ps'),
  );
  const parsed = Array.isArray(result.parsed) ? result.parsed : [];
  return parsed.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const service = String((entry as { Service?: unknown }).Service || '');
    const state = String((entry as { State?: unknown }).State || '');
    return ['genie', 'omni'].includes(service) && /running/i.test(state);
  });
}

export async function detectAdminMode(
  repoRoot: string,
  requested: AdminModeRequest,
  executor: CommandExecutor = new NodeCommandExecutor(),
): Promise<{ mode: AdminMode; dockerDetected: boolean }> {
  const dockerDetected = await dockerStackRunning(repoRoot, executor).catch(() => false);
  if (requested === 'local' || requested === 'docker') return { mode: requested, dockerDetected };
  return { mode: dockerDetected ? 'docker' : 'local', dockerDetected };
}

export async function collectProviderStatus(
  repoRoot: string,
  mode: AdminMode,
  executor: CommandExecutor = new NodeCommandExecutor(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderStatus> {
  const values = await readEnvValues(repoRoot, env);
  const apiProviders = {
    kimiConfigured: Boolean(values.OPENROUTER_API_KEY || values.MOONSHOT_API_KEY),
    openrouterConfigured: Boolean(values.OPENROUTER_API_KEY),
    moonshotConfigured: Boolean(values.MOONSHOT_API_KEY),
    anthropicConfigured: Boolean(values.ANTHROPIC_API_KEY),
    xaiConfigured: Boolean(values.XAI_API_KEY),
  };

  if (mode === 'docker') {
    const fromContainer = await readDockerProviderStatus(repoRoot, executor).catch(() => undefined);
    if (fromContainer?.tools) {
      return {
        generatedAt: String(fromContainer.generatedAt || new Date().toISOString()),
        mode,
        tools: {
          genie: fromContainer.tools.genie || { installed: false },
          omni: fromContainer.tools.omni || { installed: false },
          claude: fromContainer.tools.claude || { installed: false },
          codex: fromContainer.tools.codex || { installed: false },
          docker: await commandExists(repoRoot, executor, 'docker'),
        },
        apiProviders: {
          ...apiProviders,
          ...(fromContainer.apiProviders || {}),
        },
      };
    }
    const [genie, omni, claude, codex, docker] = await Promise.all([
      dockerToolExists(repoRoot, executor, 'genie'),
      dockerToolExists(repoRoot, executor, 'omni'),
      dockerToolExists(repoRoot, executor, 'claude'),
      dockerToolExists(repoRoot, executor, 'codex'),
      commandExists(repoRoot, executor, 'docker'),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      mode,
      tools: { genie, omni, claude, codex, docker },
      apiProviders,
    };
  }

  const [genie, omni, claude, codex, docker] = await Promise.all([
    commandExists(repoRoot, executor, 'genie'),
    commandExists(repoRoot, executor, 'omni'),
    commandExists(repoRoot, executor, 'claude'),
    commandExists(repoRoot, executor, 'codex'),
    commandExists(repoRoot, executor, 'docker'),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    mode,
    tools: { genie, omni, claude, codex, docker },
    apiProviders,
  };
}

export function buildReadCommands(
  repoRoot: string,
  mode: AdminMode,
): Record<string, PlannedCommand> {
  const commands: Record<string, PlannedCommand> = {
    genieServeStatus: toolCommand(
      repoRoot,
      mode,
      'genie',
      ['serve', 'status'],
      'Genie serve status',
    ),
    genieAgents: toolCommand(repoRoot, mode, 'genie', ['ls', '--json'], 'Genie agents'),
    genieSessions: toolCommand(
      repoRoot,
      mode,
      'genie',
      ['sessions', 'list', '--limit', '50', '--json'],
      'Genie sessions',
    ),
    genieMetrics: toolCommand(
      repoRoot,
      mode,
      'genie',
      ['metrics', 'now', '--json'],
      'Genie metrics',
    ),
    omniStatus: toolCommand(repoRoot, mode, 'omni', ['status'], 'Omni status'),
    omniInstances: toolCommand(
      repoRoot,
      mode,
      'omni',
      ['instances', 'list', '--json'],
      'Omni instances',
    ),
    omniProviders: toolCommand(
      repoRoot,
      mode,
      'omni',
      ['providers', 'list', '--json'],
      'Omni providers',
    ),
    omniChats: toolCommand(
      repoRoot,
      mode,
      'omni',
      ['chats', 'list', '--limit', '50', '--verbose', '--json'],
      'Omni chats',
    ),
    omniTurns: toolCommand(
      repoRoot,
      mode,
      'omni',
      ['turns', 'list', '--limit', '50', '--json'],
      'Omni turns',
    ),
    omniAccess: toolCommand(repoRoot, mode, 'omni', ['access', 'list', '--json'], 'Omni access'),
    omniEvents: toolCommand(
      repoRoot,
      mode,
      'omni',
      ['events', 'list', '--limit', '20', '--json'],
      'Omni events',
    ),
  };
  if (mode === 'docker') {
    commands.dockerPs = dockerCompose(repoRoot, ['ps', '--format', 'json'], 'Docker compose ps');
  }
  return commands;
}

export async function collectOperationsSnapshot(
  repoRoot: string,
  requested: AdminModeRequest,
  executor: CommandExecutor = new NodeCommandExecutor(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<OperationsSnapshot> {
  const { mode, dockerDetected } = await detectAdminMode(repoRoot, requested, executor);
  const providerStatus = await collectProviderStatus(repoRoot, mode, executor, env);
  const entries = await Promise.all(
    Object.entries(buildReadCommands(repoRoot, mode)).map(async ([key, command]) => [
      key,
      await runPlannedCommand(executor, command, env),
    ]),
  );
  return {
    mode,
    dockerDetected,
    providerStatus,
    commands: Object.fromEntries(entries),
  };
}

export async function readProviderStatusFile(
  repoRoot: string,
): Promise<ProviderStatus | undefined> {
  const path = resolve(repoRoot, 'data', 'provider-status.json');
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as ProviderStatus;
}
