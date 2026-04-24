import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { StringCodec, connect } from 'nats';

const execFile = promisify(execFileCallback);
const sc = StringCodec();

type Env = NodeJS.ProcessEnv;

function getEnv(key: string, fallback: string, env: Env): string {
  return env[key] || fallback;
}

async function runOmniTurn(command: string, env: Env): Promise<void> {
  const repoRoot = env.NAMASTEX_REPO_ROOT ? resolve(env.NAMASTEX_REPO_ROOT) : process.cwd();
  await execFile('npm', ['run', 'omni:turn', '--', command], {
    cwd: repoRoot,
    env: { ...env, NAMASTEX_OMNI_DELIVERY: 'omni' },
  });
}

async function main(): Promise<void> {
  const env = process.env;
  const natsUrl = getEnv('NATS_URL', 'nats://localhost:4222', env);
  const subject = getEnv('BRIDGE_SUBJECT', 'namastex.turn', env);

  const nc = await connect({ servers: natsUrl });
  console.log(`Bridge connected to ${nc.getServer()} on subject ${subject}`);

  const sub = nc.subscribe(subject, { queue: 'namastex-bridge' });

  for await (const msg of sub) {
    const text = sc.decode(msg.data);
    console.log(`Received: ${text.slice(0, 120)}`);
    try {
      await runOmniTurn(text, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Turn failed: ${message}`);
    }
  }

  await nc.drain();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
