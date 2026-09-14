// ZWUI-051: read-only GitHub issue reading service.
//
// Boundaries this module enforces:
//  - requests are constructed ONLY to the configured GitHub API base (never a
//    general URL proxy — the owner/repo/number path is validated and appended)
//  - credentials stay server-side (ZCODE_GITHUB_TOKEN); public issue reads
//    work without a token
//  - ETag conditional requests with a bounded in-memory cache; rate-limit
//    responses surface as a distinct error instead of being retried blindly
//  - an optional repository allowlist (ZCODE_GITHUB_REPOS="owner/repo:…")
//    scopes which repositories this deployment will expose at all

const GITHUB_API_DEFAULT = "https://api.github.com";
const CACHE_MAX = 300;
const cache = new Map(); // `${api}|${owner}/${repo}#${number}` -> { etag, issue, at }

export function githubCapability() {
  const token = githubToken();
  return {
    enabled: process.env.ZCODE_ENABLE_GITHUB !== "0",
    tokenPresent: Boolean(token),
    apiHost: apiHost(),
    allowlist: repoAllowlist(), // empty array = all repositories allowed
  };
}

function githubToken() {
  return (process.env.ZCODE_GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
}

// API base override — tests point this at a local fixture; GHES deployments
// point it at https://<host>/api/v3.
function apiBase() {
  return (process.env.ZCODE_GITHUB_API_BASE || GITHUB_API_DEFAULT).replace(/\/+$/, "");
}

function apiHost() {
  try {
    return new URL(apiBase()).host;
  } catch {
    return GITHUB_API_DEFAULT;
  }
}

function repoAllowlist() {
  return (process.env.ZCODE_GITHUB_REPOS || "")
    .split(/[:,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function repoAllowed(owner, repo) {
  const list = repoAllowlist();
  if (!list.length) return true;
  return list.includes(`${owner}/${repo}`);
}

// strict identity shapes — these values are concatenated into an API URL
export function validOwner(v) {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(v);
}
export function validRepo(v) {
  return /^[A-Za-z0-9._-]{1,100}$/.test(v);
}
export function validNumber(v) {
  return /^\d{1,10}$/.test(v) && Number(v) > 0;
}

export class GitHubError extends Error {
  constructor(code, status, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

function normalizeIssue(raw) {
  return {
    number: raw.number,
    title: String(raw.title || ""),
    state: raw.state === "closed" ? "closed" : "open",
    isPR: Boolean(raw.pull_request),
    author: raw.user?.login || null,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
    closedAt: raw.closed_at || null,
    body: typeof raw.body === "string" ? raw.body : "",
    htmlUrl: raw.html_url || (raw.pull_request ? raw.pull_request.html_url : "") || "",
    comments: Number(raw.comments) || 0,
    labels: (raw.labels || []).map((l) => ({ name: l.name || String(l), color: l.color || null })),
    assignees: (raw.assignees || []).map((a) => a.login),
    milestone: raw.milestone ? { title: raw.milestone.title, dueOn: raw.milestone.due_on } : null,
  };
}

function normalizeComment(raw) {
  return {
    id: raw.id,
    author: raw.user?.login || null,
    body: typeof raw.body === "string" ? raw.body : "",
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
    htmlUrl: raw.html_url || "",
  };
}

async function githubFetch(path, { etag } = {}) {
  const url = `${apiBase()}${path}`;
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "zcode-web",
  };
  const token = githubToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (etag) headers["if-none-match"] = etag;

  let res;
  try {
    res = await fetch(url, { headers, redirect: "follow" });
  } catch (e) {
    throw new GitHubError("GITHUB_UNREACHABLE", 502, `GitHub API unreachable: ${e.message}`);
  }
  if (res.status === 304) return { notModified: true, res };
  const remaining = res.headers.get("x-ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && remaining === "0") {
    const retryAfter = Number(res.headers.get("retry-after")) || Number(res.headers.get("x-ratelimit-reset")) || null;
    throw new GitHubError("RATE_LIMITED", 429, "GitHub API rate limit exhausted", { retryAfter });
  }
  if (res.status === 401) throw new GitHubError("ACCESS_DENIED", 401, "GitHub rejected the configured credentials");
  if (res.status === 404) throw new GitHubError("NOT_FOUND", 404, "Issue not found (or not accessible with the configured credentials)");
  if (res.status === 451) throw new GitHubError("BLOCKED", 451, "GitHub blocked this content for legal reasons");
  if (!res.ok) throw new GitHubError("GITHUB_ERROR", 502, `GitHub API error (${res.status})`);
  return { notModified: false, res };
}

export async function fetchIssue(owner, repo, number, { refresh = false } = {}) {
  if (!validOwner(owner) || !validRepo(owner ? repo : "") || !validNumber(number)) {
    throw new GitHubError("BAD_IDENTITY", 400, "Malformed repository or issue number");
  }
  if (!repoAllowed(owner, repo)) {
    throw new GitHubError("REPO_FORBIDDEN", 403, `Repository ${owner}/${repo} is not exposed by this deployment`);
  }
  const key = `${apiHost()}|${owner}/${repo}#${number}`;
  const cached = refresh ? null : cache.get(key);
  const { notModified, res } = await githubFetch(`/repos/${owner}/${repo}/issues/${number}`, { etag: cached?.etag });
  if (notModified && cached) return { issue: cached.issue, cached: true };
  const raw = await res.json();
  const issue = normalizeIssue(raw);
  const etag = res.headers.get("etag");
  if (etag) {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, { etag, issue, at: Date.now() });
  }
  return { issue, cached: false };
}

export async function fetchComments(owner, repo, number, { page = 1, perPage = 20 } = {}) {
  if (!validOwner(owner) || !validRepo(repo) || !validNumber(number)) {
    throw new GitHubError("BAD_IDENTITY", 400, "Malformed repository or issue number");
  }
  if (!repoAllowed(owner, repo)) {
    throw new GitHubError("REPO_FORBIDDEN", 403, `Repository ${owner}/${repo} is not exposed by this deployment`);
  }
  const p = Math.max(1, Math.min(Number(page) || 1, 100));
  const per = Math.max(1, Math.min(Number(perPage) || 20, 50));
  const { notModified, res } = await githubFetch(`/repos/${owner}/${repo}/issues/${number}/comments?page=${p}&per_page=${per}`);
  if (notModified) return { comments: [], page: p, hasMore: false };
  const raw = await res.json();
  // a full page hints there may be more; the Link header is authoritative
  const link = res.headers.get("link") || "";
  const hasMore = /rel="next"/.test(link) || (Array.isArray(raw) && raw.length >= per);
  return {
    comments: (Array.isArray(raw) ? raw : []).map(normalizeComment),
    page: p,
    hasMore,
  };
}
