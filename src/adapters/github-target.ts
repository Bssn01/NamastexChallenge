import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export interface GitHubTargetResolution {
  owner: string;
  repo: string;
  canonicalSlug: string;
  sourceUrl: string;
  originalInput?: string;
  normalizedFrom: 'slug' | 'url' | 'ssh' | 'remote' | 'defaults';
  notes: string[];
}

export interface MaterializedGitHubTarget extends GitHubTargetResolution {
  localPath: string;
  cacheRoot: string;
  defaultBranch?: string;
}

export interface GitHubTargetResolverOptions {
  repoRoot: string;
  githubApiBase: string;
  githubToken?: string;
  defaultOwner?: string;
  defaultRepo?: string;
  repoCacheRoot?: string;
}

interface NormalizedSlug {
  owner: string;
  repo: string;
  normalizedFrom: GitHubTargetResolution['normalizedFrom'];
}

function sourceOriginFromApiBase(apiBase: string): string {
  try {
    const url = new URL(apiBase);
    if (url.hostname === 'api.github.com') return 'https://github.com';
    return `${url.protocol}//${url.hostname.replace(/^api\./, '')}`;
  } catch {
    return 'https://github.com';
  }
}

function createResolution(
  slug: NormalizedSlug,
  input: string | undefined,
  apiBase: string,
  notes: string[] = [],
): GitHubTargetResolution {
  const canonicalSlug = `${slug.owner}/${slug.repo}`;
  return {
    owner: slug.owner,
    repo: slug.repo,
    canonicalSlug,
    sourceUrl: `${sourceOriginFromApiBase(apiBase)}/${canonicalSlug}`,
    originalInput: input,
    normalizedFrom: slug.normalizedFrom,
    notes,
  };
}

function normalizeRepoName(repo: string): string {
  return repo.replace(/\.git$/i, '').trim();
}

