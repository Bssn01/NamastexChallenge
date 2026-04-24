import { pathToFileURL } from 'node:url';
import { runLocalTurn } from '../src/turn-execution.js';

function parseArgs(argv: string[]): { asJson: boolean; command: string } {
  const asJson = argv[0] === '--json';
  const commandArgs = asJson ? argv.slice(1) : argv;
  return {
    asJson,
    command: commandArgs.join(' ').trim(),
  };
}

async function main(): Promise<void> {
  const { asJson, command } = parseArgs(process.argv.slice(2));
  const reply = await runLocalTurn(
    command || 'o que temos salvo sobre o tema mais recente?',
    process.env,
  );

  if (asJson) {
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
    return;
  }

  for (const chunk of reply.chunks) {
    process.stdout.write(`${chunk}\n\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
