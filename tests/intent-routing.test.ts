import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIntent } from '../src/lib/intents.js';

test('resolveIntent extracts a research topic from natural language', () => {
  const intent = resolveIntent('pesquisa essa ideia de agentes de whatsapp');

  assert.equal(intent.kind, 'research');
  assert.equal(intent.payload, 'agentes de whatsapp');
  assert.equal(intent.source, 'natural-language');
});

test('resolveIntent detects github repo targets from urls', () => {
  const intent = resolveIntent('analisa https://github.com/openai/codex');

  assert.equal(intent.kind, 'repo');
  assert.equal(intent.payload, 'https://github.com/openai/codex');
});

test('resolveIntent detects wiki-to-repo comparison phrases', () => {
  const intent = resolveIntent('testa essa ideia no meu repo https://github.com/openai/codex');

  assert.equal(intent.kind, 'repo');
  assert.equal(intent.payload, 'https://github.com/openai/codex');
});

test('resolveIntent asks for clarification when repo target is missing', () => {
  const intent = resolveIntent('analisa esse repo');

  assert.equal(intent.kind, 'clarify');
  assert.match(intent.clarification || '', /GitHub URL/i);
});

test('resolveIntent preserves legacy slash commands', () => {
  const intent = resolveIntent('/wiki agentes');

  assert.equal(intent.kind, 'wiki');
  assert.equal(intent.payload, 'agentes');
  assert.equal(intent.source, 'legacy-command');
  assert.equal(intent.legacyCommand, '/wiki');
});

test('resolveIntent trims bookmark search queries', () => {
  const intent = resolveIntent('procura nos meus bookmarks sobre embeddings');

  assert.equal(intent.kind, 'bookmarks');
  assert.equal(intent.payload, 'embeddings');
});
