#!/bin/bash
set -euo pipefail

if [ "$(id -u)" = "0" ]; then
  mkdir -p /home/appuser/.genie /home/appuser/.claude /home/appuser/.codex /workspace/app/data
  rm -f /home/appuser/.genie/serve.pid
  rm -rf /home/appuser/.genie/state

  CLAUDE_BIN="/root/.bun/install/global/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"
  if ! command -v claude >/dev/null 2>&1 && [ -f "$CLAUDE_BIN" ]; then
    ln -sf "$CLAUDE_BIN" /usr/local/bin/claude
  fi

  chown -R appuser:appuser /home/appuser /workspace/app/data
  exec gosu appuser "$0" "$@"
fi

export HOME=/home/appuser
cd /workspace/app

mkdir -p "$HOME/.genie/agents/namastex-research" "$HOME/.claude/projects" "$HOME/.codex"
cp /workspace/app/agents/namastex-research/AGENTS.md "$HOME/.genie/agents/namastex-research/AGENTS.md"
cp /workspace/app/agents/namastex-research/SOUL.md "$HOME/.genie/agents/namastex-research/SOUL.md"
cp /workspace/app/agents/namastex-research/HEARTBEAT.md "$HOME/.genie/agents/namastex-research/HEARTBEAT.md"
cp /workspace/app/CLAUDE.md "$HOME/.genie/agents/namastex-research/CLAUDE.md"

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  CLAUDE_PROVIDER_JSON='"claude": { "apiKey": "'"${ANTHROPIC_API_KEY}"'", "model": "claude-haiku-4-5-20251001" }'
  echo "[entrypoint] Claude auth mode: API key (Anthropic)."
else
  CLAUDE_PROVIDER_JSON='"claude": { "model": "claude-sonnet-4-6" }'
  echo "[entrypoint] Claude auth mode: Claude Code session/token."
fi

cat > "$HOME/.genie/config.json" <<EOF
{
  "version": 2,
  "database": { "url": "${DATABASE_URL}" },
  "omni": {
    "apiUrl": "${OMNI_API_URL}",
    "apiKey": "${OMNI_API_KEY}",
    "defaultInstanceName": "${OMNI_DEFAULT_INSTANCE_NAME}"
  },
  "providers": {
    ${CLAUDE_PROVIDER_JSON}
  }
}
EOF

if [ ! -f "$HOME/.claude/settings.json" ]; then
  cat > "$HOME/.claude/settings.json" <<'EOF'
{
  "theme": "dark",
  "hasCompletedOnboarding": true,
  "hasDismissedFirstMessageWarning": true,
  "skipDangerousModePermissionPrompt": true
}
EOF
fi

write_provider_status() {
  local claude_installed=false
  local codex_installed=false
  local genie_installed=false
  local omni_installed=false
  local openrouter_configured=false
  local moonshot_configured=false
  local anthropic_configured=false
  local xai_configured=false
  local kimi_configured=false

  command -v claude >/dev/null 2>&1 && claude_installed=true
  command -v codex >/dev/null 2>&1 && codex_installed=true
  command -v genie >/dev/null 2>&1 && genie_installed=true
  command -v omni >/dev/null 2>&1 && omni_installed=true
  [ -n "${OPENROUTER_API_KEY:-}" ] && openrouter_configured=true
  [ -n "${MOONSHOT_API_KEY:-}" ] && moonshot_configured=true
  [ -n "${ANTHROPIC_API_KEY:-}" ] && anthropic_configured=true
  [ -n "${XAI_API_KEY:-}" ] && xai_configured=true
  if [ "$openrouter_configured" = true ] || [ "$moonshot_configured" = true ]; then
    kimi_configured=true
  fi

  jq -n \
    --arg generatedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --argjson genieInstalled "$genie_installed" \
    --argjson omniInstalled "$omni_installed" \
    --argjson claudeInstalled "$claude_installed" \
    --argjson codexInstalled "$codex_installed" \
    --argjson openrouterConfigured "$openrouter_configured" \
    --argjson moonshotConfigured "$moonshot_configured" \
    --argjson anthropicConfigured "$anthropic_configured" \
    --argjson xaiConfigured "$xai_configured" \
    --argjson kimiConfigured "$kimi_configured" \
    '{
      generatedAt: $generatedAt,
      mode: "docker",
      tools: {
        genie: { installed: $genieInstalled },
        omni: { installed: $omniInstalled },
        claude: { installed: $claudeInstalled },
        codex: { installed: $codexInstalled },
        docker: { installed: false, detail: "host-only" }
      },
      apiProviders: {
        kimiConfigured: $kimiConfigured,
        openrouterConfigured: $openrouterConfigured,
        moonshotConfigured: $moonshotConfigured,
        anthropicConfigured: $anthropicConfigured,
        xaiConfigured: $xaiConfigured
      }
    }' > /workspace/app/data/provider-status.json

  echo "[entrypoint] Provider status: claude=${claude_installed}, codex=${codex_installed}, kimi=${kimi_configured}."
  local selected_providers="${NAMASTEX_LLM_PRIMARY:-},${NAMASTEX_LLM_FALLBACKS:-}"
  if [[ "$selected_providers" == *claude-cli* ]] && [ "$claude_installed" != true ]; then
    echo "[entrypoint] Claude CLI is selected but missing. Rebuild the genie image or use npm run auth:claude -- --mode docker on the host."
  fi
  if [[ "$selected_providers" == *codex-cli* ]] && [ "$codex_installed" != true ]; then
    echo "[entrypoint] Codex CLI is selected but missing. Rebuild the genie image or use npm run auth:codex -- --mode docker on the host."
  fi
  if [[ "$selected_providers" == *kimi* ]] && [ "$kimi_configured" != true ]; then
    echo "[entrypoint] Kimi is selected but no OpenRouter/Moonshot key is configured. Run npm run auth:kimi on the host."
  fi
}

