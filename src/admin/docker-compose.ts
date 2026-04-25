function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function dockerComposeShell(args: string[]): string {
  const quotedArgs = args.map(shellQuote).join(' ');
  const suffix = quotedArgs ? ` ${quotedArgs}` : '';
  return [
    'if docker compose version >/dev/null 2>&1; then',
    `docker compose${suffix};`,
    'elif command -v docker-compose >/dev/null 2>&1; then',
    `docker-compose${suffix};`,
    'else',
    'echo "Docker Compose v2 (`docker compose`) or docker-compose is required." >&2;',
    'exit 127;',
    'fi',
  ].join(' ');
}

export const DOCKER_COMPOSE_VERSION_CHECK = dockerComposeShell(['version']);
