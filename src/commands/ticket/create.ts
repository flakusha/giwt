// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { resolve } from "path";
import { detectNestedTicketDoc } from "../../tickets/ticket-md";
import type { WorktreeConfig } from "../../utils/config";
import { getWorktreeRoot, gitSync } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { generatedHeader } from "../../utils/reuse-toml";
import { parseTicketArgs, type TicketFlags } from "./args";
import { closeTickets } from "./close";
import { copyTickets } from "./copy";
import { renderTicketFile } from "./render";
import { threeWay } from "./threeway";

const VALID_TYPES = ["BUG", "FEAT", "FIX", "IDEA", "TASK", "SOL", "INFRA"] as const;
type TicketType = typeof VALID_TYPES[number];

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;

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

  // A body that is itself a complete ticket document (own SPDX header,
  // `# TYPE:` title, `**Status:**` block) would land verbatim under the
  // template header — one .md nesting two ticket documents. Refuse before
  // anything is written or created.
  const nestedMarkers = detectNestedTicketDoc(body);
  if (nestedMarkers.length > 0) {
    refuse(
      `body looks like a complete ticket document — contains ${nestedMarkers.join(", ")}`,
      "pass the description prose only; the template supplies the SPDX header, title, and Status block",
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
    // Duplicate create must refuse: warn-and-continue forked the registry
    // (a second `git issue create` for an extid that already has a file
    // and often an issue). Refusal is distinct from other failures.
    refuse(
      `duplicate ticket: ${ticketFile} already exists for ${extid} — refusing to create a second ticket`,
      `edit ${ticketFile} in place, or delete it first if this is genuinely new work`,
    );
  }
  log("info", `creating ticket file: ${ticketFile}`);
  await Bun.write(
    ticketPath,
    renderTicketFile(type, title, flags, body, { header: generatedHeader(ticketPath, ".md") }),
  );
  log("success", `created ticket file: ${ticketFile}`);

  const hash = createGitIssue(config, extid, fullTitle, body, ticketFile, flags);

  log("info", `ticket ${extid} created`);
  raw(`  File:  ${ticketFile}`);
  if (hash) raw(`  Issue: ${hash}`);
}

/**
 * Create the registry side of a ticket: `git issue create`, then the
 * label/priority edits and the plan-spec comment. Exits 1 when the create
 * call fails, naming the half-completed state (the .md is already on disk,
 * the issue is missing) so a nonzero exit always carries a diagnostic.
 *
 * @returns the issue hash, or "" when the create output was unparsable
 */
function createGitIssue(
  config: WorktreeConfig,
  extid: string,
  fullTitle: string,
  body: string,
  ticketFile: string,
  flags: TicketFlags,
): string {
  log("info", `creating git issue: ${extid}`);
  let issueOutput: string;
  try {
    issueOutput = gitSync(
      config.repoRoot,
      "issue",
      "create",
      fullTitle,
      "-m",
      body || "No description",
    );
  } catch (e) {
    // gitSync throws git's stderr text; surface it against the file that
    // was already written instead of dying silently (the historical exit-1
    // after write had no diagnostic).
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    refuse(
      `ticket file ${ticketFile} written, but git issue create failed: ${msg}`,
      "resolve the git-issue error above, then rerun — the .md is already on disk",
    );
  }

  const hash = issueOutput.match(/[0-9a-f]{7,40}/)?.[0] ?? "";
  if (!hash) {
    log("warn", "could not extract issue hash");
    return "";
  }

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
  return hash;
}

/** Exit 1 with a distinct error + remedy line (the run-record exit hook
 *  finalizes the record; never returns). */
function refuse(reason: string, remedy: string): never {
  log("error", reason);
  raw(`  Remedy: ${remedy}`);
  process.exit(1);
}
