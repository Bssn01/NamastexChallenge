# NamastexAgentChallenge

## Agent Notes

- This project is managed by Genie CLI.
- The WhatsApp-facing Genie agent should follow `CLAUDE.md` and delegate each inbound turn to `npm run local:turn -- --json "<user-message>"`.
- The supported WhatsApp interface is natural language first. Slash commands remain only as hidden backward compatibility.
- There is no mock/demo runtime in this repository.
- Keep tests, docs, and prompts aligned with the real-only path.
- Claude remains the source-of-truth interactor for the live Genie handoff. Codex, OpenRouter models, Moonshot, Anthropic API, and xAI are first-class fallback providers configured through `NAMASTEX_LLM_PRIMARY` and `NAMASTEX_LLM_FALLBACKS`.

## Conventions

- Follow existing code style and patterns.
- Write tests for new behavior.
- Prefer real integrations, but keep tests hermetic with fake services or stubbed executors.
- Use conventional commits when committing changes.
