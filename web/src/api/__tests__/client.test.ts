// ZWUI-058: API client contract tests — auth header injection, typed errors,
// and query encoding. The client is the only fetch boundary; these tests pin
// its wire behavior so UI regressions can't hide transport bugs.
import { describe, it, expect, afterEach, vi } from "vitest";
import { ApiClient, ApiError } from "../client";

const calls: { url: string; init?: RequestInit }[] = [];

function stubFetch(status: number, body: unknown, ok = status < 400) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      ok,
      headers: { "content-type": "application/json" },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient transport", () => {
  it("sends the bearer token when one is available", async () => {
    stubFetch(200, { ok: true });
    const client = new ApiClient(() => "tok-123");
    await client.health();
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-123");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("omits the auth header when no token is set", async () => {
    stubFetch(200, { ok: true });
    const client = new ApiClient(() => "");
    await client.health();
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("throws ApiError carrying status, server code, and payload", async () => {
    stubFetch(503, { error: "store unavailable", code: "DB_MISSING" });
    const client = new ApiClient(() => "t");
    const err = await client.sessions("/w").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe("DB_MISSING");
    expect(err.message).toBe("store unavailable");
    expect(err.payload).toEqual({ error: "store unavailable", code: "DB_MISSING" });
  });

  it("shows an HTTP-status message when the error body is not JSON (empty statusText)", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502, ok: false }));
    const client = new ApiClient(() => "t");
    const err = await client.config().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toBe("HTTP 502");
  });

  it("encodes the cwd query so paths survive (spaces, slashes)", async () => {
    stubFetch(200, { cwd: "/a b/c", sessions: [] });
    const client = new ApiClient(() => "");
    await client.sessions("/a b/c");
    expect(calls[0].url).toBe("/api/sessions?cwd=" + encodeURIComponent("/a b/c"));
  });

  it("encodes owner/repo path segments and page on comments", async () => {
    stubFetch(200, { comments: [], page: 2, hasMore: false });
    const client = new ApiClient(() => "");
    await client.githubComments("acme co", "tools", 7, 2);
    expect(calls[0].url).toBe(`/api/github/issues/${encodeURIComponent("acme co")}/tools/7/comments?page=2`);
  });

  it("passes the refresh flag on issue fetch", async () => {
    stubFetch(200, { issue: {}, cached: false });
    const client = new ApiClient(() => "");
    await client.githubIssue("acme", "tools", 9, { refresh: true });
    expect(calls[0].url).toBe("/api/github/issues/acme/tools/9?refresh=1");
  });

  it("sseTicket returns the ticket string", async () => {
    stubFetch(200, { ticket: "tkt_abc" });
    const client = new ApiClient(() => "t");
    await expect(client.sseTicket("job-1")).resolves.toBe("tkt_abc");
    expect(calls[0].url).toBe("/api/sse-ticket");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ jobId: "job-1" });
  });

  it("chat posts the full input payload", async () => {
    stubFetch(200, { jobId: "j1", sessionId: null, cwd: "/w", mode: "plan", model: null });
    const client = new ApiClient(() => "t");
    await client.chat({ text: "hi", requestId: "r1", cwd: "/w", mode: "plan", attachments: [] });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ text: "hi", requestId: "r1", cwd: "/w", mode: "plan", attachments: [] });
    expect(calls[0].init?.method).toBe("POST");
  });

  it("uploadUrl percent-encodes the file name", () => {
    const client = new ApiClient(() => "");
    expect(client.uploadUrl("my file.png")).toBe("/api/uploads/my%20file.png");
  });
});
