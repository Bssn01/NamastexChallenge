import { execFile as execFileCallback } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  extractOmniText,
  resolveTurnExecutor,
  runAutoTurn,
  runClaudeTurn,
  runCodexTurn,
  runLocalTurn,
} from '../src/turn-execution.js';

const execFile = promisify(execFileCallback);

type Env = NodeJS.ProcessEnv;

export { extractOmniText } from '../src/turn-execution.js';

function shouldDeliverToOmni(env: Env): boolean {
  if (env.NAMASTEX_OMNI_DELIVERY === 'stdout') return false;
  if (env.NAMASTEX_OMNI_DELIVERY === 'omni') return true;
  return Boolean(env.OMNI_INSTANCE && env.OMNI_CHAT);
}

async function deliverChunk(chunk: string, env: Env): Promise<void> {
  await execFile('omni', ['say', chunk], { env });
}

async function markDone(env: Env): Promise<void> {
  await execFile('omni', ['done'], { env });
}

async function main(): Promise<void> {
  const command = extractOmniText(process.argv.slice(2), process.env) || '/wiki recente';
  const executor = resolveTurnExecutor(process.env);
  const reply =
    executor === 'auto'
      ? await runAutoTurn(command, process.env)
      : executor === 'claude'
        ? await runClaudeTurn(command, process.env)
        : executor === 'codex'
          ? await runCodexTurn(command, process.env)
          : await runLocalTurn(command, process.env);

  if (shouldDeliverToOmni(process.env)) {
    for (const chunk of reply.chunks) {
      await deliverChunk(chunk, process.env);
    }
    await markDone(process.env);
    return;
  }

  for (const chunk of reply.chunks) {
    process.stdout.write(`${chunk}\n\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    if (shouldDeliverToOmni(process.env)) {
      try {
        await deliverChunk(
          `Falhei ao processar este turno: ${error instanceof Error ? error.message : String(error)}`,
          process.env,
        );
        await markDone(process.env);
      } catch {
        // If Omni itself is down, stdout/stderr is the only remaining signal.
      }
    }
    process.exitCode = 1;
  });
}
