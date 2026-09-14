// ZWUI-051: read-only GitHub issue inspector.
//
// Correctness boundaries:
//  - a mention in chat is NOT a creation — until the lookup verifies, the
//    reference is shown as unverified; failures show "Unable to load", never
//    a fabricated card
//  - a closed state is displayed as-is; it is never presented as evidence
//    that anything was implemented or tested
//  - late responses must match the selected identity (host/owner/repo/number)
//    before they may paint — fetching A then selecting B never shows A in B's
//    header
//  - bodies and comments are EXTERNAL content rendered through the safe
//    markdown boundary; there is no commenting, closing or editing here
import { useEffect, useMemo, useState } from "react";
import { Check, CircleDot, Copy, ExternalLink, GitPullRequest, LoaderCircle, MessageSquare, Plus, RefreshCw, SquarePlus, XCircle } from "lucide-react";
import { IconButton, Markdown, relativeTime } from "../ui";
import { issueKey, type IssueIdentity } from "../lib/issueRefs";
import type { ApiClient, GitHubComment, GitHubIssue } from "../api/client";

type FetchState = {
  status: "loading" | "verified" | "error";
  issue: GitHubIssue | null; // last good copy (stale-while-error)
  error: string | null;
};

// client-side cache — the server additionally revalidates with ETags
const cache = new Map<string, GitHubIssue>();

/** Shared with the conversation-issues list (rows show title/state once verified). */
export function useGithubIssue(client: ApiClient, identity: IssueIdentity, initialRefresh = 0): FetchState & { refresh: () => void } {
  const [refreshNonce, setRefreshNonce] = useState(initialRefresh);
  const key = issueKey(identity);
  const [state, setState] = useState<FetchState>(() => ({
    status: cache.has(key) ? "verified" : "loading",
    issue: cache.get(key) ?? null,
    error: null,
  }));
  useEffect(() => {
    let alive = true;
    setState({
      status: cache.has(key) ? "verified" : "loading",
      issue: cache.get(key) ?? null,
      error: null,
    });
    void client.githubIssue(identity.owner, identity.repo, identity.number, { refresh: refreshNonce > 0 })
      .then(({ issue }) => {
        cache.set(key, issue);
        // identity re-checked AFTER the await: a late response for another
        // issue must never paint this pane
        if (alive && issueKey(identity) === key) setState({ status: "verified", issue, error: null });
      })
      .catch((e) => {
        if (alive && issueKey(identity) === key) setState({ status: "error", issue: cache.get(key) ?? null, error: e.message });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshNonce, client]);
  return { ...state, refresh: () => setRefreshNonce((n) => n + 1) };
}

// GFM task lists: our sanitizer strips <input>, so render read-only symbols
function taskListSymbols(md: string): string {
  return md
    .replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[ \][ \t]*/gm, "$1☐ ")
    .replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[xX]\][ \t]*/gm, "$1☑ ");
}

function rel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? relativeTime(ms) : "—";
}

