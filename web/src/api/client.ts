// ZWUI-004: typed API client. Shapes mirror docs/baseline/api-contracts.md
// and fixtures/api-samples.json. Errors carry status + code for the UI to
// branch on (401 → token prompt, 503 DB_MISSING → degraded banner, …).

export class ApiError extends Error {
  status: number;
  code?: string;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.code = (payload as { code?: string })?.code;
    this.payload = payload;
  }
}

export type Health = {
  ok: boolean;
  runtime?: string;
  cli: { entry: string; present: boolean };
  cliRuntime?: { executable: string; present: boolean; isExplicit: boolean; warning?: string | null };
  db: { path: string; present: boolean; driver?: string };
  providerConfigured: boolean;
  workspaceRoot: string;
  activeJobs: number;
  maxJobs: number;
  authRequired: boolean;
};

export type AppConfig = {
  authRequired: boolean;
  workspaceRoot: string;
  allowedRoots: string[];
  modes: string[];
  defaultMode: string;
  cliPresent: boolean;
  providerConfigured: boolean;
};

export type ModelInfo = {
  ref: string;
  provider: string;
  providerName: string;
  model: string;
  isDefault: boolean;
};

export type ProjectRoots = { roots: { path: string; projects: string[] }[] };

export type SkillInfo = { name: string; description: string; scope: string };
export type CommandInfo = { name: string; description: string; scope: string };

export type SessionInfo = {
  id: string;
  title: string;
  directory: string;
  taskType?: string;
  createdAt: number;
  updatedAt: number;
  goal?: { objective: string; status: string; tokensUsed: number; timeUsedSeconds: number; updatedAt: number } | null;
};

export type ToolCard = { name: string; status: string; detail: string };
export type FileCard = { mime: string; url: string; size: number | null; storageKind: string };
// Desktop timeline separators interleaved with turns (model switches,
// context compactions, session forks, goal-verification marks).
export type TimelineEvent = { kind: string; label: string; detail: string };

export type TranscriptTurn = {
  /** message id — stable key for incremental appends */
  id?: string;
  role: string;
  text: string;
  reasoning?: string;
  tokens?: number;
  timeline?: TimelineEvent[];
  tools?: ToolCard[];
  files?: FileCard[];
  /** raw provider/CLI error when the turn failed — shown collapsed, not inline */
  error?: string | null;
  /** wall-clock duration of the whole agentic turn (turn_usage), when it ended */
  durationMs?: number | null;
  /** message creation time (epoch ms) — byline timestamps */
  createdAt?: number | null;
  /** assistant message still streaming from another writer */
  incomplete?: boolean;
};

export type SessionDetail = {
  session: SessionInfo;
  transcript: TranscriptTurn[];
  total: number;
  hasMore: boolean;
  /** token sum over ALL messages of the session — independent of pagination */
  tokensTotal?: number | null;
  /** a turn is running in this session from any writer (desktop/CLI/web) */
  runActive?: boolean;
  /** when that externally-running turn started (ms epoch), for the live timer */
  runStartedAt?: number | null;
};

export type JobStatus = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timeout";
  sessionId: string | null;
  cwd: string;
  mode: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  error: string | null;
  timedOut: boolean;
};

export type ChatAccepted = {
  jobId: string;
  sessionId: string | null;
  cwd: string;
  mode: string;
  model: string | null;
  replayed?: boolean;
};

export type GitHubCapability = { enabled: boolean; tokenPresent: boolean; apiHost: string; allowlist: string[] };
export type GitHubIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  isPR: boolean;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  body: string;
  htmlUrl: string;
  comments: number;
  labels: { name: string; color: string | null }[];
  assignees: string[];
  milestone: { title: string; dueOn: string | null } | null;
};
export type GitHubComment = {
  id: number;
  author: string | null;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
  htmlUrl: string;
};

export class ApiClient {
  private getToken: () => string;
  private baseUrl: string;
  constructor(getToken: () => string, baseUrl = "") {
    this.getToken = getToken;
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as Record<string, string>) };
    const token = this.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(this.baseUrl + path, { ...init, headers });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (payload as { error?: string })?.error || res.statusText, payload);
    return payload as T;
  }

  health() {
    return this.request<Health>("/api/health");
  }
  config() {
    return this.request<AppConfig>("/api/config");
  }
  models() {
    return this.request<{ models: ModelInfo[] }>("/api/models");
  }
  projects() {
    return this.request<ProjectRoots>("/api/projects");
  }
  createProject(name: string, rootIndex = 0) {
    return this.request<{ name: string; directory: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, rootIndex }),
    });
  }
  sessions(cwd: string) {
    return this.request<{ cwd: string; sessions: SessionInfo[] }>(
      `/api/sessions?cwd=${encodeURIComponent(cwd)}`
    );
  }
  session(id: string, limit = 5, offset = 0) {
    return this.request<SessionDetail>(`/api/sessions/${id}?limit=${limit}&offset=${offset}`);
  }
  skills() {
    return this.request<{ skills: SkillInfo[] }>("/api/skills");
  }
  commands(cwd: string) {
    return this.request<{ commands: CommandInfo[] }>(`/api/commands?cwd=${encodeURIComponent(cwd)}`);
  }
  upload(name: string, data: string) {
    return this.request<{ path: string; name: string; size: number }>("/api/upload", {
      method: "POST",
      body: JSON.stringify({ name, data }),
    });
  }
  chat(input: { text: string; sessionId?: string | null; cwd?: string; mode?: string; model?: string; attachments?: string[]; requestId: string }) {
    return this.request<ChatAccepted>("/api/chat", { method: "POST", body: JSON.stringify(input) });
  }
  job(jobId: string) {
    return this.request<JobStatus>(`/api/jobs/${jobId}`);
  }
  cancel(jobId: string) {
    return this.request<{ canceled: boolean }>(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  }
  async sseTicket(jobId: string): Promise<string> {
    const r = await this.request<{ ticket: string }>("/api/sse-ticket", {
      method: "POST",
      body: JSON.stringify({ jobId }),
    });
    return r.ticket;
  }
  githubCapability() {
    return this.request<GitHubCapability>("/api/github/capability");
  }
  githubIssue(owner: string, repo: string, number: number, opts: { refresh?: boolean } = {}) {
    return this.request<{ issue: GitHubIssue; cached: boolean }>(
      `/api/github/issues/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}${opts.refresh ? "?refresh=1" : ""}`
    );
  }
  githubComments(owner: string, repo: string, number: number, page = 1) {
    return this.request<{ comments: GitHubComment[]; page: number; hasMore: boolean }>(
      `/api/github/issues/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}/comments?page=${page}`
    );
  }
  uploadUrl(name: string) {
    return `/api/uploads/${encodeURIComponent(name)}`;
  }
}
