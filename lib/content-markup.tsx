/**
 * BAGATI content pages: a small, safe text format and its renderer. No raw HTML is ever accepted or produced as a
 * string: the body is parsed into a tree and rendered as React elements, so React escapes every piece of text.
 * Never use dangerouslySetInnerHTML with page bodies.
 *
 * Format (one block per paragraph, blocks separated by a blank line):
 *   ## Başlıq            → h2        ### Alt başlıq → h3
 *   - bənd               → bulleted list (consecutive lines)
 *   1. bənd              → numbered list (consecutive lines)
 *   any other lines      → a paragraph (line breaks inside it become spaces)
 * Inline: **qalın** and [mətn](/yol) or [mətn](https://ünvan). Any other link target (javascript:, data:, http:,
 * //host, backslashes, credentials, whitespace) is shown as plain text, never as a link.
 */
import type { ReactNode } from "react";

export const CONTENT_BODY_MAX = 50_000;

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; href: string; text: string };

export type Block =
  | { type: "heading"; level: 2 | 3; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

/** https:// with a host and no credentials, or a site-relative path ("/x", not "//x" or "/\x"). */
export function isSafeContentHref(href: string): boolean {
  if (!href || href.length > 500 || /[\s\\<>"'`\u0000-\u001f\u007f]/.test(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//");
  if (!href.startsWith("https://")) return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const INLINE = /\*\*([^*\n]{1,500}?)\*\*|\[([^\]\n]{1,200})\]\(([^)\n]{1,500})\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (piece: Inline) => {
    const last = out[out.length - 1];
    if (piece.type === "text" && last?.type === "text") last.text += piece.text;
    else if (piece.type !== "text" || piece.text) out.push(piece);
  };
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    push({ type: "text", text: text.slice(index, match.index) });
    if (match[1] !== undefined) push({ type: "bold", text: match[1] });
    else {
      const label = match[2];
      const href = match[3].trim();
      // An unsafe target is never a link: show the label as plain text.
      push(isSafeContentHref(href) ? { type: "link", href, text: label } : { type: "text", text: label });
    }
    index = (match.index ?? 0) + match[0].length;
  }
  push({ type: "text", text: text.slice(index) });
  return out;
}

const clean = (body: string) => body.slice(0, CONTENT_BODY_MAX).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

export function parseContent(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of clean(body).split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    let paragraph: string[] = [];
    const flush = () => { if (paragraph.length) blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) }); paragraph = []; };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        flush();
        blocks.push({ type: "heading", level: heading[1].length === 3 ? 3 : 2, inline: parseInline(heading[2]) });
        continue;
      }
      const bullet = /^[-*]\s+(.+)$/.exec(line);
      const numbered = /^\d{1,3}[.)]\s+(.+)$/.exec(line);
      if (bullet || numbered) {
        flush();
        const ordered = Boolean(numbered);
        const items: Inline[][] = [];
        for (; i < lines.length; i += 1) {
          const item = ordered ? /^\d{1,3}[.)]\s+(.+)$/.exec(lines[i]) : /^[-*]\s+(.+)$/.exec(lines[i]);
          if (!item) break;
          items.push(parseInline(item[1]));
        }
        i -= 1;
        blocks.push({ type: "list", ordered, items });
        continue;
      }
      paragraph.push(line);
    }
    flush();
  }
  return blocks;
}

function renderInline(pieces: Inline[], keyPrefix: string): ReactNode[] {
  return pieces.map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    if (piece.type === "bold") return <strong key={key}>{piece.text}</strong>;
    if (piece.type === "link") {
      const external = piece.href.startsWith("https://");
      return <a key={key} href={piece.href} className="font-medium text-bagati-primary underline underline-offset-2" {...(external ? { rel: "noopener noreferrer nofollow" } : {})}>{piece.text}</a>;
    }
    return piece.text;
  });
}

/** React elements for a page body. Safe for any input (tested with XSS attempts). */
export function ContentBody({ body, className = "" }: { body: string; className?: string }) {
  const blocks = parseContent(body);
  return <div className={`grid gap-4 leading-7 text-bagati-secondary ${className}`}>
    {blocks.map((block, index) => {
      const key = `b${index}`;
      if (block.type === "heading") {
        return block.level === 2
          ? <h2 key={key} className="mt-4 text-xl font-semibold text-bagati-deep">{renderInline(block.inline, key)}</h2>
          : <h3 key={key} className="mt-2 text-lg font-semibold text-bagati-deep">{renderInline(block.inline, key)}</h3>;
      }
      if (block.type === "list") {
        const items = block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>);
        return block.ordered ? <ol key={key} className="list-decimal space-y-1 pl-6">{items}</ol> : <ul key={key} className="list-disc space-y-1 pl-6">{items}</ul>;
      }
      return <p key={key}>{renderInline(block.inline, key)}</p>;
    })}
  </div>;
}
