# NamastexChallenge

WhatsApp research agent built for the Namastex technical challenge.

The real production path is:

`WhatsApp (Omni/Baileys) -> Omni -> Genie/Claude -> local dossier workflow -> Omni reply -> WhatsApp`

Mock mode still exists for deterministic tests, but the project is now designed around the real integration path and real credentials.

## Challenge checklist

- WhatsApp via Omni with Baileys:
  - use `omni instances create --channel whatsapp-baileys`
  - pair with `omni instances qr <id>`
- Genie as orchestrator:
  - `CLAUDE.md` constrains Claude to the local deterministic workflow
  - register the repo with `genie dir add`
  - run Genie infrastructure with `genie serve`
- Omni as bridge:
  - `scripts/omni-turn.ts`
  - `omni connect <instance-id> namastex-research --reply-filter filtered`
- Real integrations:
  - arXiv
  - Hacker News (network-backed by default — no auth required)
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
NAMASTEX_MODE=real          # change from mock to real
NAMASTEX_TURN_EXECUTOR=auto # Claude -> Codex/OpenAI -> local fallback
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

### 5. Configure Genie (first run only)

```bash
genie setup --quick
```

### 6. Scaffold the agent inside the workspace

Genie expects agents under `agents/<name>/`. Scaffold once and sync:

```bash
cd /Users/bassani/Desktop/NamastexChallenge
genie init agent namastex-research
genie dir sync
genie dir ls   # confirm namastex-research is registered
```

### 7. Start Omni and Genie

```bash
cd /Users/bassani/Desktop/NamastexChallenge
omni start
GENIE_EXECUTOR=tmux genie serve start --daemon
```

Use `GENIE_EXECUTOR=tmux` for the WhatsApp agent when you want the `provider:
codex` setting in `agents/namastex-research/agent.yaml` to take effect. Genie
SDK mode is Claude-SDK only; the repo wrapper still has `NAMASTEX_TURN_EXECUTOR=auto`,
but SDK mode cannot spawn Codex directly.

### 8. Create and pair the WhatsApp instance

```bash
omni instances create --name "namastex-whatsapp" --channel whatsapp-baileys
omni instances connect <instance-id>
omni instances qr <instance-id>
```

Scan the QR with WhatsApp to pair. If the QR fetch fails with
"No QR code available", restart PM2 and retry:

```bash
pm2 restart omni-api
omni instances qr <instance-id>
```

### 9. Connect the Omni instance to the Genie agent

```bash
omni connect <instance-id> namastex-research --reply-filter filtered
```

The Omni bridge is already running via `genie serve` — no extra step needed.
Verify everything is healthy with:

```bash
cd /Users/bassani/Desktop/NamastexChallenge
genie doctor
```

### Live Bridge Change Runbook

Run these from the repository root:

```bash
cd /Users/bassani/Desktop/NamastexChallenge
```

After editing `agents/namastex-research/agent.yaml`, `AGENTS.md`, or agent
identity files:

```bash
genie dir sync
genie dir ls
```

After editing `src/turn-execution.ts`, `scripts/omni-turn.ts`, `CLAUDE.md`,
`AGENTS.md`, `agents/namastex-research/AGENTS.md`, or the WhatsApp turn
behavior:

```bash
npm test
npm run typecheck
NAMASTEX_OMNI_DELIVERY=stdout NAMASTEX_TURN_EXECUTOR=local npm run omni:turn -- "/pesquisar agentes de whatsapp"
genie serve stop
GENIE_EXECUTOR=tmux genie serve start --daemon
```

After editing Genie provider code under `genie/src/`, rebuild Genie and restart
the real bridge so the globally installed `genie` command picks up the change:

```bash
cd /Users/bassani/Desktop/NamastexChallenge/genie
bun test src/lib/provider-adapters.test.ts src/lib/providers/codex.test.ts
bun run build
cp dist/genie.js /Users/bassani/.bun/install/global/node_modules/@automagik/genie/dist/genie.js
cd /Users/bassani/Desktop/NamastexChallenge
genie serve stop
GENIE_EXECUTOR=tmux genie serve start --daemon
```

If WhatsApp messages do not produce any reply:

```bash
omni status
genie doctor
omni start
genie serve stop
GENIE_EXECUTOR=tmux genie serve start --daemon
```

If Omni receives the message but Genie logs an empty response (`parts:0`) or
keeps using an old Claude executor after switching the agent to Codex:

```bash
genie agent kill namastex-research
genie dir sync
genie db query "update executors set state='terminated', ended_at=now(), closed_at=coalesce(closed_at, now()), close_reason=coalesce(close_reason, 'manual reset stale omni provider'), outcome=coalesce(outcome, 'failed') where agent_id in (select id from agents where name='namastex-research') and state not in ('terminated', 'done')"
genie db query "update agents set current_executor_id=null, state=null where name='namastex-research'"
genie serve stop
GENIE_EXECUTOR=tmux genie serve start --daemon
```

If Claude is out of credits, use the Codex/OpenAI path:

```bash
genie serve stop
GENIE_EXECUTOR=tmux genie serve start --daemon
NAMASTEX_OMNI_DELIVERY=stdout NAMASTEX_TURN_EXECUTOR=codex npm run omni:turn -- "/pesquisar agentes de whatsapp"
```

### 10. Validate the real path

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
- Genie uses Claude first when available, then Codex/OpenAI, then the local workflow fallback
- the active agent runs `npm run local:turn -- --json "<user-message>"` exactly once
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
NAMASTEX_OMNI_DELIVERY=stdout NAMASTEX_TURN_EXECUTOR=codex npm run omni:turn -- "/pesquisar agentes de whatsapp"
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
- `genie/` and `omni/`: local external dependencies used in the real bridge
