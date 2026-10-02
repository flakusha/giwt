// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "path";
import type { IndexEntry } from "../tickets/sync-ticket";
import type { WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { getWorktreeRoot, gitSync, isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { resolveExtid } from "./resolver";

const VALID_TYPES = ["BUG", "FEAT", "FIX", "IDEA", "TASK", "SOL", "INFRA"] as const;
type TicketType = typeof VALID_TYPES[number];

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export interface TicketFlags {
  labels: string[];
  priority: string;
  epic: string;
  tags: string[];
  effort: string;
}

function kebab(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * Strip a duplicated type-name prefix from the prose `title` so the git issue
 * title doesn't carry the same words twice (the extid already encodes them).
 *
 * Only strips when the title starts LITERALLY with `kebab(type)` (followed by
 * a space, dash, or colon — "BUG story", "BUG-story", "BUG: story"). No
 * fuzzy/kebab-prefix matching — that over-strips unrelated prose that merely
 * happens to share letters with the post-type segment.
 *   ("FEAT", "FEAT story UI") → "story UI"
 *   ("TASK", "TASK-")         → ""      (whole-title collapse)
 *   ("BUG",  "something else") → "something else"  (no literal BUG prefix)
 *
 * - Matches case-insensitively against `kebab(type)` (e.g. "BUG" → "bug").
 * - The .md filename uses `kebab(title)` (unstripped); only the git-issue
 *   prose uses the stripped form.
 */
export function stripTypePrefix(type: string, title: string): string {
  const prefix = kebab(type);
  if (!prefix) return title;
  const lower = title.toLowerCase();
  if (lower === prefix) return "";
  if (
    lower.startsWith(prefix + " ")
    || lower.startsWith(prefix + "-")
    || lower.startsWith(prefix + ":")
  ) {
    return title.slice(prefix.length + 1).trimStart();
  }
  return title;
}

/**
 * Render the ticket .md body written by `giwt ticket`.
 *
 * The shape is load-bearing: `plan validate`'s format gate requires the
 * `**Section:**` metadata markers, and its status-vocab gate requires a
 * canonical `**Status:**` value. The template must emit exactly what those
 * gates accept — a generated ticket that fails its own repo's gates is the
 * BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re defect.
 * ticket.test.ts pins this template against both gates' constants.
 */
export function renderTicketFile(
  type: string,
  title: string,
  flags: TicketFlags,
  body: string,
): string {
  let content =
    `<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->\n\n# ${type}: ${title}\n\n`;
  content += `**Status:** Not Started\n`;
  content += `**Priority:** ${flags.priority || "Medium"}\n`;
  content += `**Effort:** ${flags.effort}\n`;
  if (flags.epic) {
    content += `**Epic:** ${flags.epic}\n`;
  }
  if (flags.tags.length > 0) {
    content += `**Tags:** ${flags.tags.join(", ")}\n`;
  }
  content += `\n**Summary:**\n\n${body || "No description provided."}\n\n`;
  content +=
    `**Context:**\n\n(fill in before starting: why this change, constraints, alternatives considered.)\n\n`;
  content += `**Acceptance Criteria:**\n\n`;
  content += `- [ ] Implementation complete\n`;
  content += `- [ ] Tests passing\n`;
  content += `- [ ] Documentation updated\n`;
  return content;
}

export async function ticket(args: string[], config: WorktreeConfig): Promise<void> {
  // Subactions share the `ticket` command; none collide with VALID_TYPES.
  if (args[0] === "close") return closeTickets(args.slice(1), config);
  if (args[0] === "copy") return copyTickets(args.slice(1), config);
  if (args[0] === "3way") return threeWay(args.slice(1), config);

  const typeRaw = args[0]?.toUpperCase() ?? "";
  const title = args[1];

  if (!typeRaw || !title) {
    log("error", "type and title required");
    raw(
      "  Usage: ticket <TYPE> <title> [body] [flags] — flags may precede or follow the body",
    );
    raw(`  TYPE: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  if (!(VALID_TYPES as readonly string[]).includes(typeRaw)) {
    log("error", `unknown type '${typeRaw}' — use: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  const type = typeRaw as TicketType;
  const { flags, body } = parseTicketArgs(args.slice(2));

  if (flags.priority && !(VALID_PRIORITIES as readonly string[]).includes(flags.priority)) {
    log("error", `unknown priority '${flags.priority}' — use: ${VALID_PRIORITIES.join(", ")}`);
    process.exit(1);
  }

  if (!flags.epic) {
    log(
      "warn",
      "no --epic given — ticket will be unbound (giwt sync lists it under the unbound-to-epic advisory)",
    );
  }

  const ticketName = kebab(title);
  const ticketFile = `${config.settings.paths.tickets}/${type}-${ticketName}.md`;
  const extid = `${type}-${ticketName}`;
  // Issue title: collapse the prose when it duplicates the type-name words that
  // `extid` already encodes. The .md filename above still uses the full title.
  const issueTitle = stripTypePrefix(type, title);
  const fullTitle = `${extid}: ${issueTitle}`;
  // Plan files belong to the checkout in progress (worktree-aware): when the
  // CLI is invoked from inside tree/<branch>, the ticket file must land in
  // that worktree, not the main checkout (config.repoRoot is the *main* root
  // by design, since git issues live in the shared .git store).
  const planRoot = getWorktreeRoot();
  const ticketPath = resolve(planRoot, ticketFile);

  const exists = await Bun.file(ticketPath).exists();
  if (exists) {
    log("warn", `ticket file already exists: ${ticketFile}`);
  } else {
    log("info", `creating ticket file: ${ticketFile}`);
    await Bun.write(ticketPath, renderTicketFile(type, title, flags, body));
    log("success", `created ticket file: ${ticketFile}`);
  }

  log("info", `creating git issue: ${extid}`);
  const issueOutput = gitSync(
    config.repoRoot,
    "issue",
    "create",
    fullTitle,
    "-m",
    body || "No description",
  );

  const hashMatch = issueOutput.match(/[0-9a-f]{7,40}/);
  const hash = hashMatch?.[0];

  if (hash) {
    gitSync(config.repoRoot, "issue", "comment", hash, "-m", `Plan spec: ${ticketFile}`);
    // Single edit invocation: `git issue edit -l` replaces the whole label set,
    // so per-label edits would leave only the last label applied.
    if (flags.labels.length > 0) {
      gitSync(
        config.repoRoot,
        "issue",
        "edit",
        hash,
        ...flags.labels.flatMap((label) => ["-l", label]),
      );
    }
    if (flags.priority) {
      gitSync(config.repoRoot, "issue", "edit", hash, "-p", flags.priority);
    }
    log("success", `created git issue: ${hash}`);
  } else {
    log("warn", "could not extract issue hash");
  }

  log("info", `ticket ${extid} created`);
  raw(`  File:  ${ticketFile}`);
  if (hash) raw(`  Issue: ${hash}`);
}

/** Flag tokens `ticket` accepts in its arg tail. Static table per repo
 * convention (Set/Map are for dynamic membership only). */
const FLAG_TOKENS: Record<string, true> = {
  "-l": true,
  "--label": true,
  "-p": true,
  "--priority": true,
  "-e": true,
  "--epic": true,
  "--effort": true,
  "--tag": true,
};

/** Apply one flag + its value token to a flags record. Undefined value
 * (flag at end of args) is ignored — parity with the previous scan. */
function applyFlag(flags: TicketFlags, token: string, value: string | undefined): void {
  switch (token) {
    case "-l":
    case "--label": {
      if (value !== undefined) {
        flags.labels.push(...value.split(",").map((l) => l.trim()).filter((l) => l.length > 0));
      }
      break;
    }
    case "-p":
    case "--priority": {
      if (value !== undefined) flags.priority = value;
      break;
    }
    case "-e":
    case "--epic": {
      if (value !== undefined) flags.epic = value;
      break;
    }
    case "--effort": {
      if (value !== undefined) flags.effort = value;
      break;
    }
    case "--tag": {
      if (value !== undefined) {
        flags.tags.push(...value.split(",").map((t) => t.trim()).filter((t) => t.length > 0));
      }
      break;
    }
  }
}

/** Result of splitting the `ticket` arg tail (everything after
 * `TYPE TITLE`): the parsed flags plus the positional body. */
export interface ParsedTicketArgs {
  flags: TicketFlags;
  body: string;
}

/** Split the arg tail after `TYPE TITLE` into flags and the positional body
 * with one left-to-right scan
 * (BUG-giwt-ticket-drops-flags-that-follow-the-positional-body). Known flags
 * are consumed wherever they appear — before or after the body — each
 * swallowing its value token; `--` ends flag parsing (everything after is
 * positional); unknown `-`-prefixed tokens are positionals, so a
 * dash-leading body keeps working; extra positionals are ignored, matching
 * the old args.slice(3) scan. */
export function parseTicketArgs(tail: string[]): ParsedTicketArgs {
  const flags: TicketFlags = { labels: [], priority: "", epic: "", effort: "Medium", tags: [] };
  const positionals: string[] = [];
  for (let i = 0; i < tail.length; i++) {
    const token = tail[i];
    if (token === undefined) break;
    if (token === "--") {
      positionals.push(...tail.slice(i + 1));
      break;
    }
    if (FLAG_TOKENS[token] === true) {
      const value = tail[i + 1];
      if (value !== undefined) i++;
      applyFlag(flags, token, value);
    } else {
      positionals.push(token);
    }
  }
  return { flags, body: positionals[0] ?? "" };
}

// ── ticket close / copy / 3way ─────────────────────────────────

/** Metadata region of a ticket .md: field matching covers the first 30
 *  lines only (mirrors parseTicketFile in src/tickets/sync-index.ts). */
const HEADER_REGION_LINES = 30;

/** Canonical plan-vocabulary value a closed ticket's status carries. */
const STATUS_DONE = "Done";

/** Status-line rewrite, aligned with sync-index's --fix writer (the
 *  mdStatusStale replace): preserves the line's own `**Status**:` /
 *  `**Status:**` spelling, replaces the value with the canonical
 *  vocabulary term. */
const STATUS_LINE_REWRITE = /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim;

const ISSUE_HASH_RE = /^[0-9a-f]{7,}$/;

/** Parse a checkout's ticket index (`.plan/tickets/index.json`). Throws
 *  with the path named — repo convention for input errors. */
function readTicketIndex(
  checkoutRoot: string,
  ticketsPath: string,
): Record<string, IndexEntry> {
  const indexPath = resolve(checkoutRoot, ticketsPath, "index.json");
  if (!existsSync(indexPath)) {
    throw new Error(`${indexPath}: no ticket index (run 'giwt sync --fix' first)`);
  }
  try {
    return JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, IndexEntry>;
  } catch (error) {
    throw new Error(`${indexPath}: invalid JSON (${(error as Error).message})`, { cause: error });
  }
}

/** Resolve a `name|extid` operand against a parsed index: exact key match
 *  (case-insensitive) first, then the `.md` basename of the entry's
 *  `source` so `copy` accepts the plain file-name form. */
function lookupTicket(
  index: Record<string, IndexEntry>,
  input: string,
): { extid: string; entry: IndexEntry; } | null {
  const wanted = input.replace(/\.md$/i, "").toLowerCase();
  for (const [key, entry] of Object.entries(index)) {
    if (key.toLowerCase() === wanted) return { extid: key, entry };
  }
  for (const [key, entry] of Object.entries(index)) {
    if (basename(entry.source ?? "").replace(/\.md$/i, "").toLowerCase() === wanted) {
      return { extid: key, entry };
    }
  }
  return null;
}

/** Git-issue hash for an index entry: the entry's own hash when it looks
 *  real (not the `pending` placeholder), else a registry walk by extid.
 *  resolveExtid passes non-extid input through verbatim — only trust the
 *  result when it is hex. */
function issueHashFor(repoRoot: string, entry: IndexEntry): string | null {
  if (ISSUE_HASH_RE.test(entry.hash ?? "")) return entry.hash;
  if (ISSUE_HASH_RE.test(entry.git_issue ?? "")) return entry.git_issue!;
  const resolved = resolveExtid(repoRoot, entry.extid ?? "");
  return resolved && ISSUE_HASH_RE.test(resolved.hash) ? resolved.hash : null;
}

/** One closed ticket, for machine output. */
export interface CloseRecord {
  extid: string;
  file: string;
  issue?: string;
  status: string;
}

function closeEmoji(record: unknown): string {
  const rec = record as CloseRecord;
  return `✅ ${rec.extid} ${rec.file}${rec.issue ? ` (${rec.issue})` : ""} → ${rec.status}`;
}

/** Rewrite one ticket .md to its closed form: every status line in the
 *  header region (first 30 lines) re-valued to Done, every unchecked box
 *  ticked, and a `**Resolved:** <ISO date>[ <note>]` line appended past
 *  the header region (end of file — the placement sync-index uses for the
 *  git-issue reference). */
export function closeTicketFile(file: string, note: string, now: Date = new Date()): void {
  const lines = readFileSync(file, "utf8").split("\n");
  const rewritten = lines.map((line, i) =>
    i < HEADER_REGION_LINES ? line.replace(STATUS_LINE_REWRITE, `$1${STATUS_DONE}`) : line
  );
  let out = rewritten.join("\n").replaceAll("- [ ]", "- [x]");
  if (out !== "" && !out.endsWith("\n")) out += "\n";
  out += `**Resolved:** ${now.toISOString()}${note ? ` ${note}` : ""}\n`;
  writeFileSync(file, out);
}

/** `giwt ticket close <extid...> [--note "text"]` — close one or many
 *  tickets end to end: resolve each id through the invoking checkout's
 *  ticket index, rewrite the .md (status, boxes, Resolved line), and close
 *  its git issue in the shared registry. All ids resolve before anything
 *  mutates, so a typo cannot half-close a batch. */
export async function closeTickets(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const ids: string[] = [];
  let note = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--note" || arg === "-m") {
      i += 1;
      note = rest[i] ?? "";
    } else if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
    } else {
      ids.push(arg);
    }
  }
  if (ids.length === 0) {
    log("error", "ticket id required");
    raw(`  Usage: ticket close <extid...> [--note "text"] [--json|--toml|--emoji]`);
    process.exit(1);
  }

  const ticketsPath = config.settings.paths.tickets;
  const planRoot = config.worktreeRoot;
  const index = readTicketIndex(planRoot, ticketsPath);
  const resolved = ids.map((id) => {
    const hit = lookupTicket(index, id);
    if (!hit) {
      throw new Error(
        `${id}: no ticket index entry in ${resolve(planRoot, ticketsPath, "index.json")}`,
      );
    }
    return hit;
  });

  const records: CloseRecord[] = [];
  for (const { extid, entry } of resolved) {
    if (!entry.source) throw new Error(`${extid}: index entry has no source path`);
    const file = resolve(planRoot, entry.source);
    if (!existsSync(file)) throw new Error(`${entry.source}: ticket file missing`);

    closeTicketFile(file, note);

    const hash = issueHashFor(config.repoRoot, entry);
    if (hash) {
      gitSync(
        config.repoRoot,
        "issue",
        "state",
        hash,
        "--close",
        ...(note ? ["-m", note] : []),
      );
    } else {
      log("warn", `${extid}: no git issue found — closed the .md only`);
    }

    records.push({
      extid,
      file: entry.source,
      status: STATUS_DONE,
      ...(hash ? { issue: hash } : {}),
    });
  }

  if (format === "json" || format === "toml" || format === "emoji") {
    raw(renderRecords(records, format, { emoji: closeEmoji }));
    return;
  }
  for (const rec of records) {
    raw(`✅ ${rec.extid} ${rec.file} → ${rec.status}${rec.issue ? ` (issue ${rec.issue})` : ""}`);
  }
}

/** One copied ticket, for machine output. */
export interface CopyRecord {
  name: string;
  from: string;
  to: string;
}

function copyEmoji(record: unknown): string {
  const rec = record as CopyRecord;
  return `📋 ${rec.name} ${rec.from} → ${rec.to}`;
}

/** Split `ticket copy` args into id operands and the --to/--from direction. */
function parseCopyArgs(rest: string[]): { ids: string[]; to?: string; from?: string; } {
  const ids: string[] = [];
  let to: string | undefined;
  let from: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--to") {
      i += 1;
      to = rest[i];
    } else if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    } else if (arg === "--from") {
      i += 1;
      from = rest[i];
    } else if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
    } else {
      ids.push(arg);
    }
  }
  return {
    ids,
    ...(to !== undefined ? { to } : {}),
    ...(from !== undefined ? { from } : {}),
  };
}

