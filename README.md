# NamastexChallenge

WhatsApp research agent for the Namastex technical challenge.

This repository contains the project-owned workflow, adapters, bridge scripts, and tests used in
the delivery. `genie/` and `omni/` are local integration dependencies used by the agent at runtime,
but they are not versioned inside this repository.

## What the evaluator can verify

- `/pesquisar` runs the required research pass across arXiv, Hacker News, and Grok.
- `/wiki` turns recent local research into a compact knowledge note.
- `/fontes` returns the source trail for the latest or matching topic.
- `/repo` runs the GitHub and Repomix viability lab.
- `/reset` resets the active chat/session boundary without deleting the persistent wiki.

## Better setup

### 1. Prerequisites

- Node.js 20+ with npm
- Claude Code installed if you want to exercise `NAMASTEX_MODE=real`
- Omni and Genie available locally only for the live bridge path

### 2. Install Node dependencies

```bash
npm install
```

### 3. Bootstrap Genie and Omni worktrees

If you already cloned `genie/` and `omni/` beside the project, keep them as they are.

If not, bootstrap both local dependencies in one step:

```bash
GENIE_REPO_URL=<genie-repo-url> OMNI_REPO_URL=<omni-repo-url> npm run deps:bootstrap
```

Optional refs:

```bash
GENIE_REPO_REF=<branch-or-tag> OMNI_REPO_REF=<branch-or-tag> npm run deps:bootstrap
```

The script only clones missing directories and leaves existing local worktrees untouched.

### 4. Load the local environment

The repository ships with a mock-first environment file. It does not require secrets.

```bash
cp .env.example .env
set -a
source .env
set +a
```

### 5. Run the reproducible reviewer path

```bash
npm run seed:mock
npm run demo:mock
```

That path is deterministic, uses local fixtures, and exercises the full command surface without
touching real providers.

### 6. Try individual commands

Deterministic local workflow:

```bash
npm run local:turn -- "/pesquisar agentes de whatsapp"
npm run local:turn -- "/wiki agentes"
npm run local:turn -- "/fontes agentes"
npm run local:turn -- "/repo Bssn01/NamastexChallenge"
```

CLI wrapper:

```bash
npm run cli -- "/pesquisar agentes de whatsapp com arxiv hackernews grok"
```

Omni turn simulation without sending WhatsApp messages:

```bash
NAMASTEX_OMNI_DELIVERY=stdout npm run omni:turn -- "/pesquisar agentes de whatsapp"
```

### 7. Run the verification suite

```bash
npm run lint
npm run typecheck
npm test
```

## Runtime modes

- `NAMASTEX_MODE=mock`: fully local fixtures, no secrets required
- `NAMASTEX_MODE=dev`: live-friendly config, but still defaults to the local executor
- `NAMASTEX_MODE=real`: Omni turn wrapper delegates to Claude Code unless overridden

Executor selection:

- `mock` and `dev` default to `NAMASTEX_TURN_EXECUTOR=local`
- `real` defaults to `NAMASTEX_TURN_EXECUTOR=claude`
- set `NAMASTEX_TURN_EXECUTOR=local` if you want to debug the workflow directly in any mode

## Live bridge path

The real WhatsApp bridge entrypoint is:

```bash
npm run omni:turn -- "$OMNI_MESSAGE"
```

When `NAMASTEX_MODE=real`, the wrapper calls Claude Code with `CLAUDE.md`. Claude then runs the
deterministic workflow exactly once through:

```bash
npm run local:turn -- --json "$OMNI_MESSAGE"
```

When `OMNI_INSTANCE` and `OMNI_CHAT` are present, each reply chunk is delivered with `omni say`
and the round is closed with `omni done`. For dry runs, keep
`NAMASTEX_OMNI_DELIVERY=stdout`.

Suggested local bridge wiring:

```bash
genie dir add namastex-research --dir /path/to/NamastexAgentChallenge
omni connect <instance-id> namastex-research --reply-filter filtered
GENIE_EXECUTOR=tmux genie serve start
```

Recommended Genie setting:

```bash
export GENIE_EXECUTOR=tmux
```

That avoids the SDK executor path that can overwrite the entry `mcpServers` block with
`genie-omni-tools`.

## External integrations

### Claude Code

Default path:

1. Sign in through Claude Code login.
2. Leave `ANTHROPIC_API_KEY` unset for interactive local use.

Optional headless path:

1. Export `ANTHROPIC_API_KEY`.
2. Keep the key out of the repository.

### Grok

The synthesis layer supports either OpenRouter or xAI.

- `OPENROUTER_API_KEY`
- `XAI_API_KEY`
- `GROK_MODEL` defaults to `x-ai/grok-4.1-fast`

### Hacker News

Community signal comes from the public Algolia-backed Hacker News API, so no authentication is
required.

- `HACKERNEWS_API_BASE` defaults to `https://hn.algolia.com/api/v1`
- `HACKERNEWS_USER_AGENT` defaults to `NamastexChallenge/0.1.0`

### GitHub

Use a fine-grained PAT from [github.com/settings/tokens](https://github.com/settings/tokens) if
you want live `/repo` validation.

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

Recommended minimum scopes:

- Metadata: read
- Contents: read
- Issues: read

## Project layout

- `src/`: project-owned adapters, workflow, runtime, config, and store
- `scripts/`: local entrypoints for demos, Omni turns, and seeding
- `tests/`: node-test coverage for workflow, Omni payload handling, and fixtures
- `fixtures/mock/`: deterministic data used in mock mode
- `genie/` and `omni/`: local external dependencies used by the live bridge, ignored by this repo

## Notes

- Do not commit real tokens or refreshed secrets.
- Local store files are written into `data/`, which is ignored.
- The project-owned logic lives in this repository; `genie/` and `omni/` stay outside the
  versioned scope of the submission.
