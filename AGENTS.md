# NamastexAgentChallenge

## Agents

This project is managed by Genie CLI.

The WhatsApp-facing Genie agent should follow `CLAUDE.md` and delegate inbound turns to:

```bash
npm run local:turn -- --json "$OMNI_MESSAGE"
```

## Conventions

- Follow existing code style and patterns
- Write tests for new functionality
- Use conventional commits
