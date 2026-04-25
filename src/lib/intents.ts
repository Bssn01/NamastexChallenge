import { normalizeWhitespace } from './text.js';

export type WhatsappIntent =
  | 'greeting'
  | 'capabilities'
  | 'github-repos'
  | 'saved-topics'
  | 'monitor'
  | 'research'
  | 'wiki'
  | 'sources'
  | 'repo'
  | 'bookmarks'
  | 'reset'
  | 'clarify';

export interface ResolvedIntent {
  kind: WhatsappIntent;
  payload: string;
  source: 'legacy-command' | 'natural-language';
  legacyCommand?: string;
  clarification?: string;
}

export interface ResolveIntentOptions {
  defaultRepoSlug?: string;
}

const LEGACY_COMMANDS: Record<string, Exclude<WhatsappIntent, 'clarify'>> = {
  '/pesquisar': 'research',
  '/wiki': 'wiki',
  '/fontes': 'sources',
  '/repo': 'repo',
  '/bookmarks': 'bookmarks',
  '/reset': 'reset',
};

const RESET_PATTERNS = [
  /^(?:reseta(?:r)?|reinicia(?:r)?|reset(?:a|ar)?|come[aç]a de novo|start over)\b/i,
];

const REPO_TARGET_PATTERNS = [
  /https?:\/\/(?:www\.)?github\.com\/[^\s/?#]+\/[^\s/?#]+(?:\.git)?(?:[/?#][^\s]*)?/i,
  /\bgithub\.com\/[^\s/?#]+\/[^\s/?#]+(?:\.git)?\b/i,
  /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\.git)?\b/,
];

const REPO_HINT_PATTERNS = [
  /\b(repo|repositorio|reposit[oó]rio|github|codebase|c[oó]digo)\b/i,
  /\b(analis[ae]|avalia|valida|revisa|inspeciona)\s+(?:esse|este|o)?\s*(repo|reposit[oó]rio|github)\b/i,
  /\b(testa|aplica|compar[ae]|faz sentido)\b.*\b(repo|reposit[oó]rio|github|projeto)\b/i,
  /\b(wiki|dossi[eê])\b.*\b(repo|reposit[oó]rio|github|projeto)\b/i,
];

const BOOKMARK_PATTERNS = [
  /\b(bookmarks?|marcadores?|favoritos?|salvos?|field theory)\b/i,
  /\bprocura(?:r)?\s+(?:nos meus\s+)?bookmarks?\b/i,
];

const CAPABILITIES_PATTERNS = [
  /\b(o que voce pode fazer|o que você pode fazer|como voce pode ajudar|como você pode ajudar|quais comandos|ajuda|help)\b/i,
  /\b(?:me explica|explica).*\b(?:funciona|capacidades|op[cç][oõ]es)\b/i,
];

const SAVED_TOPICS_PATTERNS = [
  /\b(?:quais|lista|mostra|ver)\b.*\b(?:topicos|t[oó]picos|nichos|temas)\b.*\b(?:salvos?|guardados?|gravados?)\b/i,
  /\b(?:topicos|t[oó]picos|nichos|temas)\b.*\b(?:salvos?|guardados?|gravados?)\b/i,
  /\bo que (?:eu )?(?:tenho|temos) salvo\b/i,
];

const MONITOR_PATTERNS = [
  /\b(?:todo dia|diariamente|daily|semanalmente|weekly|toda semana)\b/i,
  /\b(?:me manda|me envie|manda|envia|monitora|acompanha|notifica|atualiza)\b.*\b(?:noticias|novidades|posts|tweets|hacker ?news|arxiv|fontes|top)\b/i,
];

const BOOKMARK_QUERY_PATTERNS = [
  /^(?:procura(?:r)?\s+(?:nos meus\s+)?)bookmarks?(?:\s+(?:sobre|de|do|da|em|para))?\s+(.+)$/i,
  /^(?:procura(?:r)?\s+(?:nos meus\s+)?(?:bookmarks?|marcadores?|favoritos?))\s+(.+)$/i,
  /^(?:bookmarks?|marcadores?|favoritos?)\s+(?:sobre|de|do|da|em|para)\s+(.+)$/i,
];

const SOURCE_PATTERNS = [
  /\b(fontes?|source(?:s)?|origem|evid[eê]ncias?)\b/i,
  /\b(de onde veio isso|mostra as fontes|mostrar as fontes|de onde saiu isso)\b/i,
];

const WIKI_PATTERNS = [
  /\b(wiki|dossi[eê]s?|mem[oó]ria|mem[oó]ria local|base local)\b/i,
  /\b(o que temos salvo|resuma o dossi[eê]|resume o dossi[eê]|resume o que temos salvo)\b/i,
];

const RESEARCH_PATTERNS = [
  /\b(pesquisa(?:r)?|procura(?:r)?|busca(?:r)?|investiga(?:r)?|analisa(?:r)?|valida(?:r)?|estuda(?:r)?)\b/i,
  /\b(mercado|ideia|hip[oó]tese|tese|oportunidade|sinal|sinais|produto)\b/i,
];

const GREETING_ONLY_PATTERN =
  /^(?:oi+|ol[aá]+|opa|e ai|e aí|bom dia|boa tarde|boa noite|hello|hi|hey)(?:[!.\s,]*(?:tudo bem|td bem|beleza|blz|como vai|pode me ajudar|me ajuda|ajuda)?)?[!.\s,?]*$/i;

const GITHUB_REPOS_PATTERNS = [
  /\b(?:quais|lista|mostra|ver)\b.*\b(?:meus|minhas)\b.*\brepos?(?:itorios?|it[oó]rios)?\b/i,
  /\b(?:meus|minhas)\b.*\brepos?(?:itorios?|it[oó]rios)?\b/i,
];

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeForMatch(value: string): string {
  return stripAccents(normalizeWhitespace(value).toLowerCase());
}

function isLikelyTopic(value: string): boolean {
  const normalized = normalizeForMatch(value);
  if (!normalized) return false;
  return !/^(?:isso|isto|aquilo|ideia|mercado|produto|tese|hipotese|case|assunto|coisa)$/i.test(
    normalized,
  );
}

function extractTrailingSubject(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match) return undefined;
  const candidate = normalizeWhitespace(match[1] || '');
  return isLikelyTopic(candidate) ? candidate : undefined;
}

