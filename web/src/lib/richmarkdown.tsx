// Rich markdown renderer: fenced code blocks become first-class React
// components (language header, copy button, line numbers, light syntax
// tint) while everything else keeps going through the fail-closed
// safeMarkdown sanitizer. Code content renders as text nodes only — no
// HTML inside code is ever interpreted.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { safeMarkdown } from "./markdown";
import { linkifyIssueRefsHtml, type RepoBinding } from "./issueRefs";

export type CodeSegment = { kind: "code"; lang: string; code: string };
export type TextSegment = { kind: "text"; text: string };
export type Segment = CodeSegment | TextSegment;

// split on ``` fences; unmatched fences tail into a final code segment
export function splitFences(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /```([\w+-]*)[ \t]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (re.lastIndex === m.index) re.lastIndex++; // zero-length guard
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "code", lang: (m[1] || "").toLowerCase(), code: m[2].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const KEYWORDS =
  /\b(const|let|var|function|return|if|else|elif|for|while|class|new|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|extends|super|this|null|undefined|true|false|interface|type|enum|public|private|readonly|def|end|select|where|group|order|insert|update|create|table)\b/;

// light, line-local tinting: comments, strings, numbers, keywords. Tokens are
// rendered as plain text — this is cosmetic, not a parser.
function highlightLine(line: string): React.ReactNode[] {
  const master =
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = master.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    let cls = "";
    if (m[1]) cls = "tok-comment";
    else if (m[2]) cls = "tok-string";
    else if (m[3]) cls = "tok-number";
    else if (KEYWORDS.test(tok)) cls = "tok-keyword";
    out.push(cls ? <span className={cls} key={`t${k++}`}>{tok}</span> : tok);
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-block-lang">{lang || "text"}</span>
        <button className="code-block-copy" onClick={() => void copy()} aria-label="Copy code">
          {copied ? <Check size={11} className="success-text" /> : <Copy size={11} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="code-block-body">
        <code>
          {lines.map((line, i) => (
            <span className="code-line" key={i}>
              <span className="code-line-no">{i + 1}</span>
              <span className="code-line-text">{line ? highlightLine(line) : "\u00A0"}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function RichMarkdown({ text, issueResolver }: { text: string; issueResolver?: () => RepoBinding | null }) {
  if (!text) return null;
  const segments = splitFences(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "code"
          ? <CodeBlock key={i} code={seg.code} lang={seg.lang} />
          : <span key={i} className="markdown" dangerouslySetInnerHTML={{
              // refs are linkified AFTER sanitization, over text nodes only
              __html: issueResolver
                ? linkifyIssueRefsHtml(safeMarkdown(seg.text).html, { resolveBare: issueResolver })
                : safeMarkdown(seg.text).html,
            }} />
      )}
    </>
  );
}