/** `giwt ticket copy <name|extid...> --to|--from <checkout-path>` — copy
 *  resolved ticket .md bytes between the current checkout's plan dir and
 *  another checkout (repo root or linked worktree) of this repo. Refuses
 *  an unmerged source (`git ls-files -u`) and a same-directory target. */
export async function copyTickets(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const { ids, to, from } = parseCopyArgs(rest);
  if (ids.length === 0 || Boolean(to) === Boolean(from)) {
    log("error", "ticket ids and exactly one of --to/--from required");
    raw("  Usage: ticket copy <name|extid...> --to <checkout-path>   (copy out)");
    raw("         ticket copy <name|extid...> --from <checkout-path> (copy in)");
    process.exit(1);
  }

  const ticketsPath = config.settings.paths.tickets;
  const here = realpathSync(config.worktreeRoot);
  const rawOther = resolve(config.worktreeRoot, (to ?? from)!);
  if (!existsSync(join(rawOther, ".git"))) {
    throw new Error(`${rawOther}: not a git checkout (no .git)`);
  }
  const other = realpathSync(rawOther);
  if (other === here) {
    throw new Error(`${rawOther}: source and target checkout are the same directory`);
  }

  // --to: here → other; --from: other → here.
  const sourceRoot = to !== undefined ? here : other;
  const targetRoot = to !== undefined ? other : here;
  const targetTicketsDir = resolve(targetRoot, ticketsPath);
  const index = readTicketIndex(sourceRoot, ticketsPath);

  const records: CopyRecord[] = [];
  for (const id of ids) {
    const hit = lookupTicket(index, id);
    if (!hit) {
      throw new Error(
        `${id}: no ticket index entry in ${resolve(sourceRoot, ticketsPath, "index.json")}`,
      );
    }
    if (!hit.entry.source) throw new Error(`${hit.extid}: index entry has no source path`);
    const sourceFile = resolve(sourceRoot, hit.entry.source);
    if (!existsSync(sourceFile)) {
      throw new Error(`${hit.entry.source}: ticket file missing in ${sourceRoot}`);
    }

    // Refuse an unmerged source, naming the path. Conflict stages live in
    // the owning checkout's index, so ls-files runs against that root.
    const rel = relative(sourceRoot, sourceFile);
    const unmerged = gitSync(sourceRoot, "ls-files", "-u", "--", rel);
    if (unmerged) {
      const stages = unmerged.split("\n").length;
      throw new Error(
        `${rel}: unmerged in ${sourceRoot} (${stages} conflict stages) — resolve the conflict before copying`,
      );
    }

    const name = basename(hit.entry.source);
    const targetFile = resolve(targetTicketsDir, name);
    mkdirSync(targetTicketsDir, { recursive: true });
    copyFileSync(sourceFile, targetFile);
    records.push({ name, from: sourceFile, to: targetFile });
  }

  if (format === "json" || format === "toml" || format === "emoji") {
    raw(renderRecords(records, format, { emoji: copyEmoji }));
    return;
  }
  for (const rec of records) {
    raw(`📋 copied ${rec.from} → ${rec.to}`);
  }
}

