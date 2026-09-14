// ZWUI-051: GitHub issue reference scanning and safe linkification.
//
// Rules (from the design review):
//  - full URLs → explicit repository; owner/repo#N → explicit repository;
//    bare #N → the repository bound to the conversation's project. A bare
//    number with NO bound repository is never guessed — it stays plain text.
//  - only Markdown TEXT is linkified: fenced code, inline code, existing
//    links and headings are left alone. Linkification runs over ALREADY
//    SANITIZED HTML and touches only text nodes — never attributes.
import { splitFences } from "./richmarkdown";

export type IssueIdentity = {
  host: string;
  owner: string;
  repo: string;
  number: number;
};

export type ScannedIssueRef = IssueIdentity & {
  /** the repository was stated in the reference itself (URL or owner/repo#N) */
  explicit: boolean;
};
/** A repository binding (e.g. the project's origin remote) — no issue number. */
export type RepoBinding = { host: string; owner: string; repo: string };

export const GITHUB_COM = "github.com";

export function issueKey(id: IssueIdentity): string {
  return `${id.host}/${id.owner}/${id.repo}#${id.number}`;
}

export function parseIssueKey(key: string): IssueIdentity | null {
  const m = /^([^/]+)\/([^/]+)\/([^#]+)#(\d{1,10})$/.exec(key);
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3], number: Number(m[4]) };
}

const URL_RE = /https?:\/\/(?:www\.)?([a-z0-9.-]+)\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/(?:issues|pulls)\/(\d{1,10})(?![\w./#-])/g;
const QUALIFIED_RE = /\b([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})#(\d{1,10})\b/g;
// not preceded by a word char, '#' (more #s) or '&' (HTML entities)
const BARE_RE = /(^|[^\w#&/])#(\d{1,10})\b/g;

export type ScanOptions = {
  /** repository bound to the conversation's project — bare #N resolves here */
  resolveBare: () => RepoBinding | null;
  /** extra hosts this deployment reads (e.g. a GitHub Enterprise host) */
  extraHosts?: string[];
};

type Match = { start: number; end: number; identity: IssueIdentity; explicit: boolean };

function collectMatches(text: string, opts: ScanOptions): Match[] {
  const matches: Match[] = [];
  const hosts = new Set([GITHUB_COM, ...(opts.extraHosts || []).filter(Boolean)]);
  let m: RegExpExecArray | null;

  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const host = m[1].toLowerCase();
    if (!hosts.has(host)) continue;
    const number = Number(m[4]);
    if (number < 1) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, explicit: true, identity: { host, owner: m[2], repo: m[3], number } });
  }
  QUALIFIED_RE.lastIndex = 0;
  while ((m = QUALIFIED_RE.exec(text)) !== null) {
    const number = Number(m[3]);
    if (number < 1) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, explicit: true, identity: { host: GITHUB_COM, owner: m[1], repo: m[2], number } });
  }
  if (opts.resolveBare) {
    BARE_RE.lastIndex = 0;
    while ((m = BARE_RE.exec(text)) !== null) {
      const number = Number(m[2]);
      if (number < 1) continue;
      const bound = opts.resolveBare();
      // an unresolvable bare number is NEVER guessed into a repository
      if (!bound) continue;
      const start = m.index + m[1].length;
      matches.push({ start, end: start + m[0].length - m[1].length, explicit: false, identity: { ...bound, number } });
    }
  }
  // first occurrence wins, in encounter order
  matches.sort((a, b) => a.start - b.start);
  return matches;
}

function stripNonProse(text: string): string {
  return text
    .split("\n")
    // ATX headings: references in headings stay plain text
    .filter((line) => !/^#{1,6}\s/.test(line))
    .join("\n")
    // inline code spans: never linkified
    .replace(/`[^`\n]*`/g, (code) => " ".repeat(code.length));
}

/** Scan raw Markdown text for issue references (text prose only — code and
 *  headings excluded), deduplicated by full identity. */
export function scanIssueRefs(markdownText: string, opts: ScanOptions): ScannedIssueRef[] {
  if (!markdownText) return [];
  const seen = new Set<string>();
  const out: ScannedIssueRef[] = [];
  for (const seg of splitFences(markdownText)) {
    if (seg.kind !== "text") continue;
    const prose = stripNonProse(seg.text);
    for (const match of collectMatches(prose, opts)) {
      const key = issueKey(match.identity);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...match.identity, explicit: match.explicit });
    }
  }
  return out;
}

// ---- safe linkification over sanitized HTML ----

const SKIP_TAGS = new Set(["PRE", "CODE", "A", "BUTTON", "H1", "H2", "H3", "H4", "H5", "H6", "SCRIPT", "STYLE"]);

/** Linkify issue references in ALREADY-SANITIZED markdown HTML. Only text
 *  nodes outside code/links/headings are rewritten; everything else is
 *  byte-preserved. Returns the original string when nothing matched. */
export function linkifyIssueRefsHtml(sanitizedHtml: string, opts: ScanOptions): string {
  if (typeof window === "undefined" || !sanitizedHtml.includes("#")) return sanitizedHtml;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(sanitizedHtml, "text/html");
  } catch {
    return sanitizedHtml;
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = (node as Text).parentElement;
    if (parent && SKIP_TAGS.has(parent.tagName)) continue;
    if (node.nodeValue && /#/.test(node.nodeValue)) targets.push(node as Text);
  }
  let changed = false;
  for (const node of targets) {
    const value = node.nodeValue || "";
    const matches = collectMatches(value, opts);
    if (!matches.length) continue;
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) frag.appendChild(doc.createTextNode(value.slice(cursor, match.start)));
      const a = doc.createElement("a");
      const { host, owner, repo, number } = match.identity;
      const label = match.explicit ? `${owner}/${repo}#${number}` : `#${number}`;
      a.className = "issue-ref";
      a.href = "#issue";
      a.dataset.issueRef = `${host}/${owner}/${repo}#${number}`;
      a.setAttribute("title", `${label} — open in the inspector`);
      a.textContent = label;
      frag.appendChild(a);
      cursor = match.end;
      changed = true;
    }
    if (cursor < value.length) frag.appendChild(doc.createTextNode(value.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }
  if (!changed) return sanitizedHtml;
  return doc.body.innerHTML;
}
