import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadGitHubFixture } from '../fixtures.js';
import { normalizeWhitespace } from '../lib/text.js';
import type { ResearchSource, RuntimeMode } from '../types.js';

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
  notes: string[];
}

export interface GitHubLabAdapter {
  validateRepository(target?: string): Promise<GitHubLabReport>;
  fetchReadme(target?: string): Promise<string>;
  searchCode(query: string, target?: string): Promise<ResearchSource[]>;
}

export interface GitHubLabAdapterOptions {
  mode: RuntimeMode;
  fixturePath: string;
  githubApiBase: string;
  githubToken?: string;
  defaultOwner?: string;
  defaultRepo?: string;
  repoRoot: string;
}

function parseTarget(
  target?: string,
  fallbackOwner?: string,
  fallbackRepo?: string,
): { owner: string; repo: string } {
  if (target?.includes('/')) {
    const [owner, repo] = target.split('/', 2);
    return { owner, repo };
  }
  if (fallbackOwner && fallbackRepo) {
    return { owner: fallbackOwner, repo: fallbackRepo };
  }
  return { owner: 'unknown', repo: 'unknown' };
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
  owner: string,
  repo: string,
): Promise<string> {
  if (!options.githubToken) {
    return `GitHub token not configured for ${owner}/${repo}.`;
  }
  const response = await fetch(`${options.githubApiBase}/repos/${owner}/${repo}/readme`, {
    headers: {
      Authorization: `Bearer ${options.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    return `README unavailable for ${owner}/${repo}: ${response.status}`;
  }
  const payload = (await response.json()) as { content?: string; encoding?: string };
  if (!payload.content) return 'README is empty.';
  if (payload.encoding === 'base64') {
    return Buffer.from(payload.content, 'base64').toString('utf8');
  }
  return payload.content;
}

async function realSearchCode(
  options: GitHubLabAdapterOptions,
  owner: string,
  repo: string,
  query: string,
): Promise<ResearchSource[]> {
  if (!options.githubToken) return [];
  const url = new URL(`${options.githubApiBase}/search/code`);
  url.searchParams.set('q', `${query} repo:${owner}/${repo}`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) return [];
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
    async validateRepository(target?: string): Promise<GitHubLabReport> {
      if (options.mode !== 'real') {
        const fixture = await loadGitHubFixture(options.fixturePath);
        const { owner, repo } = parseTarget(target, fixture.owner, fixture.repo);
        return {
          provider: 'github',
          accessible: true,
          owner,
          repo,
          defaultBranch: fixture.defaultBranch,
          readme: fixture.readme,
          issues: fixture.issues,
          codeSearchable: fixture.codeSearchable,
          notes: ['Mock validation lab report loaded from fixtures.'],
        };
      }

      const slug =
        target ||
        (await localRemoteSlug(options.repoRoot)) ||
        `${options.defaultOwner || 'unknown'}/${options.defaultRepo || 'unknown'}`;
      const { owner, repo } = parseTarget(slug, options.defaultOwner, options.defaultRepo);

      try {
        const response = await fetch(`${options.githubApiBase}/repos/${owner}/${repo}`, {
          headers: {
            Authorization: `Bearer ${options.githubToken || ''}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
        if (!response.ok) {
          const readme = await realFetchReadme(options, owner, repo);
          return {
            provider: 'github',
            accessible: false,
            owner,
            repo,
            readme,
            issues: [],
            codeSearchable: false,
            notes: [`Repository lookup returned ${response.status}.`],
          };
        }
        const payload = (await response.json()) as { default_branch?: string; archived?: boolean };
        const readme = await realFetchReadme(options, owner, repo);
        const issuesResponse = options.githubToken
          ? await fetch(
              `${options.githubApiBase}/repos/${owner}/${repo}/issues?state=open&per_page=3`,
              {
                headers: {
                  Authorization: `Bearer ${options.githubToken}`,
                  Accept: 'application/vnd.github+json',
                  'X-GitHub-Api-Version': '2022-11-28',
                },
              },
            )
          : null;
        const issues = issuesResponse?.ok
          ? ((
              (await issuesResponse.json()) as Array<{
                title?: string;
                html_url?: string;
                state?: string;
              }>
            ).map((issue) => ({
              title: issue.title || 'Untitled issue',
              url: issue.html_url || '',
              state: issue.state === 'closed' ? 'closed' : 'open',
            })) as Array<{ title: string; url: string; state: 'open' | 'closed' }>)
          : [];

        return {
          provider: 'github',
          accessible: true,
          owner,
          repo,
          defaultBranch: payload.default_branch,
          readme,
          issues,
          codeSearchable: Boolean(options.githubToken),
          notes: ['Repository metadata fetched from GitHub API.'],
        };
      } catch {
        const fixture = await loadGitHubFixture(options.fixturePath);
        return {
          provider: 'github',
          accessible: false,
          owner,
          repo,
          defaultBranch: fixture.defaultBranch,
          readme: fixture.readme,
          issues: fixture.issues,
          codeSearchable: fixture.codeSearchable,
          notes: ['GitHub API unavailable, using local fixture fallback.'],
        };
      }
    },

    async fetchReadme(target?: string): Promise<string> {
      if (options.mode !== 'real') {
        const fixture = await loadGitHubFixture(options.fixturePath);
        return fixture.readme;
      }
      const slug =
        target ||
        (await localRemoteSlug(options.repoRoot)) ||
        `${options.defaultOwner || 'unknown'}/${options.defaultRepo || 'unknown'}`;
      const { owner, repo } = parseTarget(slug, options.defaultOwner, options.defaultRepo);
      return realFetchReadme(options, owner, repo);
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
      const slug =
        target ||
        (await localRemoteSlug(options.repoRoot)) ||
        `${options.defaultOwner || 'unknown'}/${options.defaultRepo || 'unknown'}`;
      const { owner, repo } = parseTarget(slug, options.defaultOwner, options.defaultRepo);
      return realSearchCode(options, owner, repo, query);
    },
  };
}
