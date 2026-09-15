// ZWUI-058: the line tinting tokenizer. Cosmetic only — but the guarantee
// under test is that every character of the line is preserved in order
// (highlighting must never alter code text).
import { describe, it, expect } from "vitest";
import { highlightLine } from "../richmarkdown";

type Token = { cls: string | null; text: string };

function toTokens(nodes: React.ReactNode[]): Token[] {
  return nodes.map((n) =>
    typeof n === "string"
      ? { cls: null, text: n }
      : { cls: (n.props as { className?: string }).className ?? null, text: String((n.props as { children?: unknown }).children) }
  );
}

const classify = (line: string) => toTokens(highlightLine(line));

describe("highlightLine", () => {
  it("classifies keywords, numbers, strings, and comments", () => {
    const tokens = classify('const x = 1; // init');
    const cls = (t: Token) => t.cls?.replace("tok-", "") ?? null;
    expect(cls(tokens[0])).toBe("keyword"); // const
    expect(tokens[0].text).toBe("const");
    expect(tokens.some((t) => cls(t) === "number" && t.text === "1")).toBe(true);
    const comment = tokens.find((t) => cls(t) === "comment");
    expect(comment?.text).toBe("// init");
  });

  it("classifies quoted strings as one token, not token soup", () => {
    const tokens = classify('const s = "a,b // c";');
    const str = tokens.find((t) => t.cls === "tok-string");
    expect(str?.text).toBe('"a,b // c"');
    // the // inside the string must NOT become a comment
    expect(tokens.some((t) => t.cls === "tok-comment")).toBe(false);
  });

  it("preserves the full line text in order (no character loss)", () => {
    const line = "if (x === 42) return `tpl ${y}`; // done";
    const tokens = classify(line);
    const joined = tokens.map((t) => t.text).join("");
    expect(joined).toBe(line);
  });

  it("returns untinted text nodes for a line with nothing to tint", () => {
    const tokens = classify("plainword other");
    expect(tokens.every((t) => t.cls === null)).toBe(true);
    expect(tokens.map((t) => t.text).join("")).toBe("plainword other");
  });
});
