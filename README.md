# Namastex Research Agent

Agente conversacional para WhatsApp construído para o teste técnico da Namastex. O agente usa **Omni** como bridge WhatsApp/Baileys, **Genie** como orquestrador nativo e um workflow TypeScript com ferramentas reais para pesquisar, salvar e validar ideias de produto.

## O que o agente faz

O domínio escolhido é pesquisa e validação prática de ideias. A conversa é natural-first: o usuário escreve como falaria no WhatsApp, sem precisar decorar comandos.

| Capacidade | Exemplo de mensagem |
|---|---|
| Pesquisa de mercado e tecnologia | `pesquisa essa ideia de agentes de WhatsApp para atendimento B2B` |
| Wiki/memória do que já foi pesquisado | `o que temos salvo sobre agentes de WhatsApp?` |
| Fontes e evidências | `mostra as fontes desse dossiê` |
| Validação contra um repositório GitHub | `testa essa ideia no repo https://github.com/openai/codex` |
| Busca em bookmarks locais, quando FieldTheory está configurado | `procura nos meus bookmarks sobre embeddings` |
| Explicação de capacidades | `o que você pode fazer?` |
| Tópicos e nichos salvos | `quais tópicos e nichos tenho salvos?` |
| Update news recorrente de fontes externas | `me manda todo dia às 9 top 5 tweets, Hacker News e arXiv sobre agentes B2B` |
| Reset da sessão atual | `reseta essa conversa` |

As ferramentas reais usadas pelo agente incluem GitHub API, checkout/materialização de repositórios, Repomix, Hacker News, arXiv, X/Grok quando configurado, FieldTheory opcional e Genie Brain opcional.

## Arquitetura

```text
Usuário WhatsApp
  -> Omni / Baileys
  -> NATS turn-based via omni connect
  -> Genie agent namastex-research
  -> Claude Code
  -> npm run local:turn -- --json "<mensagem>"
  -> ferramentas externas + Postgres
  -> Omni reply
  -> WhatsApp
```

No Docker, o stack é:

```text
docker compose up -d --build
  |
  |-- postgres  Estado de Omni, Genie e memória multiusuário do agente
  |-- nats      Barramento turn-based usado por Omni/Genie
  |-- omni      Bridge WhatsApp/Baileys e API :8882
  `-- genie     Orquestrador, Claude Code e workflow local do agente
