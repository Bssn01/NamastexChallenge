import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeJsonFile } from '../src/lib/json.js';

async function main(): Promise<void> {
  const root = process.cwd();
  const dataDir = resolve(root, 'data');
  const storePath = resolve(dataDir, 'genie-research-store.json');
  const outboxPath = resolve(dataDir, 'genie-outbox.jsonl');
  const seedFixture = resolve(root, 'fixtures', 'mock', 'genie-store.seed.json');
  const seed = JSON.parse(await readFile(seedFixture, 'utf8')) as unknown;
  await mkdir(dataDir, { recursive: true });
  await writeJsonFile(storePath, seed);
  await writeFile(outboxPath, '', 'utf8');
  process.stdout.write(`Seeded mock dossier store at ${storePath}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
