// ZWUI-015: the single Markdown render component. All assistant/model text
// goes through this — it is fail-closed (see lib/markdown.ts).
import { useMemo } from "react";
import { safeMarkdown } from "../lib/markdown";

export function Markdown({ text }: { text: string }) {
  const { html, degraded } = useMemo(() => safeMarkdown(text), [text]);
  return (
    <div
      className="md"
      data-degraded={degraded || undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
