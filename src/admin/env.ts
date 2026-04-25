import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { findMissingConfig, loadConfig, parseDotenv } from '../config.js';
import type { AppConfig } from '../types.js';

const SECRET_PATTERN = /(TOKEN|KEY|PASSWORD|SECRET|OAUTH|DATABASE_URL|API_URL)/i;

export interface AdminConfigSnapshot {
  repoRoot: string;
  missing: string[];
  values: {
    storeDriver: AppConfig['storeDriver'];
    storePath: string;
    storeOutboxPath: string;
    databaseUrlConfigured: boolean;
    primaryProvider: string;
    fallbackProviders: string[];
    omniDefaultInstanceName?: string;
    omniAccessMode?: string;
    allowPhonesConfigured: boolean;
    conversationSource: AppConfig['conversationSource'];
  };
  secrets: Record<string, boolean>;
  env: Record<string, string>;
}

export function isSecretKey(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

export function redactValue(key: string, value: string | undefined): string {
  if (!value) return '';
  if (!isSecretKey(key)) return value;
  return value.length <= 8 ? 'configured' : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function redactEnv(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, redactValue(key, value)]),
  );
}

export function secretPresence(values: Record<string, string>): Record<string, boolean> {
  const keys = [
    'GITHUB_TOKEN',
    'OMNI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENROUTER_API_KEY',
    'MOONSHOT_API_KEY',
    'XAI_API_KEY',
    'DATABASE_URL',
    'NAMASTEX_DATABASE_URL',
  ];
  return Object.fromEntries(keys.map((key) => [key, Boolean(values[key])]));
}

export async function readEnvValues(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const envPath = resolve(repoRoot, '.env');
  const fileValues = existsSync(envPath) ? parseDotenv(await readFile(envPath, 'utf8')) : {};
  return {
    ...fileValues,
    ...Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  };
}

export async function loadAdminConfigSnapshot(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminConfigSnapshot> {
  const values = await readEnvValues(repoRoot, env);
  const config = loadConfig(
    { ...values, NAMASTEX_REPO_ROOT: values.NAMASTEX_REPO_ROOT || repoRoot },
    {
      allowPartial: true,
    },
  );
  return {
    repoRoot,
    missing: findMissingConfig(config),
    values: {
      storeDriver: config.storeDriver,
      storePath: config.storePath,
      storeOutboxPath: config.storeOutboxPath,
      databaseUrlConfigured: Boolean(config.databaseUrl),
      primaryProvider: config.llm.primary,
      fallbackProviders: config.llm.fallbacks,
      omniDefaultInstanceName: values.OMNI_DEFAULT_INSTANCE_NAME,
      omniAccessMode: values.OMNI_ACCESS_MODE,
      allowPhonesConfigured: Boolean(values.OMNI_ALLOW_PHONES),
      conversationSource: config.conversationSource,
    },
    secrets: secretPresence(values),
    env: redactEnv(values),
  };
}

export async function upsertEnvValue(envPath: string, key: string, value: string): Promise<void> {
  const existing = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  let updated = false;
  const nextLines = lines.map((line) => {
    if (line.trimStart().startsWith('#')) return line;
    const separator = line.indexOf('=');
    if (separator < 0) return line;
    if (line.slice(0, separator).trim() !== key) return line;
    updated = true;
    return `${key}=${value}`;
  });
  if (!updated) {
    if (nextLines.length > 0 && nextLines.at(-1) !== '') nextLines.push('');
    nextLines.push(`${key}=${value}`);
  }
  const tempPath = `${envPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${nextLines.join('\n').replace(/\n*$/, '')}\n`, 'utf8');
  await rename(tempPath, envPath);
}
