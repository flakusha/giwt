// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Epic owner-picking rule for multi-epic **Epic:** values.
 *
 * The first listed candidate that names an existing .plan/epics/<slug>.md
 * wins. Unresolvable values are reported, never guessed.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertIndexUnedited } from "../tickets/index-stamp";
import { persistIndexCanonical } from "../tickets/sync-index-write";
import type { WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import { canonicalIndexOrder, type IndexEntryLike } from "./index-projection";
import { fieldLines } from "./metadata-fields";
import { resolveFromRoot } from "./validate";

/** Split a multi-epic value into candidates, in author order. */
export function splitEpicCandidates(raw: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  const push = () => {
    const token = current.trim()
      .replace(/^[`*>\s]*/, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .replace(/[`*\s]*$/, "")
      .replace(/^\.plan\/epics\//, "")
      .replace(/\.md$/i, "")
      .replace(/[`*\s]*$/, "")
      .trim();
    if (token) chunks.push(token);
    current = "";
  };
  for (const char of raw) {
    if (char === "(") depth++;
    if (char === ")" && depth > 0) depth--;
    const plusJoins = char === "+" && depth === 0 && /\([^)]*\)\s*$/.test(current);
    const isSep = char === "," || char === ";" || (char === "/" && depth === 0) || plusJoins;
    if (isSep && !current.includes(".plan/epics/")) push();
    else current += char;
  }
  push();
  return chunks;
}

/** The owning epic for a raw **Epic:** value, or null when nothing resolves. */
export function pickEpicOwner(
  raw: string,
  slugs: ReadonlySet<string>,
  titles: Readonly<Record<string, string>>,
): string | null {
  const whole = raw.trim();
  const wholeTitled = titles[whole];
  if (wholeTitled && slugs.has(wholeTitled)) return wholeTitled;
  for (const candidate of splitEpicCandidates(raw)) {
    if (slugs.has(candidate)) return candidate;
    const titled = titles[candidate];
    if (titled && slugs.has(titled)) return titled;
  }
  return null;
}

const EPIC_H1 = /^#\s+EPIC:\s*(.+?)\s*$/m;
const EPIC_H1_LEGACY = /^#\s+Epic:\s*(.+?)\s*$/m;

/** Scan epic H1s into a title slug table. */
export function scanEpicTitles(
  dir: string,
): { titles: Record<string, string>; ambiguous: string[]; } {
  const titles: Record<string, string> = {};
  const ambiguous: string[] = [];
  for (
    const file of readdirSync(dir).filter((f) => f.startsWith("epic-") && f.endsWith(".md")).sort()
  ) {
    const text = readFileSync(join(dir, file), "utf8");
    const match = text.match(EPIC_H1) ?? text.match(EPIC_H1_LEGACY);
    const title = match?.[1]?.trim();
    if (!title) continue;
    if (title in titles) {
      ambiguous.push(`${title}: kept ${titles[title]}, dropped ${file.replace(/\.md$/, "")}`);
    } else titles[title] = file.replace(/\.md$/, "");
  }
  return { titles, ambiguous };
}

export async function runEpicOwnerPick(args: string[], config: WorktreeConfig): Promise<void> {
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  const unknown = args.filter((a) =>
    a !== "--apply" && a !== "--dry-run" && a !== "--help" && a !== "-h"
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan epic-owner-pick [--apply|--dry-run]");
    raw("  Collapse multi-epic **Epic:** values to the first existing epic owner");
    raw("  --apply  rewrite ticket .md files and index.json (default: dry-run)");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const epicsDir = join(planDir, "epics");
  const slugs = new Set(
    existsSync(epicsDir)
      ? readdirSync(epicsDir).filter((f) => f.startsWith("epic-") && f.endsWith(".md")).map((f) =>
        f.replace(/\.md$/, "")
      )
      : [],
  );
  const { titles, ambiguous } = existsSync(epicsDir)
    ? scanEpicTitles(epicsDir)
    : { titles: {}, ambiguous: [] };

  if (ambiguous.length > 0) {
    for (const line of ambiguous) raw(`  ambiguous: ${line}`);
  }

  const indexPath = join(planDir, "tickets", "index.json");
  if (!existsSync(indexPath)) {
    log("warn", `ticket index not found: ${indexPath}`);
    return;
  }
  // Fail closed on a stamped-but-mismatched index before consuming it.
  assertIndexUnedited(indexPath);
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, IndexEntryLike>;
  const next: Record<string, IndexEntryLike> = { ...index };
  let mdRewritten = 0;
  const owners = new Map<string, string>();
  const remainder: string[] = [];

  for (const [key, entry] of Object.entries(index)) {
    const rawValue = (entry.epic ?? "").trim();
    if (!rawValue) continue;
    const owner = pickEpicOwner(rawValue, slugs, titles);
    if (!owner) {
      if (/[,/;]/.test(rawValue) || !(rawValue in titles) && !slugs.has(rawValue)) {
        remainder.push(`${key}: no resolvable candidate :: ${rawValue.slice(0, 100)}`);
      }
      continue;
    }
    if (owner === rawValue) continue;
    if (!entry.source || !existsSync(join(config.worktreeRoot, entry.source))) {
      remainder.push(`${key}: owner ${owner} but source missing`);
      continue;
    }
    const abs = join(config.worktreeRoot, entry.source);
    const text = readFileSync(abs, "utf8");
    const line = fieldLines(text).find((l) => l.name === "Epic");
    if (!line) {
      remainder.push(`${key}: owner ${owner} but ticket has no Epic header`);
      continue;
    }
    const mdOwner = pickEpicOwner(line.value, slugs, titles);
    if (mdOwner !== owner) {
      remainder.push(`${key}: index picks ${owner} but md picks ${mdOwner ?? "nothing"}`);
      continue;
    }
    if (apply) {
      writeFileSync(abs, text.replace(line.raw, `**Epic:** ${owner}`));
    }
    next[key] = { ...entry, epic: owner };
    owners.set(key, owner);
    mdRewritten++;
  }

  if (apply) {
    // Canonical writer: atomic bytes + fresh fingerprint stamp.
    persistIndexCanonical(config.repoRoot, indexPath, canonicalIndexOrder(next));
  }

  raw(`dry-run: ${dryRun}`);
  raw(`owners: ${owners.size}, md rewrites: ${mdRewritten}`);
  for (const [key, owner] of [...owners.entries()].sort()) raw(`  ${key} -> ${owner}`);
  raw(`remainder (untouched, needs a human): ${remainder.length}`);
  for (const line of remainder.sort()) raw(`  ${line}`);
}
