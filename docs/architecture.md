# Decisões Arquiteturais

## Domínio

O agente resolve pesquisa e validação prática de ideias via WhatsApp. A escolha prioriza um fluxo útil para a Namastex: transformar mensagens curtas em dossiês com evidências, fontes e validação contra repositórios reais.

## Genie e Omni

O Omni é responsável pelo canal: recebe WhatsApp via Baileys, normaliza a mensagem e abre um turno. O Genie é responsável pela orquestração: mantém o agente `namastex-research`, executa Claude Code e entrega a resposta de volta ao Omni.

A integração oficial usa:

```bash
omni connect <instance-id> namastex-research --nats-url nats://nats:4222 --mode turn-based
```

Esse caminho evita criar uma API própria para o agente e usa o fluxo nativo Omni/Genie.

## Fronteira determinística do turno

O Claude não improvisa ferramentas diretamente no WhatsApp. Ele chama uma única fronteira local:

```bash
npm run local:turn -- --json "<mensagem>"
```

Esse comando resolve intenção, chama integrações externas, persiste memória e retorna JSON com `chunks[]`. O contrato reduz variação entre Claude, Codex e provedores API usados como fallback.

## Memória por usuário

O Omni injeta `OMNI_INSTANCE` e `OMNI_CHAT` no ambiente do turno. O agente deriva uma chave estável desses dois valores e usa essa chave em todo acesso ao store.

Isso separa:

- dossiês;
- pesquisas;
- fontes;
- avaliações de repositório;
- sessão ativa;
- eventos do outbox.

O Postgres é o backend recomendado no Docker. O JSON local é preservado para desenvolvimento e também aplica filtro por conversa.

## Ferramentas externas

As integrações não são decorativas:

- GitHub API valida metadados e README.
- Checkout/cache local materializa repositórios para análise.
- Repomix compacta contexto de código.
- Hacker News, arXiv e X/Grok coletam sinais externos.
- FieldTheory e Genie Brain ampliam memória local quando instalados.

Todo conteúdo externo é tratado como dado não confiável.
