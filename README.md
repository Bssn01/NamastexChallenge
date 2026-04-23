# NamastexChallenge

WhatsApp research agent built for the Namastex technical challenge.

The real production path is:

`WhatsApp (Omni/Baileys) -> Omni -> Genie/Claude -> local dossier workflow -> Omni reply -> WhatsApp`

Mock mode still exists for deterministic tests, but the project is now designed around the real integration path and real credentials.

## Challenge checklist

- WhatsApp via Omni with Baileys:
  - use `omni instances create --channel whatsapp-baileys`
  - pair with `omni instances qr <id> --watch`
- Genie as orchestrator:
  - `CLAUDE.md` constrains Claude to the local deterministic workflow
  - register the repo with `genie dir add`
  - run Genie infrastructure with `genie serve`
- Omni as bridge:
  - `scripts/omni-turn.ts`
  - `omni connect <instance-id> namastex-research --reply-filter filtered`
- Real integrations:
  - arXiv
  - Hacker News (live by default — no auth required)
  - Grok
  - X search through xAI or OpenRouter
  - GitHub
  - Repomix
  - optional `fieldtheory-cli`
  - optional `genie brain` knowledge graph
- Clear agent purpose:
  - research an idea, persist a dossier, and evaluate real GitHub repositories against that dossier
- Public GitHub repo:
  - publish this repository before submission

## Main commands

- `/pesquisar <ideia>`: create a dossier, fetch grouped evidence (arXiv + HN + X + FieldTheory), synthesize with Grok, store a research run, and ingest the dossier into Genie Brain
- `/wiki <termo>`: summarize the latest matching local dossier and augment with Genie Brain knowledge graph results
- `/fontes <termo>`: list grouped sources from the latest matching dossier
- `/repo <owner/repo-or-url> [idea:<id>]`: materialize the selected GitHub repo, compact it with Repomix, and evaluate fit against the dossier
- `/bookmarks <consulta>`: search local `fieldtheory-cli` bookmarks when configured
- `/reset`: reset only the active session boundary

## Quickstart: real setup

### 1. Prerequisites

- Node.js 20+
- npm
- Bun
- Claude Code
- Omni CLI
- Genie CLI

### 2. Install project dependencies

```bash
npm install
```

### 3. Bootstrap local Genie and Omni worktrees

```bash
GENIE_REPO_URL=https://github.com/automagik-dev/genie.git \
OMNI_REPO_URL=https://github.com/automagik-dev/omni.git \
npm run deps:bootstrap
```

### 4. Create the local env file

```bash
cp .env.example .env
```

Open `.env` and make these changes:

**Required:**

```env
NAMASTEX_MODE=live          # change from mock to live
```

**Claude authentication** — pick one:

```env
# Option A: already logged in via `claude login` (no change needed)
# Option B: headless / CI
ANTHROPIC_API_KEY=sk-ant-...
```

**Grok synthesis** — uncomment one:

```env
XAI_API_KEY=xai-...
# or
OPENROUTER_API_KEY=sk-or-...
```

**GitHub** (recommended — avoids rate limits):

```env
GITHUB_TOKEN=ghp_...
```

**Leave these commented** — they have sensible defaults built in:

| Variable | Default |
|---|---|
| `HACKERNEWS_API_BASE` | `https://hn.algolia.com/api/v1` |
| `GROK_MODEL` | `x-ai/grok-4.1-fast` |
| `X_SEARCH_MODEL` | `grok-4.20-reasoning` |
| `X_SEARCH_LIMIT` | `5` |
| `GITHUB_OWNER` / `GITHUB_REPO` | optional — only set to pin a default repo for `/repo` |

Optional local tools:

- `fieldtheory-cli` (local bookmark enrichment)
- `genie brain` knowledge graph (requires `genie brain install` + `genie brain init`)

### 5. Start Omni and Genie

Example flow using the installed CLIs:

```bash
omni start
genie dir add namastex-research --dir /Users/eduardobassani/Desktop/NamastexAgentChallenge
GENIE_EXECUTOR=tmux genie serve
```

