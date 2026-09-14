// ZWUI-051: issue reference recognition + resolution rules.
import { describe, it, expect } from "vitest";
import { scanIssueRefs, linkifyIssueRefsHtml, issueKey, parseIssueKey, GITHUB_COM } from "../issueRefs";

const bound = () => ({ host: GITHUB_COM, owner: "ther12k", repo: "zcode-web" });
const opts = { resolveBare: bound };

describe("scanIssueRefs", () => {
  it("recognizes full URLs, owner/repo#N and bare #N", () => {
    const text = [
      "See https://github.com/ther12k/zcode-web/issues/491 first,",
      "then acme/tools#42, and finally #7.",
    ].join("\n");
    const refs = scanIssueRefs(text, opts);
    expect(refs.map(issueKey)).toEqual([
      "github.com/ther12k/zcode-web#491",
      "github.com/acme/tools#42",
      "github.com/ther12k/zcode-web#7",
    ]);
    expect(refs.map((r) => r.explicit)).toEqual([true, true, false]);
  });

  it("resolves pull URL forms and never treats pulls differently at scan time", () => {
    const refs = scanIssueRefs("https://github.com/acme/tools/pulls/42", opts);
    expect(refs.map(issueKey)).toEqual(["github.com/acme/tools#42"]);
  });

  it("never guesses a repository for an unresolvable bare number", () => {
    const refs = scanIssueRefs("fix #123 please", { resolveBare: () => null });
    expect(refs).toEqual([]);
  });

  it("ignores fenced code, inline code, headings, links and hash-like noise", () => {
    const text = [
      "```js",
      "// #123 stays code",
      "```",
      "## Heading with #55",
      "Inline `#66` is code.",
      "Hex deadbeef and #ff00aa are not issues; issue #41 is.",
      "Already linked: [see #41](https://example.com) → dedupe keeps one #41.",
    ].join("\n");
    const refs = scanIssueRefs(text, opts);
    expect(refs.map(issueKey)).toEqual(["github.com/ther12k/zcode-web#41"]);
  });

  it("ignores URLs on hosts the deployment does not read", () => {
    const refs = scanIssueRefs("https://gitlab.example.com/acme/tools/issues/9", opts);
    expect(refs).toEqual([]);
  });

  it("deduplicates repeated mentions across a message by identity", () => {
    const refs = scanIssueRefs("#7 again #7 and ther12k/zcode-web#7", opts);
    expect(refs).toHaveLength(1);
  });

  it("project switching cannot reinterpret an old bare #N — resolution is per-scan", () => {
    const text = "the old #123 reference";
    const before = scanIssueRefs(text, { resolveBare: () => ({ host: GITHUB_COM, owner: "a", repo: "one" }) });
    const after = scanIssueRefs(text, { resolveBare: () => ({ host: GITHUB_COM, owner: "b", repo: "two" }) });
    expect(issueKey(before[0])).toBe("github.com/a/one#123");
    expect(issueKey(after[0])).toBe("github.com/b/two#123");
  });
});

describe("linkifyIssueRefsHtml (over sanitized HTML)", () => {
  it("wraps refs in data-carrying anchors inside text nodes only", () => {
    const html = "<p>Fix #41 and <code>#42</code> plus <pre>#43</pre></p>";
    const out = linkifyIssueRefsHtml(html, opts);
    expect(out).toContain('data-issue-ref="github.com/ther12k/zcode-web#41"');
    expect(out).not.toContain('data-issue-ref="github.com/ther12k/zcode-web#42"');
    expect(out).not.toContain('data-issue-ref="github.com/ther12k/zcode-web#43"');
    expect(out).toContain("<code>#42</code>");
  });

  it("leaves existing links, attributes and headings untouched", () => {
    const html = '<p><a href="https://x">#44</a> and <h3>#45 heading</h3> but #46 works</p>';
    const out = linkifyIssueRefsHtml(html, opts);
    expect(out).toContain('<a href="https://x">#44</a>');
    expect(out).toContain("<h3>#45 heading</h3>");
    expect(out).toContain('data-issue-ref="github.com/ther12k/zcode-web#46"');
  });

  it("returns the input unchanged when nothing matches", () => {
    const html = "<p>plain #word &amp; # entity text</p>";
    expect(linkifyIssueRefsHtml(html, opts)).toBe(html);
  });

  it("parses identities back from the data attribute", () => {
    const html = linkifyIssueRefsHtml("<p>#41</p>", opts);
    const m = /data-issue-ref="([^"]+)"/.exec(html)!;
    expect(parseIssueKey(m[1])).toEqual({ host: GITHUB_COM, owner: "ther12k", repo: "zcode-web", number: 41 });
  });
});