// ── ticket 3way ────────────────────────────────────────────────

const STAGE_LABELS = ["BASE", "OURS", "THEIRS"] as const;

/** One conflict stage, for machine output. */
export interface StageRecord {
  kind: "stage";
  label: string;
  sha?: string;
  bytes: number;
}

/** One pairwise verdict, for machine output. */
export interface VerdictRecord {
  kind: "verdict";
  pair: string;
  verdict: string;
}

/** Raw blob content + byte size, or null when the object is unreadable. */
function readBlob(root: string, sha: string): { content: string; bytes: number; } | null {
  const result = Bun.spawnSync(["git", "-C", root, "cat-file", "-p", sha], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) return null;
  return { content: result.stdout.toString("utf8"), bytes: result.stdout.byteLength };
}

/** Unified-diff hunk count between two strings via `git diff --no-index`
 *  on temp files; equal inputs short-circuit to 0. Exported for tests —
 *  a real three-way conflict never yields an 'identical' pair. */
export function hunkCount(a: string, b: string): number {
  if (a === b) return 0;
  const dir = mkdtempSync(join(tmpdir(), "giwt-3way-"));
  try {
    writeFileSync(join(dir, "a"), a);
    writeFileSync(join(dir, "b"), b);
    // Exit code 1 means "differences found" — expected, not an error.
    const result = Bun.spawnSync(["git", "-C", dir, "diff", "--no-index", "--", "a", "b"], {
      stdout: "pipe",
      stderr: "pipe",
      env: isolatedGitEnv(),
    });
    return result.stdout.toString("utf8").split("\n").filter((l) => l.startsWith("@@")).length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pairVerdict(a: string, b: string): string {
  const hunks = hunkCount(a, b);
  return hunks === 0 ? "identical" : `changed (${hunks} hunks)`;
}

function threeWayEmoji(record: unknown): string {
  const rec = record as StageRecord | VerdictRecord;
  if (rec.kind === "stage") {
    return `📄 ${rec.label} ${rec.sha ?? "(absent)"} (${rec.bytes}b)`;
  }
  return `${rec.verdict === "identical" ? "🟢" : "🟡"} ${rec.pair}: ${rec.verdict}`;
}

/** `giwt ticket 3way <path>` — print the three conflict stages of an
 *  unmerged ticket path side by side (BASE/OURS/THEIRS with blob content)
 *  plus a changed/identical verdict per pair. Stages come from the
 *  invoking worktree's index (conflict state is per-worktree); blob
 *  objects resolve through the shared store. */
export async function threeWay(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const input = rest[0];
  if (!input) {
    log("error", "unmerged path required");
    raw("  Usage: ticket 3way <path> [--json|--toml|--emoji]");
    process.exit(1);
  }
  const file = resolve(config.worktreeRoot, input);
  const rel = relative(config.worktreeRoot, file);
  if (rel.startsWith("..")) {
    throw new Error(`${input}: outside checkout ${config.worktreeRoot}`);
  }

  const shas = new Map<number, string>();
  for (const line of gitSync(config.worktreeRoot, "ls-files", "-u", "--", rel).split("\n")) {
    const m = line.match(/^[0-7]{6} ([0-9a-f]{7,40}) ([123])\t/);
    if (m?.[1] && m[2]) shas.set(Number(m[2]), m[1]);
  }
  if (shas.size === 0) {
    throw new Error(`${rel}: not unmerged (no conflict stages in the index)`);
  }

  const stages = STAGE_LABELS.map((label, i) => {
    const sha = shas.get(i + 1) ?? null;
    const blob = sha === null ? null : readBlob(config.worktreeRoot, sha);
    return {
      label,
      sha,
      bytes: blob?.bytes ?? 0,
      content: blob?.content ?? "(absent)",
    };
  });
  const [base, ours, theirs] = stages;
  const verdicts = [
    { pair: "ours-vs-base", verdict: pairVerdict(ours!.content, base!.content) },
    { pair: "theirs-vs-base", verdict: pairVerdict(theirs!.content, base!.content) },
    { pair: "ours-vs-theirs", verdict: pairVerdict(ours!.content, theirs!.content) },
  ];

  if (format === "json" || format === "toml" || format === "emoji") {
    const records: Array<StageRecord | VerdictRecord> = [
      ...stages.map((s): StageRecord => (
        { kind: "stage", label: s.label, bytes: s.bytes, ...(s.sha ? { sha: s.sha } : {}) }
      )),
      ...verdicts.map((v): VerdictRecord => ({
        kind: "verdict",
        pair: v.pair,
        verdict: v.verdict,
      })),
    ];
    raw(renderRecords(records, format, { emoji: threeWayEmoji }));
    return;
  }

  for (const stage of stages) {
    raw(`── ${stage.label} ${stage.sha ?? "(absent)"} (${stage.bytes} bytes)`);
    raw(stage.content);
  }
  for (const v of verdicts) {
    raw(`${v.pair}: ${v.verdict}`);
  }
}