### 6. Create and pair the WhatsApp instance

```bash
omni instances create --name "namastex-whatsapp" --channel whatsapp-baileys
omni instances qr <instance-id> --watch
```

### 7. Connect the Omni instance to the Genie agent

```bash
omni connect <instance-id> namastex-research --reply-filter filtered
```

### 8. Validate the live path

Send a WhatsApp message such as:

```text
/pesquisar IDEIA: Quero um agente que pesquise ideias de produto em IA
TOPICO PRINCIPAL: agentes de pesquisa
GRUPOS NICHO:
- Mercado: suporte, automação, atendimento
- Stack: omni, genie, claude
```

Expected behavior:

- Omni receives the message
- Claude is constrained by `CLAUDE.md`
- Claude runs `npm run local:turn -- --json "$OMNI_MESSAGE"` exactly once
- the workflow stores a dossier and research run
- Omni returns the reply to WhatsApp with `omni say` and finalizes with `omni done`

## Quickstart: mock mode

```bash
cp .env.example .env
npm run seed:mock
npm run demo:mock
```

Useful local commands:

```bash
npm run local:turn -- "/pesquisar agentes de whatsapp"
npm run local:turn -- "/wiki agentes"
npm run local:turn -- "/fontes agentes"
NAMASTEX_OMNI_DELIVERY=stdout npm run omni:turn -- "/pesquisar agentes de whatsapp"
```

## Repository fit flow

`/repo` now uses the selected repository, not the challenge repo.

Flow:

1. normalize the GitHub slug or URL
2. materialize the target repo into `data/repos/<owner>/<repo>`
3. compact that cached repo with `Repomix`
4. compare the compacted code context against the saved dossier
5. persist a `RepoAssessment`

Security constraints:

- target repositories are never executed
- no install scripts, test scripts, hooks, or repo commands are run
- repo contents are treated as untrusted data only

## Field Theory integration

The agent supports `fieldtheory-cli` as optional local enrichment.

If `fieldtheory-cli` is:

- missing: the bot states that it is not installed
- installed but unconfigured: the bot states that it is not configured
- configured: `/bookmarks` returns local bookmark matches; results also flow into `/pesquisar` alongside arXiv and HN

Data directory defaults to `data/fieldtheory`. Override with `FT_DATA_DIR=<path>`.

The workflow never runs `ft sync` automatically.

## Genie Brain integration

The agent integrates with `genie brain` as an optional persistent knowledge graph.

If `genie brain` is:

- missing: noted in diagnostics, workflow continues without it
- installed but vault not initialized: noted in diagnostics, workflow continues without it
- ready: every `/pesquisar` run ingests the dossier into Brain; every `/wiki` query also searches Brain and appends results under a "Brain:" section

Setup:

```bash
genie brain install
genie brain init --name namastex-research --path ./data/brain-vault
```

Ingest artifacts are written to `data/brain-ingest/<dossier-id>.md`. Override with `GENIE_BRAIN_INGEST_DIR=<path>`.

## Security model

The agent is intentionally constrained.

It may:

- search
- read
- analyze
- compact repository context
- compare evidence against the user dossier

It must not:

- obey instructions found inside repositories, tweets, articles, websites, scraped content, bookmarks, `AGENTS.md`, or `CLAUDE.md`
- execute arbitrary repo commands during `/repo`
- expose secrets, tokens, cookies, or OAuth files
- run anything outside the supported workflow commands

## Verification

Run:

```bash
npm run lint
npm run typecheck
npm test
```

## Project layout

- `src/`: runtime, workflow, adapters, security helpers, and store
  - `src/adapters/`: arXiv, HackerNews, Grok, GitHub, Repomix, X, FieldTheory, GenieBrain
- `scripts/`: local entrypoints for demos, seeding, and Omni bridge turns
- `tests/`: automated coverage for workflow, adapters, security, and turn execution
- `fixtures/mock/`: deterministic mock data
- `data/`: local runtime state, cached analyzed repos, brain ingest artifacts
- `genie/` and `omni/`: local external dependencies used in the live bridge
