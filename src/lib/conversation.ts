import { createHash, randomUUID } from 'node:crypto';
import { normalizeWhitespace } from './text.js';

export interface ConversationIdentity {
  conversationKey: string;
  sessionId: string;
  source: 'omni' | 'explicit' | 'local';
  instanceId?: string;
  chatId?: string;
}

function stableKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function cleanPart(value: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(value || '');
  return normalized || undefined;
}

export function resolveConversationIdentity(
  env: NodeJS.ProcessEnv = process.env,
): ConversationIdentity {
  const instanceId = cleanPart(env.OMNI_INSTANCE);
  const chatId = cleanPart(env.OMNI_CHAT);

  if (instanceId && chatId) {
    const conversationKey = `omni:${stableKey(`${instanceId}:${chatId}`)}`;
    return {
      conversationKey,
      sessionId: env.NAMASTEX_SESSION_ID || conversationKey,
      source: 'omni',
      instanceId,
      chatId,
    };
  }

  const explicit = cleanPart(env.NAMASTEX_CONVERSATION_ID);
  if (explicit) {
    const conversationKey = `local:${stableKey(explicit)}`;
    return {
      conversationKey,
      sessionId: env.NAMASTEX_SESSION_ID || conversationKey,
      source: 'explicit',
    };
  }

  return {
    conversationKey: 'local:demo',
    sessionId: env.NAMASTEX_SESSION_ID || 'local-demo',
    source: 'local',
  };
}

export function newSessionId(conversationKey: string): string {
  return `${conversationKey}:session:${randomUUID()}`;
}