write_provider_status

echo "[entrypoint] Waiting for Omni at ${OMNI_API_URL}..."
until curl -sf "${OMNI_API_URL}/api/v2/health" >/dev/null; do
  sleep 2
done
echo "[entrypoint] Omni is healthy."

echo "[entrypoint] Authenticating Omni CLI..."
omni auth login --api-url "${OMNI_API_URL}" --api-key "${OMNI_API_KEY}" || true

INSTANCE_ID=$(omni instances list --json 2>/dev/null | jq -r \
  --arg name "${OMNI_DEFAULT_INSTANCE_NAME}" '.[] | select(.name==$name) | .id' || true)
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "null" ]; then
  echo "[entrypoint] Creating WhatsApp instance ${OMNI_DEFAULT_INSTANCE_NAME}..."
  omni instances create --channel whatsapp-baileys --name "${OMNI_DEFAULT_INSTANCE_NAME}" --json || true
  INSTANCE_ID=$(omni instances list --json 2>/dev/null | jq -r \
    --arg name "${OMNI_DEFAULT_INSTANCE_NAME}" '.[] | select(.name==$name) | .id' || true)
fi
echo "[entrypoint] Omni instance: ${INSTANCE_ID}"

if [ -n "${OMNI_ACCESS_MODE:-}" ] && [ -n "$INSTANCE_ID" ]; then
  omni access mode "$INSTANCE_ID" "${OMNI_ACCESS_MODE}" || true
fi

if [ "${OMNI_ACCESS_MODE:-}" = "allowlist" ] && [ -n "${OMNI_ALLOW_PHONES:-}" ]; then
  IFS=',' read -r -a ALLOW_PHONES <<< "${OMNI_ALLOW_PHONES}"
  for raw_phone in "${ALLOW_PHONES[@]}"; do
    phone="$(echo "$raw_phone" | xargs)"
    if [ -n "$phone" ]; then
      omni access create \
        --type allow \
        --instance "$INSTANCE_ID" \
        --phone "$phone" \
        --reason "Bootstrap allowlist rule from OMNI_ALLOW_PHONES" \
        --action allow >/dev/null || true
    fi
  done
fi

echo "[entrypoint] Starting Genie..."
genie serve &
GENIE_PID=$!

echo "[entrypoint] Waiting for Genie pgserve..."
until [ -f "$HOME/.genie/pgserve.port" ]; do
  sleep 2
done
sleep 5

AGENT_DIR="$HOME/.genie/agents/namastex-research"
if ! genie agent dir 2>/dev/null | grep -q "namastex-research"; then
  echo "[entrypoint] Registering Genie agent..."
  genie agent register namastex-research --dir "$AGENT_DIR" --global --no-interactive || true
fi

if [ -n "$INSTANCE_ID" ]; then
  NATS_PROVIDER=$(omni providers list --json 2>/dev/null | jq -r \
    '.[] | select(.name=="nats-genie-namastex-research") | .id' || true)
  if [ -z "$NATS_PROVIDER" ] || [ "$NATS_PROVIDER" = "null" ]; then
    echo "[entrypoint] Connecting Omni instance to Genie via NATS..."
    omni connect "$INSTANCE_ID" namastex-research \
      --nats-url nats://nats:4222 \
      --mode turn-based || true
  fi
fi

echo "=== Namastex bootstrap OK ==="
echo "Pair WhatsApp with: docker compose exec -u appuser genie omni instances qr ${INSTANCE_ID} --watch"

wait "$GENIE_PID"
