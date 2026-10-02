// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Markdown text parsing for the stale-link guard: code-stripping helpers and
 * link-target collection — inline `[label](target)` plus reference-style
 * `[label][ref]` resolved against `[ref]: target` definitions — and the
 * external/anchor target classification predicates.
 */

/** Strip fenced code blocks (```…```). */
export function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/** Strip inline code spans (`…`). */
export function stripInlineCode(text: string): string {
  return text.replace(/`[^`]+`/g, "");
}

/** Collect `[label](target)` and `[label][ref]` usages. */
export function collectLinks(text: string): string[] {
  const links: string[] = [];
  // Inline: [text](target "title"?) — capture the URL portion
  const inlineRe = /\[([^\]]*)\]\((\s*<?([^)\s]+?|...)?>?(?:\s+"[^"]*")?\s*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(text)) !== null) {
    const inner = m[2] ?? "";
    const target = inner.match(/([^)\s"']+)/);
    if (target && target[1]) links.push(target[1]);
  }
  // Reference definitions + usages
  const defRe = /^\[([^\]]+)\]:\s*(.+)$/gm;
  const defs = new Map<string, string>();
  while ((m = defRe.exec(text)) !== null) {
    const key = m[1];
    const val = m[2];
    if (key && val) defs.set(key.toLowerCase(), val.trim());
  }
  const useRe = /\[[^\]]*\]\[([^\]]+)\]/g;
  while ((m = useRe.exec(text)) !== null) {
    const refKey = m[1];
    if (refKey) {
      const target = defs.get(refKey.toLowerCase());
      if (target) links.push(target);
    }
  }
  return links;
}

/** True if the target is an absolute/external URL we should not resolve. */
export function isExternal(target: string): boolean {
  return /^(https?:|mailto:|ftp:|tel:|data:)/i.test(target);
}

/** True if target is anchor-only (#fragment, same-file). */
export function isAnchorOnly(target: string): boolean {
  return target.startsWith("#") && !target.startsWith("#/");
}
