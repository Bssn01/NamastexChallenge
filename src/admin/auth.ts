import type { AdminMode } from './commands.js';

export type ProviderAuthTarget = 'claude' | 'codex' | 'kimi';

export interface AuthCommand {
  file: string;
  args: string[];
}

export interface TerminalLaunchCommand {
  file: string;
  args: string[];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function windowsQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function appleScriptQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildProviderAuthCommand(
  provider: ProviderAuthTarget,
  mode: AdminMode,
): AuthCommand | undefined {
  if (provider === 'kimi') return undefined;
  if (mode === 'docker') {
    return {
      file: 'docker',
      args: [
        'compose',
        'exec',
        '-it',
        '-u',
        'appuser',
        'genie',
        provider === 'claude' ? 'claude' : 'codex',
        ...(provider === 'codex' ? ['login'] : []),
      ],
    };
  }
  return provider === 'claude' ? { file: 'claude', args: [] } : { file: 'codex', args: ['login'] };
}

export function authCommandToShell(
  command: AuthCommand,
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    return [
      `cd /d ${windowsQuote(repoRoot)}`,
      [windowsQuote(command.file), ...command.args.map(windowsQuote)].join(' '),
    ].join(' && ');
  }
  return [
    `cd ${shellQuote(repoRoot)}`,
    [shellQuote(command.file), ...command.args.map(shellQuote)].join(' '),
  ].join(' && ');
}

export function buildTerminalLaunchCommand(
  platform: NodeJS.Platform,
  shellCommand: string,
  env: NodeJS.ProcessEnv = process.env,
): TerminalLaunchCommand | undefined {
  if (platform === 'darwin') {
    return {
      file: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to do script "${appleScriptQuote(shellCommand)}"`,
        '-e',
        'tell application "Terminal" to activate',
      ],
    };
  }

  if (platform === 'win32') {
    return {
      file: 'cmd',
      args: ['/c', 'start', 'Namastex auth', 'cmd', '/k', shellCommand],
    };
  }

  const terminal = env.TERMINAL || 'x-terminal-emulator';
  return {
    file: terminal,
    args: ['-e', 'sh', '-lc', shellCommand],
  };
}
