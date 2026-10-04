// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt task` — render an agent task prompt to stdout: generic
 * implementation recommendations conditioned on the flags, with the
 * user directive as the final (authoritative) section. Pure output:
 * no repo mutation, no git calls; the ledger row lands via dispatch.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveFromRoot } from "../plan/validate";
import { parseTicketFile } from "../tickets/sync-index";
import { normalizeStatus } from "../tickets/sync-normalize";
import type { IndexEntry } from "../tickets/sync-ticket-types";
import type { WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import {
  directiveSlug,
  isGateCsv,
  parseTaskArgs,
  type SkillsMode,
  TaskArgError,
  type TaskFlags,
} from "./task/args";
import { readTicketIndex } from "./ticket/lookup";

export const TASK_USAGE = `  <directive...> [flags]
  <directive...>            task text (positional); conflicts with -m/-F
  -m, -d, --message, --directive <t>   explicit directive text
  -F, --file <path>         read directive from file ("-" = stdin)
  --roster                  print the open-work roster as JSON (no task text)
  -j, --jobs <n>            finalization jobs; 0 = do not finalize (default: CLI default)
  -a, --agents <n>          subagent budget: 0 none, -1 unbounded, N cap (default: omit)
  --good <n>, --fast <n>    explicit good/fast subagent split (conflicts with -a 0)
  -g, --gates <all|csv|prose>  gates to ignore: "all" urgent-merge skip, csv -> finalize --skip-gates, prose verbatim
  --strict                  run the full gate suite (conflicts with -g)
  --shallow | --deep        research depth (default: agent judgment)
  -s, --skills <min|max|reasonable>  docs/skills reading mode (default: none beyond the task)
  -w, --worktree[=name]     open a new worktree first; bare form derives a slug
  --base <ref>              base ref for the new worktree (implies -w)
  --tickets <csv>           tickets to attach to the new worktree (implies -w)
  --follow <t>              "follow patterns" directive line (repeatable)
  --careful <t>             "be careful about" directive line (repeatable)
  --docs <t>                "check repo docs" directive line (repeatable)`;

function agentLines(flags: TaskFlags): string[] {
  const lines: string[] = [];
  if (flags.agents === 0) {
    lines.push("- Subagents: do not use any subagents.");
  } else if (flags.agents === -1) {
    lines.push(
      "- Subagents: use as many as possible until the rate limit or an error stops you;"
        + " split them good (complex) vs fast (mechanical).",
    );
  } else if (flags.agents !== undefined) {
    lines.push(
      `- Subagents: prefer up to ${flags.agents}; split them good (complex) vs`
        + " fast (mechanical) by subtask complexity.",
    );
  }
  if (flags.good !== undefined || flags.fast !== undefined) {
    const good = flags.good ?? 0;
    const fast = flags.fast ?? 0;
    lines.push(`- Subagent split: ${good} good (complex), ${fast} fast (mechanical).`);
  }
  return lines;
}

function gateLine(flags: TaskFlags): string {
  if (flags.strict) {
    return "- Gates: run the full gate suite on finalization, including unrelated gates.";
  }
  const gates = flags.gates;
  if (gates === undefined) {
    return (
      "- Gates: on finalization run the gates related to the areas this task touches;"
      + " leave no new lint/format warnings or other tech debt behind."
    );
  }
  if (gates === "all") {
    return "- Gates: ignore all gates - urgent merge, minimal testing (finalize --force).";
  }
  if (gates === "none") return "- Gates: do not skip any gates on finalization.";
  if (isGateCsv(gates)) {
    return `- Gates: skip these gates on finalization (finalize --skip-gates ${gates}).`;
  }
  return `- Gates: ${gates}`;
}

function skillsLine(mode: SkillsMode | undefined): string {
  if (mode === "min") {
    return "- Skills/docs: avoid advertised/suggested skills; consult project docs only when strictly needed.";
  }
  if (mode === "max") {
    return "- Skills/docs: read the relevant project docs and advertised skills before implementing.";
  }
  if (mode === "reasonable") {
    return "- Skills/docs: read only project docs directly relevant to this task; skip tangential skills.";
  }
  return (
    "- Skills/docs: do not read additional skills, project docs, or harness docs"
    + " beyond what this task strictly requires."
  );
}

function depthLine(depth: TaskFlags["depth"]): string | undefined {
  if (depth === "shallow") return "- Research: jump straight in - minimal repository research.";
  if (depth === "deep") {
    return "- Research: study repository state first (docs, recent history, related modules) before editing.";
  }
  return undefined;
}

function worktreeLines(flags: TaskFlags): string[] {
  if (flags.worktree === undefined && flags.base === undefined && flags.tickets.length === 0) {
    return [];
  }
  const name = typeof flags.worktree === "string"
    ? flags.worktree
    : directiveSlug(flags.directive) || "task-worktree";
  const base = flags.base !== undefined ? ` ${flags.base}` : "";
  const lines = [`- Worktree: open a new worktree first: \`giwt new ${name}${base}\`.`];
  if (flags.tickets.length > 0) {
    lines.push(
      `  Attach tickets: \`giwt new ${name}${base} --tickets ${flags.tickets.join(",")}\``
        + " (finalize closes them and reconciles the plan).",
    );
  }
  return lines;
}

function renderTask(flags: TaskFlags, directive: string): string {
  const lines = ["# Task", "", directive.trim(), "", "## Implementation"];
  lines.push(...worktreeLines(flags));
  const depth = depthLine(flags.depth);
  if (depth !== undefined) lines.push(depth);
  lines.push(skillsLine(flags.skills));
  lines.push(...agentLines(flags));
  lines.push(gateLine(flags));
  for (const f of flags.follow) lines.push(`- Follow patterns: ${f}`);
  for (const c of flags.careful) lines.push(`- Be careful about: ${c}`);
  for (const d of flags.docs) lines.push(`- Check repo docs: ${d}`);
  lines.push("", "## Finalization");
  if (flags.jobs === 0) {
    lines.push("- Do not finalize changes; leave them committed on the worktree branch.");
  } else if (flags.jobs === undefined) {
    lines.push("- When done: `giwt finalize <branch>` (gates per the guidance above).");
  } else {
    lines.push(`- When done: \`giwt finalize <branch> --jobs ${flags.jobs}\`.`);
  }
  lines.push("", "## Directive (user - authoritative)", directive.trim());
  return `${lines.join("\n")}\n`;
}

/** One machine-readable open-work entry: `giwt task --roster`. */
export interface RosterEntry {
  id: string;
  title: string;
  source: "plan";
}

/**
 * Open-work roster: ticket-index entries (`.plan/tickets/index.json`, keyed
 * by extid) merged with unindexed `.plan/tickets/*.md` plan files, done-
 * class entries filtered out. Read-only reuse of the sync/lookup readers —
 * no subprocesses. Sorted by id for stable output.
 */
export function collectRoster(config: WorktreeConfig): RosterEntry[] {
  const ticketsPath = config.settings.paths.tickets;
  const root = config.worktreeRoot;
  const byId = new Map<string, RosterEntry>();
  const put = (id: string, title: string): void => {
    byId.set(id.toLowerCase(), { id, title, source: "plan" });
  };
  const isOpen = (status: string | undefined): boolean =>
    status === undefined || normalizeStatus(status) !== "done";

  let index: Record<string, IndexEntry> = {};
  try {
    index = readTicketIndex(root, ticketsPath);
  } catch {
    index = {}; // corrupt index degrades to the .md scan below
  }
  for (const [extid, entry] of Object.entries(index)) {
    if (!isOpen(entry.status)) continue;
    put(extid, entry.title || extid);
  }

  const ticketsDir = resolveFromRoot(root, ticketsPath);
  if (existsSync(ticketsDir)) {
    for (const name of readdirSync(ticketsDir).filter((f) => f.endsWith(".md")).sort()) {
      const ticket = parseTicketFile(join(ticketsDir, name), join(ticketsPath, name));
      if (ticket === null || !isOpen(ticket.status)) continue;
      const id = name.replace(/\.md$/, "");
      if (byId.has(id.toLowerCase())) continue; // index entry wins
      put(id, ticket.title);
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Handler: parse, resolve the directive (-F file/stdin), render. */
export async function task(args: string[], config: WorktreeConfig): Promise<void> {
  let flags: TaskFlags;
  try {
    flags = parseTaskArgs(args);
  } catch (e) {
    if (e instanceof TaskArgError) {
      log("error", `task: ${e.message}`);
      raw(TASK_USAGE);
      process.exit(1);
    }
    throw e;
  }
  if (flags.roster) {
    raw(JSON.stringify(collectRoster(config), null, 2));
    return;
  }
  let directive = flags.directive;
  if (flags.file !== undefined) {
    directive = flags.file === "-"
      ? (await new Response(Bun.stdin.stream()).text()).trim()
      : (await Bun.file(flags.file).text()).trim();
  }
  if (directive.length === 0) {
    log("error", "task: missing task text (positional, -m/--message, or -F/--file)");
    raw(TASK_USAGE);
    process.exit(1);
  }
  raw(renderTask(flags, directive));
}
