import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveConversationIdentity } from '../src/lib/conversation.js';
import { createGenieResearchStore } from '../src/store/genie-research-store.js';

test('conversation identity uses Omni instance and chat as stable isolation key', () => {
  const first = resolveConversationIdentity({
    OMNI_INSTANCE: 'instance-1',
    OMNI_CHAT: '5511999999999@s.whatsapp.net',
  });
  const second = resolveConversationIdentity({
    OMNI_INSTANCE: 'instance-1',
    OMNI_CHAT: '5511999999999@s.whatsapp.net',
  });
  const third = resolveConversationIdentity({
    OMNI_INSTANCE: 'instance-1',
    OMNI_CHAT: '5511888888888@s.whatsapp.net',
  });

  assert.equal(first.source, 'omni');
  assert.equal(first.conversationKey, second.conversationKey);
  assert.notEqual(first.conversationKey, third.conversationKey);
  assert.equal(first.sessionId, first.conversationKey);
});

test('conversation identity supports explicit local conversations', () => {
  const identity = resolveConversationIdentity({
    NAMASTEX_CONVERSATION_ID: 'avaliador-local',
  });

  assert.equal(identity.source, 'explicit');
  assert.match(identity.conversationKey, /^local:/);
});

test('json research store isolates dossiers by conversation key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'namastex-store-'));
  const storePath = join(dir, 'store.json');
  const outboxPath = join(dir, 'outbox.jsonl');

  const alice = createGenieResearchStore({
    storePath,
    outboxPath,
    sessionId: 'alice-session',
    conversationKey: 'omni:alice',
  });
  const bob = createGenieResearchStore({
    storePath,
    outboxPath,
    sessionId: 'bob-session',
    conversationKey: 'omni:bob',
  });

  try {
    const aliceDossier = await alice.createDossier({
      rawIdeaText: 'Agente de WhatsApp para pesquisa',
      mainTopic: 'Pesquisa',
    });
    const bobDossier = await bob.createDossier({
      rawIdeaText: 'Agente de suporte interno',
      mainTopic: 'Suporte',
    });

    assert.deepEqual(
      (await alice.listRecentDossiers()).map((dossier) => dossier.id),
      [aliceDossier.id],
    );
    assert.deepEqual(
      (await bob.listRecentDossiers()).map((dossier) => dossier.id),
      [bobDossier.id],
    );
    assert.equal(await alice.getDossier(bobDossier.id), undefined);
    assert.equal(await bob.getDossier(aliceDossier.id), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
