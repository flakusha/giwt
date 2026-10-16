// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `.plan` markdown header-field REWRITE layer (ported from loop-lore's
 * plan-markdown-fields.ts, commit 125de19): line-scoped detection of the
 * three historical field spellings and the exact line edits that
 * canonicalize them (`**Labels:**` → `**Tags:**`, `**Epic**:` → `**Epic:**`),
 * plus the `**Related:**` ref scan.
 *
 * This is NOT the index parser: .md → index field parsing lives in
 * src/tickets/sync-parse.ts (parseTagsField/parseEpicField) and this module
 * never re-implements it — it plans line-level edits so a rewrite replaces
 * exactly one `**Tags**`/`**Labels**`/`**Epic**` line by its full source
 * text. `**Status:**` lines are never read, matched, or written here.
 */

// ── Field-line grammar ────────────────────────────────────────────────────────
// Three historical spellings exist per field name:
//   `**Tags:**`  canonical — what sync-parse.ts reads
//   `**Tags**:`  colon outside the bold — hand-written tickets
//   `**Tags**`   bare, no colon — ditto
const FIELD_LINE = /^\s*(?:[-*>]\s*)?\*\*(?<name>Tags|Labels|Epic):?\*\*\s*:?\s*(?<value>.*?)\s*$/i;
/** The canonical `**Epic:**` spelling — colon INSIDE the bold, the only form
 * giwt's ticket parser (sync-parse.ts) reads. */
const EPIC_CANONICAL = /^\s*(?:[-*>]\s*)?\*\*Epic:\*\*/i;

/** One parsed header field line. */
export interface FieldLine {
  index: number;
  name: string;
  value: string;
  raw: string;
}

/** Every `**Tags**`/`**Labels**`/`**Epic**` field line in a file, in order. */
export function fieldLines(text: string): FieldLine[] {
  const out: FieldLine[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const groups = FIELD_LINE.exec(line)?.groups;
    if (groups?.["name"] !== undefined) {
      out.push({ index, name: groups["name"], value: (groups["value"] ?? "").trim(), raw: line });
    }
  }
  return out;
}

/** Placeholder tag values that mean "no tags", never a literal tag. */
export const TAG_PLACEHOLDER = /^\(?\s*(none|n\/a|-|tbd)?\s*\)?$/i;
/** Epic values that name no epic. */
const EPIC_PLACEHOLDER = /^\(?\s*(none|n\/a|-|if applicable)?\s*\)?$/i;

/**
 * Normalize one epic reference to its bare slug, or null when it does not
 * name exactly one epic file. Accepts the shapes tickets actually use
 * (`epic-x`, `epic-x.md`, backticked, `.plan/epics/epic-x.md`,
 * `epic-x.md (MVP Tier 1)`); refuses multi-epic lists and freeform prose —
 * guessing here is how a wrong binding gets invented.
 */
