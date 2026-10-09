// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ticket-markdown emission helpers shared by the two generator paths —
 * `giwt ticket` create (renderTicketFile) and sync `--import-back`.
 *
 * `sanitizeTicketBody` normalizes free-form body prose so the generated
 * .md passes the repo's markdownlint gate unchanged
 * (BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic):
 *   - MD031  blank line before/after every fenced block
 *   - MD032  blank line between a paragraph and a following list
 *   - MD033  bare `<token>` angle-bracket forms become inline code
 *   - MD040  fences without an info string get `text`
 *   - MD012  blank-line runs collapse; blank edges are stripped
 *   - MD009/MD010  trailing whitespace trimmed outside fences
 */

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * Escape bare `<token>` forms outside code: `<path>` → `` `<path>` ``.
 * Only placeholder-ish tokens match (letter-leading, no spaces/brackets, no
 * `:` so autolinks like `<https://…>` and HTML comments like `<!-- … -->`
 * survive untouched). Inline-code spans are split out first so content the
 * author already backticked is preserved verbatim; 4-space-indented lines
 * (indented code blocks) are left alone too.
 */
function escapeAngleTokens(line: string): string {
  if (!line.includes("<")) return line;
  return line
    .split(/(`[^`]*`)/g)
    .map((part, i) =>
      i % 2 === 1 || /^\s{4,}/.test(part)
        ? part
        : part.replace(/<([A-Za-z][A-Za-z0-9._/@+-]{0,78})>/g, "`<$1>`")
    )
    .join("");
}

/**
 * Normalize a free-form ticket body for embedding in a generated .md.
 * Returns the body with no leading/trailing blank lines, blank-line runs
 * collapsed to one, fences lint-clean — the caller supplies surrounding
 * blank-line separators and the file's single trailing newline.
 * Fence content passes verbatim (no escaping/list fixing inside code).
 */
export function sanitizeTicketBody(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fenceMarker: string | null = null;

  const pushBlankSeparator = () => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };

  for (const line of lines) {
    const m = FENCE_RE.exec(line);
    if (fenceMarker === null && m) {
      // Opening fence: blank-separate (MD031) and tag the language (MD040).
      fenceMarker = m[2]!.slice(0, 3);
      pushBlankSeparator();
      const info = m[3]!.trim();
      out.push(`${m[1]}${fenceMarker}${info || "text"}`);
      continue;
    }
    if (fenceMarker !== null && m && m[2]!.startsWith(fenceMarker) && m[3]!.trim() === "") {
      // Closing fence (no info string): blank-separate the block (MD031).
      fenceMarker = null;
      out.push(m[1]! + m[2]!);
      pushBlankSeparator();
      continue;
    }
    if (fenceMarker !== null) {
      out.push(line);
      continue;
    }
    // MD009/MD010: no trailing whitespace outside fences (fence content is
    // verbatim); this also turns whitespace-only lines into real blanks.
    const text = line.replace(/\s+$/, "");
    if (
      LIST_ITEM_RE.test(text) && out.length > 0 && out[out.length - 1] !== ""
      && !LIST_ITEM_RE.test(out[out.length - 1]!)
    ) {
      // MD032: a list must not start directly under a paragraph line.
      out.push("");
    }
    out.push(escapeAngleTokens(text));
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // MD012: max one blank line between blocks
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/**
 * Document-level markers whose presence in a `ticket <TYPE>` body means the
 * author passed a whole ticket document instead of prose — embedding it
 * verbatim nests one ticket doc inside another (the duplicate-document
 * defect). Fence-aware: `#`/`**Status:**` shapes inside code blocks are
 * content, not markers.
 *
 * @returns human-readable marker descriptions (empty → body is prose-only)
 */
export function detectNestedTicketDoc(body: string): string[] {
  const prose: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const m = FENCE_RE.exec(line);
    if (m) {
      if (!inFence) {
        inFence = true;
        fenceMarker = m[2]!.slice(0, 3);
      } else if (m[2]!.startsWith(fenceMarker) && m[3]!.trim() === "") {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (!inFence) prose.push(line);
  }
  const text = prose.join("\n");
  const markers: string[] = [];
  if (/SPDX-(?:License-Identifier|FileCopyrightText)/.test(text)) {
    markers.push("an SPDX header (SPDX-License-Identifier/SPDX-FileCopyrightText)");
  }
  if (/^#\s+\S/m.test(text)) {
    markers.push("its own '# <TYPE>: …' title heading");
  }
  if (/\*\*\s*status\s*:\s*\*\*|\*\*\s*status\s*\*\*\s*[:=]/i.test(text)) {
    markers.push("its own '**Status:**' block");
  }
  return markers;
}
