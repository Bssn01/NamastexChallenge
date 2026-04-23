import { createRuntime } from './runtime.js';
import { routeWhatsappCommand } from './workflow.js';

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(' ').trim();
  const command = input || '/pesquisar agente de whatsapp com swarm';
  const runtime = createRuntime(process.env);
  const reply = await routeWhatsappCommand(command, runtime);
  for (const chunk of reply.chunks) {
    process.stdout.write(`${chunk}\n\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
