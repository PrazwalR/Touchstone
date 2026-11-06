import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
// A small markdown renderer for the repository's own docs. It builds React elements and never injects HTML, so
// React escapes every character of the source: with a wallet connected on two views, the docs must not be able
// to run script (decision 0060). It covers what the docs use: headings, paragraphs, lists, pipe tables, fenced
// code, block quotes, rules, and inline emphasis, code and links.
import { Fragment, type ReactNode } from "react";

export type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; text: string }
  | { t: "hr" };

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l);
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** Splits markdown into blocks. Unknown constructs fall back to paragraphs, so nothing is dropped silently. */
export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!))
        body.push(lines[i++]!);
      i++;
      out.push({ t: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push({ t: "h", level: h[1]!.length, text: h[2]!.trim() });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isSeparator(lines[i + 1]!)
    ) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!))
        rows.push(cells(lines[i++]!));
      out.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!))
        body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", text: body.join(" ") });
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+\.\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "") {
        const l = lines[i]!;
        if (marker.test(l)) items.push(l.replace(marker, ""));
        else if (items.length) items[items.length - 1] += ` ${l.trim()}`;
        i++;
      }
      out.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,6})\s/.test(lines[i]!) &&
      !/^\s*```/.test(lines[i]!) &&
      !(
        isTableRow(lines[i]!) &&
        i + 1 < lines.length &&
        isSeparator(lines[i + 1]!)
      )
    )
      para.push(lines[i++]!.trim());
    out.push({ t: "p", text: para.join(" ") });
  }
  return out;
}

const SAFE_URL = /^(https:\/\/|http:\/\/|#|mailto:)/i;

/** Inline markdown to React nodes: `code`, **bold**, *em* or _em_, and [text](url). Links outside http(s), mail
 * and in-page anchors are shown as text: no javascript: or data: URL can become a link. */
export function inline(
  text: string,
  resolveLink?: (href: string) => string | null,
): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (m[2])
      out.push(
        <strong key={k++}>{inline(tok.slice(2, -2), resolveLink)}</strong>,
      );
    else if (m[3]) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const label = lm[1]!;
      const target = resolveLink?.(lm[2]!) ?? lm[2]!;
      if (SAFE_URL.test(target)) {
        const external = /^https?:/i.test(target);
        out.push(
          <a
            key={k++}
            href={target}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {inline(label, resolveLink)}
          </a>,
        );
      } else
        out.push(<Fragment key={k++}>{inline(label, resolveLink)}</Fragment>);
    } else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  source,
  resolveLink,
}: {
  source: string;
  resolveLink?: (href: string) => string | null;
}) {
  const blocks = parse(source);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const r = (s: string) => inline(s, resolveLink);
        switch (b.t) {
          case "h": {
            const H = `h${Math.min(6, b.level + 1)}` as "h2";
            return <H key={i}>{r(b.text)}</H>;
          }
          case "p":
            return <p key={i}>{r(b.text)}</p>;
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{r(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{r(it)}</li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={i} className="tablewrap">
                <Table className="table">
                  <TableHeader>
                    <TableRow>
                      {b.head.map((c, j) => (
                        <TableHead key={j}>{r(c)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.rows.map((row, j) => (
                      <TableRow key={j}>
                        {row.map((c, x) => (
                          <TableCell key={x}>{r(c)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          case "code":
            return (
              <pre key={i} className="md-code">
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return <blockquote key={i}>{r(b.text)}</blockquote>;
          case "hr":
            return <hr key={i} />;
        }
      })}
    </div>
  );
}
