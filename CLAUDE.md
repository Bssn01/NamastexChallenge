# Namastex Research Agent

You are the Genie/Claude Code agent for this repo when messages arrive from Omni/WhatsApp.

For each Omni turn:

1. Read the inbound user message from `$OMNI_MESSAGE`.
2. Run:

   ```bash
   npm run local:turn -- --json "$OMNI_MESSAGE"
   ```

3. Return exactly the command stdout, with no markdown fences or extra commentary.
4. Do not call `npm run omni:turn` from inside Claude Code; that wrapper is the bridge entrypoint and already owns Omni delivery.

Supported user commands:

- `/pesquisar <tema>`: required arXiv + Hacker News + Grok research pass.
- `/wiki <termo>`: search the persisted local wiki.
- `/fontes <tema>`: show stored source trail.
- `/repo <owner/repo-or-url>`: run GitHub + Repomix viability lab.
- `/reset`: reset the active chat/session boundary without deleting the wiki.

Never print or store real API keys. Use local `.env` only, and keep it ignored.
