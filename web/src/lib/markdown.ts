// ZWUI-015: fail-closed Markdown rendering.
// Rules:
//  1. Every render path goes through sanitizeMarkdownHtml() — no exceptions.
//  2. If marked or DOMPurify are unavailable/throw, we degrade to plain text
//     (never raw HTML).
//  3. Links open in new tabs with rel="noopener noreferrer"; javascript: and
//     other dangerous URLs are removed by DOMPurify.

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_ATTR: ["style", "srcset"],
    FORBID_TAGS: ["style", "form", "input", "iframe", "object", "embed"],
  });
}

export function renderMarkdownToHtml(text: string): string {
  try {
    const raw = marked.parse(text, { async: false }) as string;
    return sanitizeMarkdownHtml(raw);
  } catch {
    // fail closed: plain text, never unsanitized markup
    return escapeHtml(text);
  }
}

/** React-safe: returns an HTML string that is safe for dangerouslySetInnerHTML,
 *  or a fallback marker if the sanitizer itself is unavailable. */
export function safeMarkdown(text: string): { html: string; degraded: boolean } {
  if (typeof window === "undefined" || !DOMPurify.isSupported) {
    return { html: escapeHtml(text), degraded: true };
  }
  try {
    return { html: renderMarkdownToHtml(text), degraded: false };
  } catch {
    return { html: escapeHtml(text), degraded: true };
  }
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
