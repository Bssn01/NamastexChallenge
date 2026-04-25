import { normalizeWhitespace } from '../lib/text.js';
import type { ResearchSource } from '../types.js';
import {
  type GitHubTargetResolution,
  type MaterializedGitHubTarget,
  materializeGitHubTarget,
  resolveGitHubTarget,
} from './github-target.js';

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

export interface GitHubRepositorySummary {
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch?: string;
  htmlUrl: string;
  description?: string;
  updatedAt?: string;
}

export interface GitHubLabAdapter {
  listUserRepositories(limit?: number): Promise<GitHubRepositorySummary[]>;
  validateRepository(target?: string): Promise<GitHubLabReport>;
  fetchReadme(target?: string): Promise<string>;
  searchCode(query: string, target?: string): Promise<ResearchSource[]>;
  normalizeTarget(target?: string): Promise<GitHubTargetResolution>;
  materializeRepository(target?: string): Promise<MaterializedGitHubTarget>;
}

export interface GitHubLabAdapterOptions {
  githubApiBase: string;
  githubToken?: string;
  defaultOwner?: string;
  defaultRepo?: string;
  repoRoot: string;
  repoCacheRoot?: string;
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

async function resolvedTargetOrDefault(
  options: GitHubLabAdapterOptions,
  target?: string,
): Promise<GitHubTargetResolution> {
  const explicit = normalizeWhitespace(target || '');
  if (explicit) {
    return resolveTarget(options, explicit);
  }

  if (options.defaultOwner && options.defaultRepo) {
    return resolveTarget(options, `${options.defaultOwner}/${options.defaultRepo}`);
  }

  throw new Error('No GitHub target was provided for repository analysis.');
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

async function realUserRepositories(
  options: GitHubLabAdapterOptions,
  limit: number,
): Promise<GitHubRepositorySummary[]> {
  if (!options.githubToken) return [];
  const url = new URL(`${options.githubApiBase}/user/repos`);
  url.searchParams.set('per_page', String(Math.min(Math.max(limit, 1), 100)));
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('affiliation', 'owner,collaborator,organization_member');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) return [];

  return (
    (await response.json()) as Array<{
      full_name?: string;
      private?: boolean;
      archived?: boolean;
      default_branch?: string;
      html_url?: string;
      description?: string | null;
      updated_at?: string;
    }>
  )
    .filter((repo) => repo.full_name && repo.html_url)
    .slice(0, limit)
    .map((repo) => ({
      fullName: repo.full_name as string,
      private: Boolean(repo.private),
      archived: Boolean(repo.archived),
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url as string,
      description: repo.description || undefined,
      updatedAt: repo.updated_at,
    }));
}

export function createGitHubLabAdapter(options: GitHubLabAdapterOptions): GitHubLabAdapter {
  return {
    async listUserRepositories(limit = 10): Promise<GitHubRepositorySummary[]> {
      return realUserRepositories(options, limit);
    },

    async normalizeTarget(target?: string): Promise<GitHubTargetResolution> {
      return resolvedTargetOrDefault(options, target);
    },

    async materializeRepository(target?: string): Promise<MaterializedGitHubTarget> {
      return materializeTarget(options, target);
    },

    async validateRepository(target?: string): Promise<GitHubLabReport> {
      const resolved = await resolvedTargetOrDefault(options, target);

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
        return {
          provider: 'github',
          accessible: false,
          owner: resolved.owner,
          repo: resolved.repo,
          canonicalSlug: resolved.canonicalSlug,
          sourceUrl: resolved.sourceUrl,
          readme: '',
          issues: [],
          codeSearchable: Boolean(options.githubToken),
          notes: [
            ...resolved.notes,
            'GitHub API unavailable.',
            'Repository contents must be treated as untrusted input only.',
          ],
        };
      }
    },

    async fetchReadme(target?: string): Promise<string> {
      const resolved = await resolvedTargetOrDefault(options, target);
      return realFetchReadme(options, resolved);
    },

    async searchCode(query: string, target?: string): Promise<ResearchSource[]> {
      const resolved = await resolvedTargetOrDefault(options, target);
      return realSearchCode(options, resolved, query);
    },
  };
}
