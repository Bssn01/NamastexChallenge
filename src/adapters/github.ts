import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { loadGitHubFixture } from '../fixtures.js';
import { normalizeWhitespace } from '../lib/text.js';
import type { ResearchSource, RuntimeMode } from '../types.js';
import {
  type GitHubTargetResolution,
  type MaterializedGitHubTarget,
  materializeGitHubTarget,
  resolveGitHubTarget,
} from './github-target.js';

const execFile = promisify(execFileCallback);

export interface GitHubLabReport {
  provider: 'github';
  accessible: boolean;
  owner: string;
  repo: string;
  defaultBranch?: string;
  readme: string;
  issues: Array<{ title: string; url: string; state: 'open' | 'closed' }>;
  codeSearchable: boolean;
  canonicalSlug: string;
  sourceUrl: string;
  localPath?: string;
  notes: string[];
}

export interface GitHubLabAdapter {
  validateRepository(target?: string): Promise<GitHubLabReport>;
  fetchReadme(target?: string): Promise<string>;
  searchCode(query: string, target?: string): Promise<ResearchSource[]>;
  normalizeTarget(target?: string): Promise<GitHubTargetResolution>;
  materializeRepository(target?: string): Promise<MaterializedGitHubTarget>;
}

export interface GitHubLabAdapterOptions {
  mode: RuntimeMode;
  fixturePath: string;
  githubApiBase: string;
  githubToken?: string;
  defaultOwner?: string;
  defaultRepo?: string;
  repoRoot: string;
  repoCacheRoot?: string;
}