export function IssueInspector({ client, identity, onAddToPrompt }: {
  client: ApiClient;
  identity: IssueIdentity;
  onAddToPrompt: (text: string) => void;
}) {
  const { status, issue, error, refresh } = useGithubIssue(client, identity, 0);
  const [copied, setCopied] = useState(false);
  const [comments, setComments] = useState<GitHubComment[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  const key = issueKey(identity);
  const loadComments = useMemo(() => async (page: number, replace: boolean) => {
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const out = await client.githubComments(identity.owner, identity.repo, identity.number, page);
      setComments((cur) => (replace ? out.comments : [...(cur || []), ...out.comments]));
      setHasMore(out.hasMore);
    } catch (e) {
      setCommentsError((e as Error).message);
    } finally {
      setCommentsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  useEffect(() => {
    setComments(null);
    setHasMore(false);
    setCommentsError(null);
    if (status === "verified") void loadComments(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, status === "verified"]);

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(`${identity.owner}/${identity.repo}#${identity.number}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  }

  if (status === "error" && !issue) {
    return (
      <div className="issue-inspector">
        <div className="issue-unavailable" role="status">
          <XCircle size={18} />
          <h3>#{identity.number} · {identity.owner}/{identity.repo}</h3>
          <p>Unable to load this reference — it may not exist, or this deployment lacks access to the repository.</p>
          <small>{error}</small>
          <button className="secondary-button" onClick={refresh}><RefreshCw size={12} />Retry</button>
        </div>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="issue-inspector">
        <div className="issue-loading" role="status">
          <LoaderCircle size={14} className="spin" />
          <span>Verifying {identity.owner}/{identity.repo}#{identity.number}…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="issue-inspector">
      <header className="issue-header">
        <div className="issue-state-line">
          {issue.isPR
            ? <span className="issue-badge pr"><GitPullRequest size={12} />Pull request</span>
            : <span className={`issue-badge ${issue.state}`}><CircleDot size={12} />{issue.state === "open" ? "Open" : "Closed"}</span>}
          <span className="issue-id">{identity.owner}/{identity.repo}#{issue.number}</span>
        </div>
        <h3 className="issue-title">{issue.title}</h3>
        <div className="issue-actions">
          <IconButton label="Refresh issue" onClick={refresh}><RefreshCw size={13} /></IconButton>
          {issue.htmlUrl && (
            <a className="icon-button" href={issue.htmlUrl} target="_blank" rel="noopener noreferrer" aria-label="Open on GitHub" title="Open on GitHub">
              <ExternalLink size={13} />
            </a>
          )}
          <IconButton label="Copy reference" onClick={() => void copyReference()}>{copied ? <Check size={13} className="success-text" /> : <Copy size={13} />}</IconButton>
          <IconButton label="Add to prompt" onClick={() => onAddToPrompt(`${identity.owner}/${identity.repo}#${identity.number}`)} title="Add the reference to the composer without sending">
            <SquarePlus size={13} />
          </IconButton>
        </div>
      </header>
      <div className="issue-meta">
        {issue.labels.map((l) => (
          <span className="issue-label" key={l.name}>{l.color ? <i style={{ background: `#${l.color}` }} /> : null}{l.name}</span>
        ))}
        {issue.assignees.length > 0 && <span className="issue-meta-item">Assigned: {issue.assignees.join(", ")}</span>}
        {issue.milestone && <span className="issue-meta-item">Milestone: {issue.milestone.title}</span>}
        <span className="issue-meta-item">Updated {rel(issue.updatedAt)} · by {issue.author || "unknown"}</span>
      </div>
      {issue.body
        ? <div className="issue-body"><Markdown text={taskListSymbols(issue.body)} /></div>
        : <p className="issue-meta-item muted">No description.</p>}
      <section className="issue-comments" aria-label="Discussion">
        <div className="token-table-head">
          <span><MessageSquare size={11} /> DISCUSSION{issue.comments ? ` · ${issue.comments}` : ""}</span>
          <span>{comments ? `${comments.length} loaded` : ""}</span>
        </div>
        {commentsError && <p className="danger-text">{commentsError}</p>}
        {comments === null && commentsLoading && (
          <p className="issue-meta-item muted"><LoaderCircle size={11} className="spin" /> Loading comments…</p>
        )}
        {(comments || []).map((c) => (
          <article className="issue-comment" key={c.id}>
            <div className="issue-comment-head">
              <strong>{c.author || "unknown"}</strong>
              <time title={c.createdAt || undefined}>{rel(c.createdAt)}</time>
            </div>
            <div className="issue-comment-body"><Markdown text={taskListSymbols(c.body)} /></div>
          </article>
        ))}
        {comments?.length === 0 && <p className="issue-meta-item muted">No comments yet.</p>}
        {hasMore && (
          <button className="secondary-button" disabled={commentsLoading} onClick={() => void loadComments((comments?.length || 0) / 20 + 1, false)}>
            {commentsLoading ? <LoaderCircle size={12} className="spin" /> : <Plus size={12} />}Load more comments
          </button>
        )}
      </section>
    </div>
  );
}
