#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import type { AdminModeRequest } from './commands.js';
import { startAdminServer } from './server.js';

export interface AdminCliArgs {
  host: string;
  port: number;
  open: boolean;
  mode: AdminModeRequest;
  allowRemote: boolean;
}

export function parseAdminCliArgs(argv: string[]): AdminCliArgs {
  const args: AdminCliArgs = {
    host: '127.0.0.1',
    port: 0,
    open: true,
    mode: 'auto',
    allowRemote: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index] || '';
    };

    if (arg === '--no-open') {
      args.open = false;
    } else if (arg === '--allow-remote') {
      args.allowRemote = true;
    } else if (arg === '--host') {
      args.host = next() || args.host;
    } else if (arg.startsWith('--host=')) {
      args.host = arg.slice('--host='.length) || args.host;
    } else if (arg === '--port') {
      args.port = Number(next() || '0');
    } else if (arg.startsWith('--port=')) {
      args.port = Number(arg.slice('--port='.length) || '0');
    } else if (arg === '--mode') {
      const mode = next();
      if (mode === 'local' || mode === 'docker' || mode === 'auto') args.mode = mode;
    } else if (arg.startsWith('--mode=')) {
      const mode = arg.slice('--mode='.length);
      if (mode === 'local' || mode === 'docker' || mode === 'auto') args.mode = mode;
    }
  }

  if (!Number.isFinite(args.port) || args.port < 0 || args.port > 65535) {
    throw new Error('Port must be between 0 and 65535.');
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseAdminCliArgs(process.argv.slice(2));
  const server = await startAdminServer({
    repoRoot: process.cwd(),
    host: args.host,
    port: args.port,
    mode: args.mode,
    open: args.open,
    allowRemote: args.allowRemote,
  });

  process.stdout.write(`Namastex admin panel: ${server.url}\n`);
  process.stdout.write('Keep this terminal open while you use the panel.\n');

  const close = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    close().catch(() => process.exit(1));
  });
  process.on('SIGTERM', () => {
    close().catch(() => process.exit(1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