function extractResearchTopic(text: string): string | undefined {
  const cleaned = normalizeWhitespace(text);
  const patterns = [
    /^(?:por favor\s+)?(?:quero(?: que voce)?\s+)?(?:me ajude a\s+)?(?:pesquisa(?:r)?|procura(?:r)?|busca(?:r)?|investiga(?:r)?|analisa(?:r)?|valida(?:r)?|estuda(?:r)?)(?:\s+(?:essa?|esse|este|esta|isso|isto|aquilo))?(?:\s+(?:ideia|mercado|hip[oó]tese|tese|produto|proposta|case))?(?:\s+(?:de|do|da|sobre|em|para))?\s+(.+)$/i,
    /^(?:pesquisa|procura|busca|investiga|analisa|valida|estuda)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const subject = extractTrailingSubject(cleaned, pattern);
    if (subject) return subject;
  }

  return undefined;
}

function extractRepoTarget(text: string): string | undefined {
  for (const pattern of REPO_TARGET_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = normalizeWhitespace(match[1] || match[0]);
    if (candidate) return candidate;
  }
  return undefined;
}

function extractBookmarkQuery(text: string): string | undefined {
  for (const pattern of BOOKMARK_QUERY_PATTERNS) {
    const subject = extractTrailingSubject(text, pattern);
    if (subject) return subject;
  }
  return undefined;
}