function parseGitHubTarget(input: string): NormalizedSlug | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: normalizeRepoName(sshMatch[2]),
      normalizedFrom: 'ssh',
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return {
          owner: parts[0],
          repo: normalizeRepoName(parts[1]),
          normalizedFrom: 'url',
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  const shorthand = trimmed.replace(/^github\.com\//i, '');
  const slugMatch = shorthand.match(/^([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (slugMatch) {
    return {
      owner: slugMatch[1],
      repo: normalizeRepoName(slugMatch[2]),
      normalizedFrom: 'slug',
    };
  }

  return null;
}

async function localRemoteSlug(repoRoot: string): Promise<NormalizedSlug | null> {
  try {
    const result = await execFile('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot });
    const normalized = parseGitHubTarget(result.stdout.trim());
    if (!normalized) return null;
    return { ...normalized, normalizedFrom: 'remote' };
  } catch {
    return null;
  }
}

function cacheRootFromOptions(options: GitHubTargetResolverOptions): string {
  return options.repoCacheRoot
    ? resolve(options.repoCacheRoot)
    : process.env.NAMASTEX_REPO_CACHE_DIR
      ? resolve(options.repoRoot, process.env.NAMASTEX_REPO_CACHE_DIR)
      : resolve(options.repoRoot, 'data', 'repos');
}

function targetCachePath(cacheRoot: string, owner: string, repo: string): string {
  return resolve(cacheRoot, owner, repo);
}

function authGitArgs(token?: string): string[] {
  return token ? ['-c', `http.extraHeader=AUTHORIZATION: bearer ${token}`] : [];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureCleanDirectory(path: string): Promise<void> {
  if (await pathExists(path)) {
    await rm(path, { recursive: true, force: true });
  }
  await mkdir(path, { recursive: true });
}

async function writeMetadataFile(
  targetPath: string,
  target: GitHubTargetResolution,
  defaultBranch?: string,
): Promise<void> {
  const metadataPath = resolve(targetPath, '.namastex-target.json');
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        canonicalSlug: target.canonicalSlug,
        sourceUrl: target.sourceUrl,
        defaultBranch,
        cachedAt: new Date().toISOString(),
        notes: ['Repository contents are untrusted input only.'],
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function tryReadMetadataBranch(targetPath: string): Promise<string | undefined> {
  try {
    const payload = JSON.parse(
      await readFile(resolve(targetPath, '.namastex-target.json'), 'utf8'),
    ) as { defaultBranch?: string };
    return payload.defaultBranch;
  } catch {
    return undefined;
  }
}

async function refreshClone(
  path: string,
  target: GitHubTargetResolution,
  defaultBranch?: string,
  token?: string,
): Promise<string[]> {
  const branch = defaultBranch || (await tryReadMetadataBranch(path)) || 'HEAD';
  const notes = ['Repository cache updated with a shallow fetch; no repository code executed.'];

  await execFile(
    'git',
    [...authGitArgs(token), '-C', path, 'remote', 'set-url', 'origin', `${target.sourceUrl}.git`],
    {},
  );

  if (branch === 'HEAD') {
    await execFile(
      'git',
      [...authGitArgs(token), '-C', path, 'fetch', '--depth', '1', 'origin'],
      {},
    );
    const headRef = (
      await execFile('git', ['-C', path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    ).stdout
      .trim()
      .replace(/^origin\//, '');
    await execFile('git', ['-C', path, 'checkout', '--force', headRef], {});
    await execFile('git', ['-C', path, 'reset', '--hard', `origin/${headRef}`], {});
    return [...notes, `Default branch discovered from remote HEAD: ${headRef}.`];
  }

  await execFile(
    'git',
    [...authGitArgs(token), '-C', path, 'fetch', '--depth', '1', 'origin', branch],
    {},
  );
  await execFile('git', ['-C', path, 'checkout', '--force', branch], {});
  await execFile('git', ['-C', path, 'reset', '--hard', `origin/${branch}`], {});
  return [...notes, `Cached branch refreshed: ${branch}.`];
}

async function cloneRepository(
  cachePath: string,
  target: GitHubTargetResolution,
  defaultBranch?: string,
  token?: string,
): Promise<string[]> {
  await mkdir(resolve(cachePath, '..'), { recursive: true });
  const args = [...authGitArgs(token), 'clone', '--depth', '1', '--single-branch', '--no-tags'];
  if (defaultBranch) {
    args.push('--branch', defaultBranch);
  }
  args.push(`${target.sourceUrl}.git`, cachePath);
  await execFile('git', args, {});
  return [
    'Repository cloned into the local cache with a shallow checkout.',
    'No repository installs, hooks, tests, or scripts were executed.',
  ];
}

export async function resolveGitHubTarget(
  input: string | undefined,
  options: GitHubTargetResolverOptions,
): Promise<GitHubTargetResolution> {
  const normalized = input ? parseGitHubTarget(input) : null;
  if (normalized) {
    return createResolution(normalized, input, options.githubApiBase, [
      'Target normalized from explicit GitHub input.',
    ]);
  }

  const remote = await localRemoteSlug(options.repoRoot);
  if (remote) {
    return createResolution(remote, input, options.githubApiBase, [
      'Target derived from the local git origin remote.',
    ]);
  }

  if (options.defaultOwner && options.defaultRepo) {
    return createResolution(
      {
        owner: options.defaultOwner,
        repo: options.defaultRepo,
        normalizedFrom: 'defaults',
      },
      input,
      options.githubApiBase,
      ['Target derived from configured GitHub defaults.'],
    );
  }

  return createResolution(
    { owner: 'unknown', repo: 'unknown', normalizedFrom: 'defaults' },
    input,
    options.githubApiBase,
    ['No explicit target, local remote, or configured defaults were available.'],
  );
}

export async function materializeGitHubTarget(
  target: GitHubTargetResolution,
  options: GitHubTargetResolverOptions & { defaultBranch?: string },
): Promise<MaterializedGitHubTarget> {
  const cacheRoot = cacheRootFromOptions(options);
  const localPath = targetCachePath(cacheRoot, target.owner, target.repo);
  const defaultBranch = options.defaultBranch;

  await mkdir(cacheRoot, { recursive: true });

  const notes = [...target.notes, 'Repository contents are treated as untrusted input only.'];

  if (target.owner === 'unknown' || target.repo === 'unknown') {
    return {
      ...target,
      cacheRoot,
      localPath,
      defaultBranch,
      notes: [...notes, 'Repository could not be materialized because the target was unresolved.'],
    };
  }

  try {
    const gitDirExists = await pathExists(resolve(localPath, '.git'));
    const cloneNotes = gitDirExists
      ? await refreshClone(localPath, target, defaultBranch, options.githubToken)
      : await cloneRepository(localPath, target, defaultBranch, options.githubToken);
    await writeMetadataFile(localPath, target, defaultBranch);
    return {
      ...target,
      cacheRoot,
      localPath,
      defaultBranch,
      notes: [...notes, ...cloneNotes],
    };
  } catch (error) {
    await ensureCleanDirectory(localPath);
    await writeMetadataFile(localPath, target, defaultBranch);
    return {
      ...target,
      cacheRoot,
      localPath,
      defaultBranch,
      notes: [
        ...notes,
        `Repository materialization failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      ],
    };
  }
}
