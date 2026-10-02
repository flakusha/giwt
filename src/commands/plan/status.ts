// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKLOG_INDEX_FILES, reconcile } from "../../plan/backlog-sync";
import { readMap } from "../../plan/code-map";
import { resolveStatus } from "../../plan/status-vocab";
import { resolveFromRoot } from "../../plan/validate";
import { STATUS_LINE_RE } from "../../tickets/sync-index";
import type { WorktreeConfig } from "../../utils/config";
import { parseOutFlags, renderRecords } from "../../utils/emit";
import { log, raw, section } from "../../utils/output";

/** Per-subsystem status entry for the plan status overview. */
interface StatusEntry {
  label: string;
  count: number;
  note: string;
}

/** One row of `giwt plan status --tickets` output. */
interface TicketStatusRecord {
  name: string;
  status: string;
  unticked: number;
  path: string;
}

/**
 * Read per-ticket status from `<planDir>/tickets/*.md` in the current
 * checkout. Status extraction reuses sync-index's STATUS_LINE_RE over the
 * header region (first 30 lines), first match wins — exactly what the
 * ticket index sync sees; files with no Status line report "undefined".
 * Unticked acceptance counts scan the WHOLE file for `- [ ]`.
 */
function collectTicketStatuses(ticketsDir: string): TicketStatusRecord[] {
  if (!existsSync(ticketsDir)) return [];
  const records: TicketStatusRecord[] = [];
  for (const name of readdirSync(ticketsDir).filter((f) => f.endsWith(".md")).sort()) {
    const path = join(ticketsDir, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue; // vanished mid-scan — a report command must not crash on it
    }
    const status = text
      .split("\n")
      .slice(0, 30)
      .map((l) => STATUS_LINE_RE.exec(l)?.[1]?.trim() ?? "")
      .find((v) => v.length > 0) ?? "undefined";
    const unticked = (text.match(/- \[ \]/g) ?? []).length;
    records.push({ name, status, unticked, path });
  }
  return records;
}

/** `plan status --tickets` — per-ticket lines + status rollup. */
function runStatusTickets(
  format: ReturnType<typeof parseOutFlags>["format"],
  ticketsDir: string,
  config: WorktreeConfig,
): void {
  const records = collectTicketStatuses(ticketsDir);

  if (format !== "human") {
    raw(renderRecords(records, format, {
      emoji: (record) => {
        const r = record as TicketStatusRecord;
        const mark = r.unticked > 0 ? "🟡" : "✅";
        return `${mark} ${r.status} · ${r.unticked} unticked · ${r.name}`;
      },
    }));
    return;
  }

  for (const { status, unticked, name } of records) {
    raw(`${status}  ${unticked}  ${name}`);
  }
  const counts = new Map<string, number>();
  let totalUnticked = 0;
  for (const { status, unticked } of records) {
    // Rollup by canonical vocabulary class, not the raw line: prose
    // annotations like "Done (shipped: ...)" collapse into Done.
    const core = status === "undefined"
      ? "undefined"
      : status.replace(/\s*\([^()]*\)\s*$/, "");
    const canonical = core === "undefined"
      ? "undefined"
      : resolveStatus(core, config.settings.status.aliases).value;
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    totalUnticked += unticked;
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([status, count]) => `${status}×${count}`);
  raw(
    `rollup: ${parts.length > 0 ? parts.join(", ") : "(no tickets)"} · unticked ${totalUnticked}`,
  );
}

export async function runStatus(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const isHelp = args.includes("--help") || args.includes("-h");
  const { format } = parseOutFlags(args);
  const ticketsFlag = args.includes("--tickets");
  const multipleFormats =
    args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1;
  const unknown = args.filter(
    (a) =>
      a !== "--tickets" && a !== "--json" && a !== "--toml" && a !== "--emoji"
      && a !== "--help" && a !== "-h",
  );
  if (unknown.length > 0 || isHelp) {
    raw("Usage: giwt plan status [--tickets] [--json|--toml|--emoji]");
    raw("  Show .plan/ health summary (ticket count, epic count, sync state)");
    raw("  --tickets              per-ticket Status line + unticked acceptance count");
    raw("  --json/--toml/--emoji  machine formats for the --tickets records");
    process.exit(isHelp ? 0 : 1);
  }
  if (format !== "human" && !ticketsFlag) {
    log("error", "--json/--toml/--emoji require --tickets (no records without it)");
    process.exit(1);
  }
  if (multipleFormats) {
    log("warn", `multiple output flags given — using --${format}`);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const ticketsDir = join(planDir, "tickets");

  if (ticketsFlag) {
    runStatusTickets(format, ticketsDir, config);
    return;
  }

  const epicsDir = join(planDir, "epics");
  const backlogDir = join(planDir, "backlog");
  const codeMapPath = join(planDir, "code-map.json");
  const epicsIndexPath = join(planDir, "epics-index.md");

  const entries: StatusEntry[] = [];

  // Tickets
  const ticketCount = existsSync(ticketsDir)
    ? readdirSync(ticketsDir).filter((f) => f.endsWith(".md")).length
    : 0;
  entries.push({
    label: "Tickets",
    count: ticketCount,
    note: existsSync(ticketsDir) ? "" : "(dir missing)",
  });

  // Epics
  const epicCount = existsSync(epicsDir)
    ? readdirSync(epicsDir).filter((f) => f.startsWith("epic-") && f.endsWith(".md")).length
    : 0;
  entries.push({
    label: "Epics",
    count: epicCount,
    note: existsSync(epicsDir) ? "" : "(dir missing)",
  });

  // Backlog tiers
  const backlogResult = existsSync(backlogDir)
    ? reconcile(backlogDir, [...BACKLOG_INDEX_FILES])
    : null;
  const backlogFileCount = existsSync(backlogDir)
    ? readdirSync(backlogDir).filter((f) => f.endsWith(".md")).length
    : 0;
  entries.push({
    label: "Backlog files",
    count: backlogFileCount,
    note: backlogResult
      ? backlogResult.issueCount === 0
        ? "in sync"
        : `${backlogResult.issueCount} issue(s)`
      : "(dir missing)",
  });

  // Code map
  const codeMapExists = existsSync(codeMapPath);
  const codeMapCount = codeMapExists
    ? Object.keys(readMap(codeMapPath)).length
    : 0;
  entries.push({
    label: "Code map",
    count: codeMapCount,
    note: codeMapExists ? "exists" : "(missing — run `giwt plan code-map`)",
  });

  // Epics index
  const epicsIndexExists = existsSync(epicsIndexPath);
  entries.push({
    label: "Epics index",
    count: epicsIndexExists ? 1 : 0,
    note: epicsIndexExists ? "exists" : "(missing — run `giwt plan gen-docs`)",
  });

  // Print
  section("Plan Status");
  const maxLabel = Math.max(...entries.map((e) => e.label.length));
  for (const { label, count, note } of entries) {
    const padded = label.padEnd(maxLabel);
    const notePart = note ? `  ${note}` : "";
    raw(`  ${padded}  ${String(count).padStart(3)}${notePart}`);
  }
}
