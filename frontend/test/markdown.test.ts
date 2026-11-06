import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, parse } from "../src/docs/markdown.tsx";

const html = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }));

describe("docs markdown", () => {
  it("parses the constructs the repository's docs use", () => {
    const blocks = parse(
      ["# Title", "", "Text with **bold**.", "", "- a", "- b", "", "| H1 | H2 |", "| --- | ---: |", "| 1 | 2 |", "", "```sh", "forge test", "```", "", "1. one", "2. two"].join("\n"),
    );
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "table", "code", "ol"]);
    const table = blocks[3];
    expect(table?.t === "table" && table.rows[0]).toEqual(["1", "2"]);
  });

  it("escapes HTML instead of rendering it", () => {
    const out = html('Hello <script>alert(1)</script> <img src=x onerror="alert(2)">');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });

  it("links only http(s), mail and anchors; any other scheme stays text", () => {
    expect(html("[ok](https://example.com)")).toContain('href="https://example.com"');
    for (const bad of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](vbscript:msgbox)"]) {
      const out = html(bad);
      expect(out).not.toContain("href");
      expect(out).toContain("x");
    }
  });

  it("keeps inline code literal", () => {
    expect(html("Run `forge test --match-path **x**`.")).toContain("<code>forge test --match-path **x**</code>");
  });
});