function clarificationFor(kind: Exclude<WhatsappIntent, 'clarify'>): string {
  if (kind === 'repo') return 'Qual GitHub URL ou `owner/repo` devo analisar?';
  if (kind === 'research') return 'Qual ideia, mercado ou hipótese devo pesquisar?';
  return 'Quero ajudar, mas preciso de mais contexto.';
}

function resolveLegacyCommand(text: string, defaultRepoSlug?: string): ResolvedIntent | undefined {
  const trimmed = normalizeWhitespace(text);
  const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return undefined;

  const command = `/${match[1].toLowerCase()}`;
  const kind = LEGACY_COMMANDS[command];
  if (!kind) return undefined;

  const payload = normalizeWhitespace(match[2] || '');
  if (kind === 'repo' && !payload && !defaultRepoSlug) {
    return {
      kind: 'clarify',
      payload: '',
      source: 'natural-language',
      clarification: clarificationFor('repo'),
      legacyCommand: command,
    };
  }

  return {
    kind,
    payload: kind === 'repo' && !payload ? defaultRepoSlug || '' : payload,
    source: 'legacy-command',
    legacyCommand: command,
  };
}

export function resolveIntent(text: string, options: ResolveIntentOptions = {}): ResolvedIntent {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) {
    return {
      kind: 'clarify',
      payload: '',
      source: 'natural-language',
      clarification:
        'Quero ajudar, mas preciso de mais contexto. Você quer pesquisar uma ideia, revisar um dossiê, ver fontes, analisar um repo, procurar bookmarks ou resetar a sessão?',
    };
  }

  const legacy = resolveLegacyCommand(trimmed, options.defaultRepoSlug);
  if (legacy) return legacy;

  const normalized = normalizeForMatch(trimmed);
  const repoTarget = extractRepoTarget(trimmed);

  if (GREETING_ONLY_PATTERN.test(normalized)) {
    return {
      kind: 'greeting',
      payload: trimmed,
      source: 'natural-language',
    };
  }

  if (CAPABILITIES_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'capabilities',
      payload: trimmed,
      source: 'natural-language',
    };
  }

  if (GITHUB_REPOS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'github-repos',
      payload: trimmed,
      source: 'natural-language',
    };
  }

  if (SAVED_TOPICS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'saved-topics',
      payload: trimmed,
      source: 'natural-language',
    };
  }

  if (MONITOR_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'monitor',
      payload: trimmed,
      source: 'natural-language',
    };
  }

  if (RESET_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'reset',
      payload: '',
      source: 'natural-language',
    };
  }

  if (REPO_HINT_PATTERNS.some((pattern) => pattern.test(normalized)) || repoTarget) {
    if (repoTarget) {
      return {
        kind: 'repo',
        payload: repoTarget,
        source: 'natural-language',
      };
    }

    return {
      kind: 'clarify',
      payload: '',
      source: 'natural-language',
      clarification: clarificationFor('repo'),
    };
  }

  if (SOURCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'sources',
      payload: trimmed,
      source: 'natural-language',
    };
  }

  if (WIKI_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'wiki',
      payload: trimmed,
      source: 'natural-language',
    };
  }

  if (BOOKMARK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'bookmarks',
      payload: extractBookmarkQuery(trimmed) || '',
      source: 'natural-language',
    };
  }

  if (RESEARCH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const topic = extractResearchTopic(trimmed);
    if (topic) {
      return {
        kind: 'research',
        payload: topic,
        source: 'natural-language',
      };
    }

    return {
      kind: 'clarify',
      payload: '',
      source: 'natural-language',
      clarification: clarificationFor('research'),
    };
  }

  return {
    kind: 'clarify',
    payload: '',
    source: 'natural-language',
    clarification:
      'Quero ajudar, mas não entendi a intenção. Você quer pesquisar, revisar um dossiê, ver fontes, analisar um repo, procurar bookmarks ou resetar a sessão?',
  };
}
