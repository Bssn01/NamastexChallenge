export interface ParsedCommand {
  command: string;
  payload: string;
}

export const SUPPORTED_COMMANDS = [
  '/pesquisar',
  '/wiki',
  '/fontes',
  '/repo',
  '/bookmarks',
  '/reset',
] as const;

export type SupportedCommand = (typeof SUPPORTED_COMMANDS)[number];

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return {
    command: (match?.[1] || '').toLowerCase(),
    payload: match?.[2] || '',
  };
}

export function isSupportedCommand(command: string): command is SupportedCommand {
  return (SUPPORTED_COMMANDS as readonly string[]).includes(command);
}
