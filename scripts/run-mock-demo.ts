import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRuntime } from '../src/runtime.js';
import { routeWhatsappCommand } from '../src/workflow.js';

async function ensureSeededStore(repoRoot: string): Promise<void> {
  const storePath = resolve(repoRoot, 'data', 'genie-research-store.json');
  try {
    await readFile(storePath, 'utf8');
  } catch {
    const seed = resolve(repoRoot, 'fixtures', 'mock', 'genie-store.seed.json');
    const targetDir = resolve(repoRoot, 'data');
    await mkdir(targetDir, { recursive: true });
    await writeFile(storePath, await readFile(seed, 'utf8'), 'utf8');
    process.stdout.write(`Seeded dossier mock store at ${storePath}\n`);
  }
}

async function main(): Promise<void> {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: process.env.NAMASTEX_MODE || 'mock',
  });
  await ensureSeededStore(runtime.config.repoRoot);

  const commands = [
    '/pesquisar agentes de whatsapp com arxiv hackernews grok',
    '/fontes agentes',
    '/wiki agentes',
    '/repo Bssn01/NamastexChallenge',
    '/reset',
  ];

  for (const command of commands) {
    const reply = await routeWhatsappCommand(command, runtime);
    process.stdout.write(`\n${command}\n`);
    for (const chunk of reply.chunks) {
      process.stdout.write(`${chunk}\n---\n`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
