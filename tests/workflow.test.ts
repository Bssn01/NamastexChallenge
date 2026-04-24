import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntime } from '../src/runtime.js';
import type { AppServices } from '../src/workflow.js';
import { routeWhatsappCommand } from '../src/workflow.js';

test('research workflow stores a dossier with grouped evidence', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'test-session',
    NAMASTEX_STORE_PATH: 'data/test-genie-research-store.json',
    NAMASTEX_OUTBOX_PATH: 'data/test-genie-outbox.jsonl',
  });

  await runtime.store.clearAll();
  const reply = await routeWhatsappCommand(
    [
      '/pesquisar',
      'IDEIA: Quero um agente de pesquisa para WhatsApp',
      'TOPICO PRINCIPAL: agentes de whatsapp',
      'GRUPOS NICHO:',
      '- Mercado: automação, atendimento',
      '- Stack: omni, genie, claude',
    ].join('\n'),
    runtime,
  );
  const joined = reply.chunks.join('\n');

  assert.match(joined, /Já salvei isso como dossiê:/);
  assert.match(joined, /Hacker News:/);
  assert.match(joined, /X\/Tweets:/);
  assert.match(joined, /arXiv:/);

  const snapshot = await runtime.store.snapshot();
  assert.equal(snapshot.dossiers.length, 1);
  assert.equal(snapshot.dossiers[0]?.rawIdeaText.includes('Quero um agente de pesquisa'), true);
  assert.equal(snapshot.dossiers[0]?.topicGroups.length, 3);
  assert.equal(snapshot.dossiers[0]?.researchRuns.length, 1);
  assert.equal(snapshot.records.length, 1);
});

test('reset workflow preserves the persistent dossiers', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'test-session-reset',
    NAMASTEX_STORE_PATH: 'data/test-genie-research-store-reset.json',
    NAMASTEX_OUTBOX_PATH: 'data/test-genie-outbox-reset.jsonl',
  });

  await runtime.store.clearAll();
  await routeWhatsappCommand('/pesquisar agentes de whatsapp', runtime);
  const beforeResetCount = (await runtime.store.snapshot()).dossiers.length;
  await routeWhatsappCommand('/reset', runtime);
  await routeWhatsappCommand('/pesquisar memoria apos reset', runtime);
  const afterReset = await runtime.store.snapshot();

  assert.equal(beforeResetCount, 1);
  assert.equal(afterReset.dossiers.length, 2);
  assert.notEqual(afterReset.dossiers[0]?.sessionId, afterReset.dossiers[1]?.sessionId);
});

test('repo workflow uses the materialized repo path for repomix', async () => {
  const runtime = createRuntime({
    ...process.env,
    NAMASTEX_MODE: 'mock',
    NAMASTEX_SESSION_ID: 'test-session-repo',
    NAMASTEX_STORE_PATH: 'data/test-genie-research-store-repo.json',
    NAMASTEX_OUTBOX_PATH: 'data/test-genie-outbox-repo.jsonl',
  });
  await runtime.store.clearAll();
  const dossier = await runtime.store.createDossier({
    rawIdeaText: 'avaliar uma ideia contra um repositório',
    mainTopic: 'repo fit',
  });

  let repomixPath: string | undefined;
  const services: AppServices = {
    ...runtime,
    store: runtime.store,
    github: {
      ...runtime.github,
      async materializeRepository(target?: string) {
        assert.equal(target, 'owner/repo');
        return {
          owner: 'owner',
          repo: 'repo',
          canonicalSlug: 'owner/repo',
          sourceUrl: 'https://github.com/owner/repo',
          localPath: '/tmp/materialized-repo',
          cacheRoot: '/tmp',
          normalizedFrom: 'slug',
          notes: ['materialized'],
        };
      },
      async validateRepository() {
        return {
          provider: 'github' as const,
          accessible: true,
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
          readme: 'README',
          issues: [],
          codeSearchable: true,
          canonicalSlug: 'owner/repo',
          sourceUrl: 'https://github.com/owner/repo',
          localPath: '/tmp/materialized-repo',
          notes: ['validated'],
        };
      },
    },
    repomix: {
      async validateRepository(targetPath?: string) {
        repomixPath = targetPath;
        return {
          provider: 'repomix' as const,
          accessible: true,
          path: targetPath || '',
          summary: 'pack ok',
          pack: 'Repository pack snapshot:\n- src/index.ts',
          sources: [],
          generatedFrom: 'repomix' as const,
          notes: ['ok'],
        };
      },
    },
  };

  const reply = await routeWhatsappCommand(`/repo owner/repo idea:${dossier.id}`, services);
  assert.match(reply.chunks.join('\n'), /Fit score:/);
  assert.equal(repomixPath, '/tmp/materialized-repo');
});