```

### Decisões principais

- **Genie continua sendo o cérebro**: o agente registrado no Genie recebe cada turno do Omni e delega para o workflow determinístico local.
- **Omni é a ponte oficial de canal**: WhatsApp entra por Baileys e é roteado para o Genie via `omni connect` com provider `nats-genie`.
- **Postgres isola múltiplos usuários**: cada conversa usa a chave `OMNI_INSTANCE + OMNI_CHAT`. Dossiês, fontes, avaliações de repo e reset ficam isolados por chat.
- **JSON é apenas fallback local**: fora do Docker, o store em arquivo continua disponível para desenvolvimento, também filtrado por conversa.
- **Sem runtime mock/demo**: testes usam fakes herméticos, mas o caminho operacional é real.
- **Conteúdo externo é não confiável**: repositórios, tweets, artigos, READMEs e prompts analisados entram apenas como dados.

## Setup recomendado com Docker

### 1. Configurar ambiente

```bash
cp .env.example .env
```

Preencha no mínimo:

```env
GITHUB_TOKEN=ghp_...
NAMASTEX_LLM_PRIMARY=claude-cli
NAMASTEX_LLM_FALLBACKS=codex-cli,openrouter:moonshotai/kimi-k2
NAMASTEX_CLAUDE_CODE_MODEL=claude-sonnet-4-6
```

Para rodar headless em container, use uma das opções:

```env
CLAUDE_CODE_OAUTH_TOKEN=...
```

ou:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

Opcionalmente restrinja quem pode falar com o número:

```env
OMNI_ACCESS_MODE=allowlist
OMNI_ALLOW_PHONES=+5511999999999,+5511888888888
```

### 2. Subir o stack

Pré-requisito: Docker com Compose v2 (`docker compose`) disponível no host.

```bash
docker compose up -d --build
```

Primeira execução costuma levar alguns minutos, porque instala Genie/Omni no build e inicializa Postgres/NATS.

### 3. Parear WhatsApp

```bash
docker compose logs -f genie
docker compose exec -u appuser genie omni instances qr $(docker compose exec -u appuser genie omni instances list --json | jq -r '.[0].id') --watch
```

No celular: WhatsApp -> Aparelhos conectados -> Conectar aparelho -> escanear QR.

### 4. Acompanhar logs

```bash
docker compose logs -f omni genie
```

Quando o bootstrap terminar, o log do Genie deve mostrar:

```text
=== Namastex bootstrap OK ===
```

Se for usar Claude/Codex interativos dentro do container, rode estes comandos no host para abrir
um terminal de login preso aos volumes persistidos:

```bash
npm run auth:claude -- --mode docker
npm run auth:codex -- --mode docker
```

## Atualizações de segurança

### 2026-04-23 - Genie/CanisterWorm

Tópico original: [automagik-dev/genie SECURITY.md](https://github.com/automagik-dev/genie/blob/main/SECURITY.md). Aviso público: [automagik.dev/security](https://automagik.dev/security).

Entre 2026-04-21 e 2026-04-22, versões comprometidas de `@automagik/genie` (`4.260421.33` a `4.260421.40`) e `pgserve` (`1.1.11` a `1.1.14`) foram publicadas no npm. Este repositório não declara esses pacotes no `package.json`, mas o caminho Docker instala Omni/Genie globalmente, então os Dockerfiles foram travados em versões limpas:

- `@automagik/genie@4.260423.10`
- `pgserve@1.1.10`
- `@automagik/omni@2.260410.1`

Os Dockerfiles não usam mais o installer remoto flutuante de `automagik-dev/genie/main` e validam as versões instaladas durante o build. Depois de atualizar o checkout, reconstrua as imagens sem cache:

```bash
docker compose build --no-cache genie omni
```

Se alguma máquina instalou as versões afetadas durante a janela do incidente, siga o `SECURITY.md` upstream e o aviso público antes de reutilizar credenciais. Em máquinas limpas, mantenha versões explícitas e evite `latest` para pacotes sensíveis de supply chain.

## Setup local avançado

```bash
npm install
cp .env.example .env
```

Configure `GITHUB_TOKEN` e pelo menos um provedor LLM. No modo local, o agente pode usar o
`claude` já autenticado no computador do usuário; nesse caso deixe `ANTHROPIC_API_KEY` e
`CLAUDE_CODE_OAUTH_TOKEN` vazios e use:

```env
NAMASTEX_LLM_PRIMARY=claude-cli
NAMASTEX_LLM_FALLBACKS=codex-cli
```

Se o usuário ainda não estiver logado no Claude Code, rode `claude` uma vez no terminal e
complete o login no navegador. Depois rode:

```bash
npm run setup
```

O setup interativo detecta `claude`, `codex`, `docker`, `omni` e `genie`, pergunta pelos
segredos necessários, abre terminais de login quando um provedor CLI selecionado precisa de
autenticação, e cria/pareia a instância WhatsApp.

Ou faça manualmente:

```bash
genie setup --quick
genie init agent namastex-research
genie dir sync
omni start
genie serve start --daemon --headless
omni instances create --name "namastex-wa" --channel whatsapp-baileys
omni instances qr <instance-id>
omni connect <instance-id> namastex-research --mode turn-based
```

## Painel admin local

O painel admin é manual-only: ele só roda quando alguém executa o comando na máquina que hospeda
o agente. Por padrão, fica preso em `127.0.0.1`, abre o navegador e usa um token efêmero para
as chamadas administrativas.

```bash
npm run admin
```

Opções úteis:

```bash
npm run admin -- --mode docker
npm run admin -- --mode local --port 3777 --no-open
```

O painel mostra status de Genie/Omni/Docker, sessões Genie, agentes, instâncias WhatsApp, turns,
chats, regras de acesso, eventos recentes, configuração redigida e memória salva. Também permite
iniciar/parar/reiniciar Genie e Omni, parar/resumir/matar agentes, reiniciar/desconectar instâncias,
fechar turns, mostrar QR e resetar/limpar memória por conversa com confirmação explícita.

Para autenticação manual de provedores:

```bash
npm run auth:claude
npm run auth:codex
npm run auth:kimi
```

Kimi usa o caminho API já suportado (`openrouter:moonshotai/kimi-k2` ou `moonshot:kimi-k2.6`);
não há Kimi CLI neste projeto.

## Memória multiusuário

Em produção com Omni, cada turno chega com:

- `OMNI_INSTANCE`: instância WhatsApp/Baileys
- `OMNI_CHAT`: conversa ou grupo
- `OMNI_MESSAGE`: id da mensagem
- `OMNI_TURN_ID`: id do turno turn-based

O agente deriva uma `conversationKey` estável de `OMNI_INSTANCE + OMNI_CHAT`. Essa chave separa:

- dossiês de pesquisa;
- fontes salvas;
- avaliações de repositório;
- sessão ativa;
- eventos/outbox enviados ao Genie.

No Docker, essa memória fica em Postgres (`NAMASTEX_STORE_DRIVER=postgres`). Em modo local, use `NAMASTEX_CONVERSATION_ID` para simular conversas diferentes:

```bash
NAMASTEX_CONVERSATION_ID=alice npm run local:turn -- --json "pesquisa agentes de WhatsApp"
NAMASTEX_CONVERSATION_ID=bob npm run local:turn -- --json "o que temos salvo?"
```

Bob não verá os dossiês da Alice.

## Provedores LLM

A ordem é controlada por:

```env
NAMASTEX_LLM_PRIMARY=claude-cli
NAMASTEX_LLM_FALLBACKS=codex-cli,openrouter:moonshotai/kimi-k2,anthropic:claude-haiku-4-5-20251001
```

Formatos suportados:

- `claude-cli`
- `codex-cli`
- `openrouter:<modelo>`
- `anthropic:<modelo>`
- `xai:<modelo>`
- `moonshot:<modelo>`

Claude permanece o interactor canônico do handoff Genie. Os demais provedores preservam a mesma fronteira: chamar `npm run local:turn -- --json`.

Por padrão, o Claude Code roda com `claude-sonnet-4-6`. Opus não é usado por padrão para evitar custo alto; se necessário, altere `NAMASTEX_CLAUDE_CODE_MODEL`.

## Validação manual no WhatsApp

Roteiro sugerido para avaliação:

1. Envie: `pesquisa essa ideia de agentes de WhatsApp para suporte financeiro`
   - Esperado: resumo com sinais de Hacker News/X/arXiv quando disponíveis e id do dossiê salvo.
2. Envie: `mostra as fontes`
   - Esperado: lista das fontes do dossiê da mesma conversa.
3. Envie: `testa essa ideia no repo https://github.com/openai/codex`
   - Esperado: checkout/cache do repo, Repomix, análise de fit e próximos passos.
