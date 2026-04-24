# NamastexAgentChallenge

## Agents

This project is managed by Genie CLI.

The WhatsApp-facing Genie agent should follow `CLAUDE.md` and delegate inbound turns to:

```bash
cd /Users/bassani/Desktop/NamastexChallenge
npm run local:turn -- --json "<user-message>"
```

In Genie SDK bridge mode the prompt text is the WhatsApp message. Do not rely on
`$OMNI_MESSAGE`; it may be only the provider message id.

In Genie tmux/WhatsApp mode, parse the JSON stdout, send each `chunks[]` item
with `omni say "..."`, and finish the turn with `omni done`.

## Conventions

- Follow existing code style and patterns
- Write tests for new functionality
- Use conventional commits
