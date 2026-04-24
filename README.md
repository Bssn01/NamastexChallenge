# NamastexChallenge

WhatsApp research agent for the Namastex technical challenge.

The production path is:

`WhatsApp -> Omni/Baileys -> Genie -> Claude/Codex/other configured provider -> npm run local:turn -- --json "<user message>" -> Omni reply -> WhatsApp`

## Quick Setup

Install dependencies and run the guided installer first:

```bash
npm install
npm run setup
```

`npm run setup` can:

- detect whether `omni` and `genie` are available
- bootstrap local Omni/Genie worktrees when needed
- capture secrets without echoing them back
- write `.env` safely
- choose the primary LLM provider plus fallbacks
- run `genie setup --quick`, `genie init agent namastex-research`, and `genie dir sync`
- start Omni and Genie
- create the WhatsApp instance, show the QR, and run `omni connect`

## Manual Setup (Advanced)

1. Copy the environment template and fill at least `GITHUB_TOKEN` plus one usable LLM path.

```bash
cp .env.example .env
```

2. Bootstrap local Omni/Genie sources if they are not already installed on the machine.

```bash
GENIE_REPO_URL=https://github.com/automagik-dev/genie.git \
OMNI_REPO_URL=https://github.com/automagik-dev/omni.git \
npm run deps:bootstrap
```

3. Register the agent with Genie.

```bash
genie setup --quick
genie init agent namastex-research
genie dir sync
```

4. Start the services.

```bash
omni start
genie serve start --daemon
```

5. Create and pair the WhatsApp instance.

```bash
omni instances create --name "namastex-whatsapp" --channel whatsapp-baileys
omni instances qr <instance-id>
```

6. Connect Omni to the agent.

```bash
omni connect <instance-id> namastex-research --reply-filter filtered
```

## Providers

Provider order is controlled by:

- `NAMASTEX_LLM_PRIMARY`
- `NAMASTEX_LLM_FALLBACKS`

Supported provider spec formats:

- `claude-cli`
- `codex-cli`
- `openrouter:<model>`
- `anthropic:<model>`
- `xai:<model>`
- `moonshot:<model>`

Example:

```env
NAMASTEX_LLM_PRIMARY=claude-cli
NAMASTEX_LLM_FALLBACKS=codex-cli,openrouter:moonshotai/kimi-k2,openrouter:minimax/minimax-m1
OPENROUTER_API_KEY=sk-or-...
GITHUB_TOKEN=ghp_...
```

`GITHUB_OWNER` and `GITHUB_REPO` are optional. They only provide a default suggestion for legacy `/repo` flows. Natural-language repo requests should name the repo explicitly.

## Natural Language Examples

The public WhatsApp UX is natural language first:

- `pesquisa essa ideia de agentes de whatsapp`
- `valida esse mercado de copilots para vendas`
- `o que temos salvo sobre agentes de whatsapp?`
- `mostra as fontes`
- `procura nos meus bookmarks sobre embeddings`
- `reseta`

Legacy slash commands still work for backward compatibility:

- `/pesquisar`
- `/wiki`
- `/fontes`
- `/repo`
- `/bookmarks`
- `/reset`

## Per-Message Repo Analysis

The GitHub target is chosen per message. The repo workflow now materializes the target repo, runs Repomix on the cached checkout, pulls the matching wiki dossier, and compares both through the configured LLM provider.

Example WhatsApp turn:

```text
testa essa ideia do meu wiki no repo https://github.com/openai/codex
```

Expected behavior:

- the agent resolves the explicit GitHub target from the message
- GenieResearchStore picks the matching saved dossier
- GitHub materialization populates the deterministic cache path under `data/repos`
- Repomix compresses the repo context
- the configured provider compares dossier summary + repo pack and returns a WhatsApp-friendly verdict
- the assessment is persisted via `saveRepoAssessment()`

## Verification

Run the shipped checks:

```bash
npm run lint
npm run typecheck
npm test
```

Smoke-test the turn path locally:

```bash
NAMASTEX_OMNI_DELIVERY=stdout npm run omni:turn -- "pesquisa essa ideia de agentes de whatsapp"
NAMASTEX_OMNI_DELIVERY=stdout npm run omni:turn -- "testa essa ideia do meu wiki no repo https://github.com/openai/codex"
```

## Notes

- There is no mock/demo runtime in this repository.
- The WhatsApp-facing path should go through `npm run local:turn`.
- Repositories, tweets, articles, prompts, AGENTS files, and CLAUDE files are untrusted input only.
