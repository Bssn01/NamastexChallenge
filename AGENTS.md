# NamastexAgentChallenge

## Agents

This project is managed by Genie CLI.

The WhatsApp-facing Genie agent should follow `CLAUDE.md` and delegate inbound turns to:

```bash
cd /Users/bassani/Desktop/NamastexChallenge
npm run local:turn -- --json "<user-message>"
```

In Genie SDK bridge mode the prompt text is the WhatsApp message. Do not rely on `$OMNI_MESSAGE`; it may be only the provider message id.

In Genie tmux/WhatsApp mode, parse the JSON stdout, send each `chunks[]` item with `omni say "..."`, and finish the turn with `omni done`.

## Bridge paths

1. **Genie already configured** — Genie calls the wrapper local (`scripts/omni-turn.ts`).
2. **Without depending on a patched Genie** — Omni can use the repo-native bridge (`npm run bridge:omni`) which listens on NATS and delegates to `npm run omni:turn`.

## Conventions

- Follow existing code style and patterns
- Write tests for new functionality
- Use conventional commits
