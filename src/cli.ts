import { createRuntime } from './runtime.js';
import { routeWhatsappMessage } from './workflow.js';

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(' ').trim();
  const message = input || 'pesquisa essa ideia de um agente de WhatsApp com swarm';
  const runtime = createRuntime(process.env);
  const reply = await routeWhatsappMessage(message, runtime);
  for (const chunk of reply.chunks) {
    process.stdout.write(`${chunk}\n\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