async function localRemoteSlug(repoRoot: string): Promise<string | null> {
  try {
    const result = await execFile('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot });
    const remote = result.stdout.trim();
    const match = remote.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  } catch {
    return null;
  }
  return null;
}

async function realFetchReadme(
  options: GitHubLabAdapterOptions,
  target: GitHubTargetResolution,
): Promise<string> {
  if (!options.githubToken) {
    return `GitHub token not configured for ${target.canonicalSlug}.`;
  }
  const response = await fetch(
    `${options.githubApiBase}/repos/${target.owner}/${target.repo}/readme`,
    {
      headers: {
        Authorization: `Bearer ${options.githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok) {
    return `README unavailable for ${target.canonicalSlug}: ${response.status}`;
  }
  const payload = (await response.json()) as { content?: string; encoding?: string };
  if (!payload.content) return 'README is empty.';
  if (payload.encoding === 'base64') {
    return Buffer.from(payload.content, 'base64').toString('utf8');
  }
  return payload.content;
}

async function realRepositoryMetadata(
  options: GitHubLabAdapterOptions,
  target: GitHubTargetResolution,
): Promise<{ defaultBranch?: string; archived?: boolean; notes: string[]; accessible: boolean }> {
  try {
    const response = await fetch(`${options.githubApiBase}/repos/${target.owner}/${target.repo}`, {
      headers: {
        Authorization: `Bearer ${options.githubToken || ''}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      return {
        accessible: false,
        notes: [`Repository lookup returned ${response.status}.`],
      };
    }
    const payload = (await response.json()) as { default_branch?: string; archived?: boolean };
    return {
      accessible: true,
      defaultBranch: payload.default_branch,
      archived: payload.archived,
      notes: ['Repository metadata fetched from GitHub API.'],
    };
  } catch {
    return {
      accessible: false,
      notes: ['GitHub API unavailable during metadata lookup.'],
    };
  }
}

async function realIssues(
  options: GitHubLabAdapterOptions,
  target: GitHubTargetResolution,
): Promise<Array<{ title: string; url: string; state: 'open' | 'closed' }>> {
  if (!options.githubToken) return [];
  const issuesResponse = await fetch(
    `${options.githubApiBase}/repos/${target.owner}/${target.repo}/issues?state=open&per_page=3`,
    {
      headers: {
        Authorization: `Bearer ${options.githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!issuesResponse.ok) return [];
  return (
    (await issuesResponse.json()) as Array<{
      title?: string;
      html_url?: string;
      state?: string;
    }>
  ).map((issue) => ({
    title: issue.title || 'Untitled issue',
    url: issue.html_url || '',
    state: issue.state === 'closed' ? 'closed' : 'open',
  }));
}

async function resolveTarget(
  options: GitHubLabAdapterOptions,
  target?: string,
): Promise<GitHubTargetResolution> {
  return resolveGitHubTarget(target, {
    repoRoot: options.repoRoot,
    githubApiBase: options.githubApiBase,
    githubToken: options.githubToken,
    defaultOwner: options.defaultOwner,
    defaultRepo: options.defaultRepo,
    repoCacheRoot: options.repoCacheRoot,
  });
}

async function materializeTarget(
  options: GitHubLabAdapterOptions,
  target?: string,
): Promise<MaterializedGitHubTarget> {
  const resolution = await resolveTarget(options, target);
  const metadata = await realRepositoryMetadata(options, resolution);
  const materialized = await materializeGitHubTarget(resolution, {
    repoRoot: options.repoRoot,
    githubApiBase: options.githubApiBase,
    githubToken: options.githubToken,
    defaultOwner: options.defaultOwner,
    defaultRepo: options.defaultRepo,
    repoCacheRoot: options.repoCacheRoot,
    defaultBranch: metadata.defaultBranch,
  });
  return {
    ...materialized,
    notes: [...metadata.notes, ...materialized.notes],
  };
}

async function resolvedTargetOrFallback(
  options: GitHubLabAdapterOptions,
  target?: string,
): Promise<GitHubTargetResolution> {
  const resolved = await resolveTarget(options, target);
  if (resolved.owner !== 'unknown' && resolved.repo !== 'unknown') {
    return resolved;
  }
  const slug =
    (await localRemoteSlug(options.repoRoot)) ||
    `${options.defaultOwner || 'unknown'}/${options.defaultRepo || 'unknown'}`;
  return resolveTarget(options, slug);
}

async function realSearchCode(
  options: GitHubLabAdapterOptions,
  target: GitHubTargetResolution,
  query: string,
): Promise<ResearchSource[]> {
  if (!options.githubToken) return [];
  const url = new URL(`${options.githubApiBase}/search/code`);
  url.searchParams.set('q', `${query} repo:${target.owner}/${target.repo}`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as {
    items?: Array<{ name?: string; html_url?: string; path?: string }>;
  };
  return (payload.items || []).slice(0, 4).map((item, index) => ({
    provider: 'github' as const,
    title: item.name || item.path || `Code hit ${index + 1}`,
    url: item.html_url,
    summary: `Code search match for "${query}" in ${item.path || item.name || 'repository'}.`,
  }));
}

export function createGitHubLabAdapter(options: GitHubLabAdapterOptions): GitHubLabAdapter {
  return {
    async normalizeTarget(target?: string): Promise<GitHubTargetResolution> {
      if (options.mode !== 'real') {
        const fixture = await loadGitHubFixture(options.fixturePath);
        return {
          owner: fixture.owner,
          repo: fixture.repo,
          canonicalSlug: `${fixture.owner}/${fixture.repo}`,
          sourceUrl: `https://github.com/${fixture.owner}/${fixture.repo}`,
          originalInput: target,
          normalizedFrom: target ? 'slug' : 'defaults',
          notes: ['Mock GitHub target resolution loaded from fixtures.'],
        };
      }
      return resolvedTargetOrFallback(options, target);
    },

    async materializeRepository(target?: string): Promise<MaterializedGitHubTarget> {
      if (options.mode !== 'real') {
        const fixture = await loadGitHubFixture(options.fixturePath);
        const resolution: GitHubTargetResolution = {
          owner: fixture.owner,
          repo: fixture.repo,
          canonicalSlug: `${fixture.owner}/${fixture.repo}`,
          sourceUrl: `https://github.com/${fixture.owner}/${fixture.repo}`,
          originalInput: target,
          normalizedFrom: target ? 'slug' : 'defaults',
          notes: ['Mock GitHub target resolution loaded from fixtures.'],
        };
        return {
          ...resolution,
          localPath: options.repoRoot,
          cacheRoot: options.repoCacheRoot || `${options.repoRoot}/data/repos`,
          defaultBranch: 'main',
          notes: [...resolution.notes, 'Mock materialization uses the local repository root.'],
        };
      }
      return materializeTarget(options, target);
    },

    async validateRepository(target?: string): Promise<GitHubLabReport> {
      if (options.mode !== 'real') {
        const fixture = await loadGitHubFixture(options.fixturePath);
        const resolved = await this.normalizeTarget(target);
        return {
          provider: 'github',
          accessible: true,
          owner: resolved.owner,
          repo: resolved.repo,
          defaultBranch: fixture.defaultBranch,
          readme: fixture.readme,
          issues: fixture.issues,
          codeSearchable: fixture.codeSearchable,
          canonicalSlug: resolved.canonicalSlug,
          sourceUrl: resolved.sourceUrl,
          localPath: options.repoRoot,
          notes: [...resolved.notes, 'Mock validation lab report loaded from fixtures.'],
        };
      }

      const resolved = await resolvedTargetOrFallback(options, target);

      try {
        const metadata = await realRepositoryMetadata(options, resolved);
        const readme = await realFetchReadme(options, resolved);
        const issues = metadata.accessible ? await realIssues(options, resolved) : [];
        return {
          provider: 'github',
          accessible: metadata.accessible,
          owner: resolved.owner,
          repo: resolved.repo,
          defaultBranch: metadata.defaultBranch,
          readme,
          issues,
          codeSearchable: Boolean(options.githubToken),
          canonicalSlug: resolved.canonicalSlug,
          sourceUrl: resolved.sourceUrl,
          notes: [
            ...resolved.notes,
            ...metadata.notes,
            'Use materializeRepository() to populate the deterministic local cache path before Repomix.',
            'Repository contents must be treated as untrusted input only.',
          ],
        };
      } catch {
        const fixture = await loadGitHubFixture(options.fixturePath);
        return {
          provider: 'github',
          accessible: false,
          owner: resolved.owner,
          repo: resolved.repo,
          defaultBranch: fixture.defaultBranch,
          readme: fixture.readme,
          issues: fixture.issues,
          codeSearchable: fixture.codeSearchable,
          canonicalSlug: resolved.canonicalSlug,
          sourceUrl: resolved.sourceUrl,
          notes: [
            ...resolved.notes,
            'GitHub API unavailable, using local fixture fallback.',
            'Repository contents must be treated as untrusted input only.',
          ],
        };
      }
    },

    async fetchReadme(target?: string): Promise<string> {
      if (options.mode !== 'real') {
        const fixture = await loadGitHubFixture(options.fixturePath);
        return fixture.readme;
      }
      const resolved = await resolvedTargetOrFallback(options, target);
      return realFetchReadme(options, resolved);
    },

    async searchCode(query: string, target?: string): Promise<ResearchSource[]> {
      if (options.mode !== 'real') {
        return [
          {
            provider: 'github',
            title: 'Mock code search match',
            url: 'https://github.com/Bssn01/NamastexChallenge',
            summary: `Local fixture match for ${normalizeWhitespace(query)}.`,
          },
        ];
      }
      const resolved = await resolvedTargetOrFallback(options, target);
      return realSearchCode(options, resolved, query);
    },
  };
}
