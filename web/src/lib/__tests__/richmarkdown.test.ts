// RichMarkdown fence-splitter tests: the tokenizer decides what renders as a
// React code block vs sanitized text — XSS-relevant, so it gets its own suite.
import { describe, it, expect } from "vitest";
import { splitFences } from "../richmarkdown";

describe("splitFences", () => {
  it("splits plain text into a single text segment", () => {
    expect(splitFences("just prose")).toEqual([{ kind: "text", text: "just prose" }]);
  });

  it("splits a closed fence with language", () => {
    const segs = splitFences("before\n```ts\nconst x = 1;\n```\nafter");
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ kind: "text", text: "before\n" });
    expect(segs[1]).toEqual({ kind: "code", lang: "ts", code: "const x = 1;" });
    expect(segs[2]).toEqual({ kind: "text", text: "\nafter" });
  });

  it("treats an unclosed fence as code to the end (streaming tail)", () => {
    const segs = splitFences("```js\nlet a = 1;\nlet b = 2;");
    expect(segs).toEqual([{ kind: "code", lang: "js", code: "let a = 1;\nlet b = 2;" }]);
  });

  it("handles multiple fences and empty languages", () => {
    const segs = splitFences("```\nplain\n```\nmid\n```python\nprint(1)\n```");
    expect(segs.filter((s) => s.kind === "code")).toHaveLength(2);
    const py = segs.find((s) => s.kind === "code" && s.lang === "python");
    expect(py && "code" in py && py.code).toBe("print(1)");
  });

  it("keeps HTML-looking code inert inside code segments (rendered as text)", () => {
    const segs = splitFences("```html\n<script>alert(1)</script>\n```");
    expect(segs[0].kind).toBe("code");
    expect("code" in segs[0] && segs[0].code).toContain("<script>");
  });
});