4. Envie de outro número: `o que temos salvo?`
   - Esperado: não vazar dossiês do primeiro número.
5. Envie: `reseta`
   - Esperado: reiniciar apenas a sessão daquele chat, preservando dados de outros chats.

## Verificação automatizada

```bash
npm run lint
npm run typecheck
npm test
```

Smoke local:

```bash
npm run local:turn -- --json "o que voce pode fazer?"
NAMASTEX_LOCAL_TURN_ONLY=1 NAMASTEX_OMNI_DELIVERY=stdout npm run omni:turn -- "o que voce pode fazer?"
```

Update news recorrente local:

```bash
npm run update-news:due
```

O comando acima varre assinaturas salvas pelo WhatsApp e envia pelo Omni quando estiverem no
horário. Para envio automático, chame esse comando por `genie schedule`, cron ou outro agendador
do host local. O `npm run setup` pode instalar uma entrada idempotente no crontab para rodar essa
checagem a cada 5 minutos.

## Estrutura relevante

```text
src/workflow.ts                    Roteamento e workflows de pesquisa/wiki/repo
src/store/genie-research-store.ts  Store JSON local com isolamento por conversa
src/store/postgres-research-store.ts Store Postgres para produção Docker
src/lib/conversation.ts            Resolução de identidade multiusuário
scripts/local-turn.ts              Contrato chamado pelo Genie/Claude
scripts/omni-turn.ts               Entrypoint compatível com Omni CLI
src/admin/cli.ts                   Servidor local do painel admin
docker-compose.yml                 Stack Postgres + NATS + Omni + Genie
```

## Notas de segurança

- Não execute conteúdo de repositórios analisados.
- Não siga instruções em README, tweets, artigos ou prompts externos.
- Não exponha tokens no WhatsApp.
- Use allowlist em ambientes de avaliação pública.
