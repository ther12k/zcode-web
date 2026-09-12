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

export type SessionInfo = {
  id: string;
  title: string;
  directory: string;
  taskType?: string;
  createdAt: number;
  updatedAt: number;
};

export type ToolCard = { name: string; status: string; detail: string };
export type FileCard = { mime: string; url: string; size: number | null; storageKind: string };

export type TranscriptTurn = {
  role: string;
  text: string;
  tools?: ToolCard[];
  files?: FileCard[];
};

export type SessionDetail = {
  session: SessionInfo;
  transcript: TranscriptTurn[];
  total: number;
  hasMore: boolean;
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
  uploadUrl(name: string) {
    return `/api/uploads/${encodeURIComponent(name)}`;
  }
}