export function normalizeEpicRef(raw: string): string | null {
  const v = raw.replace(/[`*]/g, "").trim();
  if (!v || EPIC_PLACEHOLDER.test(v)) return null;
  // Drop a trailing prose annotation (` (MVP Tier 1)`, ` (§7.6)`) BEFORE
  // stripping `.md` — otherwise `x.md (MVP Tier 1)` keeps the extension.
  const norm = v
    .replace(/^\.plan\/epics\//, "")
    .replace(/\s*(?:§|\()[^)]*\)?\s*$/, "")
    .replace(/\.md$/i, "")
    .trim();
  // A comma or slash means the author listed two or more epics; there is no
  // single epic to bind to, so refuse rather than pick one.
  if (!norm.startsWith("epic-") || /[,/;]/.test(norm)) return null;
  return norm;
}

/** One line-level edit. `from` is the full source line, `to` its replacement. */
export interface PlanRewrite {
  file: string;
  kind: "labels-to-tags" | "epic-colon-outside";
  from: string;
  to: string;
}

/** Per-file analysis result. */
export interface FilePlan {
  rewrites: PlanRewrite[];
  dangling: { file: string; value: string; }[];
  /** True when the file will carry at least one real tag after rewrite. */
  hasTags: boolean;
}

/**
 * Analyze one plan file. Returns the edits that apply; an empty rewrite
 * list means the file already follows the canonical spelling. A Labels line
 * keeps the author's value byte-for-byte (only the field NAME changes);
 * an `**Epic**:` line canonicalizes the colon INSIDE the bold — swallowing
 * a colon that already follows the bold, so `**Epic**: x` becomes
 * `**Epic:** x` and not `**Epic:**: x`.
 */
export function planFile(file: string, text: string, epicSlugs: Set<string>): FilePlan {
  const rewrites: PlanRewrite[] = [];
  const dangling: { file: string; value: string; }[] = [];
  let hasTags = false;

  for (const f of fieldLines(text)) {
    if (f.name === "Labels") {
      if (!TAG_PLACEHOLDER.test(f.value)) {
        rewrites.push({
          file,
          kind: "labels-to-tags",
          from: f.raw,
          to: f.raw.replace(/\bLabels(?=:?\*\*)/i, "Tags"),
        });
        hasTags = true;
      }
      continue;
    }
    if (f.name === "Tags") {
      if (!TAG_PLACEHOLDER.test(f.value)) hasTags = true;
      continue;
    }
    // Epic: canonicalize the spelling, then check that it resolves.
    const slug = normalizeEpicRef(f.value);
    if (!EPIC_CANONICAL.test(f.raw)) {
      if (slug) {
        rewrites.push({
          file,
          kind: "epic-colon-outside",
          from: f.raw,
          to: f.raw.replace(/\*\*Epic\*\*(\s*):?\s*/, "**Epic:** "),
        });
        if (!epicSlugs.has(slug)) dangling.push({ file, value: f.value });
      }
      continue;
    }
    if (slug && !epicSlugs.has(slug)) dangling.push({ file, value: f.value });
  }
  return { rewrites, dangling, hasTags };
}

/** Apply rewrites by exact full-line match, so no other line can shift. */
export function applyRewrites(text: string, rewrites: PlanRewrite[]): string {
  const lines = text.split("\n");
  for (const r of rewrites) {
    const idx = lines.indexOf(r.from);
    if (idx === -1) continue;
    lines[idx] = r.to;
  }
  return lines.join("\n");
}

// ── **Related:** scan ─────────────────────────────────────────────────────────
// Reported, never rewritten. `**Related:**` has NO reader in giwt and NO
// validator — invisible to every generated artifact. This counts the
// well-formed refs it contains and lists the ones resolving to no file.

/**
 * A ref token: an id or slug ending in `.md`, or a bare TYPED id
 * (`FEAT-036`, `BUG-nsfw-gate-not-logged`). An untyped bare slug is prose —
 * `epic-items` in a sentence is indistinguishable from a reference, so it is
 * only counted when written as a path.
 */
/** Token grammar for `**Related:**` values: the optional
 * `.plan/(tickets|epics)/` prefix, then a slug ending in `.md` or a typed
 * id. Slash boundaries keep path-ish prose from tokenizing, so a ref can
 * never traverse out of the plan dirs. */
const RELATED_REF_TOKEN =
  /(?:^|[\s,(`])((?:\.plan\/(?:tickets|epics)\/)?(?:[A-Z]{2,6}-)?[a-z0-9][a-z0-9._-]*\.md|(?:BUG|FEAT|TASK|TEST|DOC|EPIC)-[A-Za-z0-9][A-Za-z0-9._-]*)(?=$|[\s,)`])/gi;

/**
 * Every raw `**Related:**` ref token in a file, in order of first
 * appearance, deduped. No resolution — callers decide how a token maps to
 * a plan file (exact slug, index extid, unique prefix). Accepts both bare
 * tokens and the `.plan/(tickets|epics)/`-prefixed form. Token shape is
 * safe by construction: no leading slash, no `..` segments, so a ref can
 * never traverse out of the plan dirs.
 */
export function relatedRefTokens(text: string): string[] {
  const line = text.match(/^\s*\*\*Related:?\*\*\s*(.*)$/im)?.[1]?.trim();
  const tokens: string[] = [];
  if (!line) return tokens;
  for (const hit of line.matchAll(RELATED_REF_TOKEN)) {
    const ref = hit[1];
    if (ref !== undefined && !tokens.includes(ref)) tokens.push(ref);
  }
  return tokens;
}

/** Every `**Related:**` ref in a file that names a known plan file. */
export function relatedRefs(
  text: string,
  known: Set<string>,
): { refs: string[]; dangling: string[]; } {
  const refs: string[] = [];
  const dangling: string[] = [];
  for (const ref of relatedRefTokens(text)) {
    const slug = ref.replace(/^\.plan\/(?:tickets|epics)\//, "").replace(/\.md$/, "");
    if (known.has(slug) || known.has(slug.replace(/^[A-Z]{2,6}-/, ""))) refs.push(ref);
    else dangling.push(ref);
  }
  return { refs, dangling };
}
