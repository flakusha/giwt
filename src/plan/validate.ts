// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Comprehensive .plan/ validator — runs multiple checks in one pass.
 *
 * Gates (selectable via --gates flag):
 *   format     — ticket + epic format compliance
 *   linkage    — epic↔ticket cross-link validation
 *   backlog    — backlog index sync (orphans/phantoms)
 *   tickets    — ticket index sync (delegates to runSync)
 *   code-map   — code map freshness
 *   links      — markdown internal link check
 *   spdx       — SPDX header compliance
 *   naming     — ticket filename convention
 *   epics-doc  — epics-index.md freshness
 *   status-vocab — ticket **Status:** value vocabulary (aliases via settings)
 *   matrix     — feature-matrix.md freshness (projected from index.json)
 *   all        — run every gate (default)
 *
 * Each gate returns a GateResult with pass/fail + findings.
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { applyFixes, reconcile as reconcileBacklog } from "./backlog-sync";
import { runLinkCheck } from "./check-links";
import { buildMap, collectMdFiles, verifyFresh, writeMap } from "./code-map";
import { genMatrix, matrixOutput } from "./feature-matrix";
import { collectEpics, genDocs, generateIndex } from "./gen-docs";
import {
  resolveStatus,
  rewriteStatusLine,
  scanHeaderStatusLines,
  STATUS_ENUM,
} from "./status-vocab";

// ── Gate types ──────────────────────────────────────────────────

export type GateName =
  | "format"
  | "linkage"
  | "backlog"
  | "tickets"
  | "code-map"
  | "links"
  | "spdx"
  | "naming"
  | "epics-doc"
  | "matrix"
  | "status-vocab"
  | "all";

export const ALL_GATES: GateName[] = [
  "format",
  "linkage",
  "backlog",
  "tickets",
  "code-map",
  "links",
  "spdx",
  "naming",
  "epics-doc",
  "status-vocab",
  "matrix",
];

/** Gates that can be auto-fixed when --fix is passed. */
export const FIXABLE_GATES: GateName[] = [
  "backlog",
  "tickets",
  "code-map",
  "epics-doc",
  "status-vocab",
  "matrix",
];

/** A gate that actually runs ("all" is expanded by runValidate, never a result). */
export type ConcreteGate = Exclude<GateName, "all">;

/**
 * Resolve a configured path against a root, respecting absolute inputs.
 * `join(root, p)` concatenates an absolute `p` onto `root` — the historic
 * worktree doubling bug (ticket FIX-plan-validate-path-doubling) — so the
 * isAbsolute check must come before the join.
 */
export function resolveFromRoot(root: string, configured: string): string {
  return isAbsolute(configured) ? configured : join(root, configured);
}

export interface Finding {
  gate: GateName;
  level: "error" | "warn";
  message: string;
}

export interface GateResult {
  gate: GateName;
  pass: boolean;
  findings: Finding[];
  fixes?: string[];
}

export interface ValidateResult {
  results: GateResult[];
  pass: boolean;
  issueCount: number;
  fixedCount: number;
  /** Gates --fix could not repair (no auto-fix exists). Set only when opts.fix. */
  unfixableGates?: ConcreteGate[];
}

// ── Format gate ─────────────────────────────────────────────────

const TICKET_REQUIRED_SECTIONS = [
  "Status",
  "Priority",
  "Effort",
  "Summary",
  "Context",
  "Acceptance Criteria",
];

const EPIC_REQUIRED_SECTIONS = [
  "Status",
  "Priority",
  "Effort",
  "Type",
  "Tags",
  "Overview",
];

function checkTicketFormat(ticketsDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(ticketsDir)) {
    findings.push({
      gate: "format",
      level: "warn",
      message: `tickets dir not found: ${ticketsDir}`,
    });
    return findings;
  }
  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    const raw = readFileSync(join(ticketsDir, f), "utf8");
    for (const section of TICKET_REQUIRED_SECTIONS) {
      const re = new RegExp(`\\*\\*${section}:\\*\\*`, "i");
      if (!re.test(raw)) {
        findings.push({
          gate: "format",
          level: "error",
          message: `${f}: missing required section **${section}:**`,
        });
      }
    }
  }
  return findings;
}

function checkEpicFormat(epicsDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(epicsDir)) {
    findings.push({
      gate: "format",
      level: "warn",
      message: `epics dir not found: ${epicsDir}`,
    });
    return findings;
  }
  for (const f of readdirSync(epicsDir)) {
    if (!f.startsWith("epic-") || !f.endsWith(".md")) continue;
    const raw = readFileSync(join(epicsDir, f), "utf8");
    for (const section of EPIC_REQUIRED_SECTIONS) {
      const re = new RegExp(`\\*\\*${section}:\\*\\*`, "i");
      if (!re.test(raw)) {
        findings.push({
          gate: "format",
          level: "error",
          message: `${f}: missing required section **${section}:**`,
        });
      }
    }
  }
  return findings;
}

// ── Linkage gate ────────────────────────────────────────────────

function checkLinkage(ticketsDir: string, epicsDir: string): Finding[] {
  const findings: Finding[] = [];

  if (!existsSync(ticketsDir) || !existsSync(epicsDir)) {
    return findings;
  }

  // Collect epic file names
  const epicFiles = new Set(
    readdirSync(epicsDir).filter((f) => f.startsWith("epic-") && f.endsWith(".md")),
  );

  // Check ticket → epic linkage. Also collects tickets with no **Epic:**
  // binding at all — reported below as ONE aggregated advisory finding.
  const unbound: string[] = [];
  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    const raw = readFileSync(join(ticketsDir, f), "utf8");
    const epicMatch = raw.match(/\*\*Epic:\*\*\s*(.+)/);
    if (!epicMatch) {
      unbound.push(f);
      continue;
    }
    const epicRef = epicMatch[1]!.trim();
    // Epic ref can be a filename like "epic-auth-flow.md" or a title
    const isFilename = epicRef.endsWith(".md");
    if (isFilename && !epicFiles.has(epicRef)) {
      findings.push({
        gate: "linkage",
        level: "error",
        message: `${f}: **Epic:** references non-existent file ${epicRef}`,
      });
    }
  }

  // Advisory: unbound tickets never fail the gate — the linkage gate passes
  // on error-count 0, and this finding is warn-level on purpose (mirrors the
  // sync report's unbound-to-epic advisory).
  if (unbound.length > 0) {
    const listed = unbound.slice(0, 10).join(", ");
    const more = unbound.length > 10 ? ` ... and ${unbound.length - 10} more` : "";
    findings.push({
      gate: "linkage",
      level: "warn",
      message: `${unbound.length} ticket(s) not bound to an epic (advisory): ${listed}${more}`,
    });
  }

  // Check epic → ticket linkage
  for (const f of epicFiles) {
    const raw = readFileSync(join(epicsDir, f), "utf8");
    const tasksSection = raw.match(/## Linked Tasks\s*\n([\s\S]*?)(?=\n##|$)/);
    if (!tasksSection) continue;
    const taskLinks = tasksSection[1]!.match(/\[([^\]]+)\]\(([^)]+)\)/g) ?? [];
    for (const link of taskLinks) {
      const m = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (!m) continue;
      const target = m[2]!;
      if (target.startsWith("./") || target.includes("/")) {
        const resolved = join(epicsDir, target);
        if (!existsSync(resolved)) {
          findings.push({
            gate: "linkage",
            level: "error",
            message: `${f}: Linked Tasks references missing file: ${target}`,
          });
        }
      }
    }
  }

  return findings;
}

// ── Backlog gate ────────────────────────────────────────────────

function checkBacklog(backlogDir: string, indexFiles: string[]): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(backlogDir)) {
    findings.push({
      gate: "backlog",
      level: "warn",
      message: `backlog dir not found: ${backlogDir}`,
    });
    return findings;
  }
  const result = reconcileBacklog(backlogDir, indexFiles);
  for (const f of result.orphans) {
    findings.push({
      gate: "backlog",
      level: "error",
      message: `orphan: ${f} (not listed in any index file map)`,
    });
  }
  for (const p of result.phantoms) {
    findings.push({
      gate: "backlog",
      level: "error",
      message: `phantom: ${p.index}:${p.row.line} → ${p.row.file} (file missing)`,
    });
  }
  for (const o of result.outside) {
    findings.push({
      gate: "backlog",
      level: "warn",
      message: `outside: ${o.index}:${o.row.line} → ${o.row.target} (targets outside backlog/)`,
    });
  }
  return findings;
}

// ── Code-map gate ───────────────────────────────────────────────

function checkCodeMap(
  projectRoot: string,
  mapPath: string,
  scanDirs: Array<{ dir: string; kind: string; }>,
): Finding[] {
  const findings: Finding[] = [];
  const fresh = buildMap(projectRoot, scanDirs);
  if (!existsSync(mapPath)) {
    findings.push({
      gate: "code-map",
      level: "error",
      message: `code-map.json missing — run \`giwt plan code-map\` to generate`,
    });
    return findings;
  }
  if (!verifyFresh(mapPath, fresh)) {
    findings.push({
      gate: "code-map",
      level: "error",
      message: `code-map.json is stale — run \`giwt plan code-map\` to regenerate`,
    });
  }
  return findings;
}

// ── Links gate ──────────────────────────────────────────────────

function checkLinks(
  projectRoot: string,
  scanDirs: string[],
  ticketsDir: string,
  srcDir: string,
): Finding[] {
  const findings: Finding[] = [];
  const result = runLinkCheck(projectRoot, scanDirs, ticketsDir, srcDir);
  for (const b of result.broken) {
    findings.push({
      gate: "links",
      level: "error",
      message: `${b.file}: broken link → ${b.target} (resolved ${b.resolved})`,
    });
  }
  for (const o of result.orphanRefs) {
    findings.push({
      gate: "links",
      level: "error",
      message: `${o.file}: orphan TASK ref ${o.ref} — line: ${o.line}`,
    });
  }
  for (const c of result.brokenComments) {
    findings.push({
      gate: "links",
      level: "error",
      message: `${c.file}: broken comment citation → ${c.path} (resolved ${c.resolved})`,
    });
  }
  return findings;
}

// ── SPDX gate ───────────────────────────────────────────────────

function checkSpdx(planDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(planDir)) return findings;

  const mdFiles = collectMdFiles(planDir, "");
  for (const f of mdFiles) {
    const raw = readFileSync(f, "utf8");
    if (!raw.includes("SPDX-License-Identifier:")) {
      findings.push({
        gate: "spdx",
        level: "error",
        message: `${f.slice(planDir.length + 1)}: missing SPDX-License-Identifier`,
      });
    }
  }
  return findings;
}

// ── Naming gate ─────────────────────────────────────────────────

function checkNaming(ticketsDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(ticketsDir)) return findings;

  const pattern = /^[A-Z]+-[\w-]+\.md$/;
  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    if (!pattern.test(f)) {
      findings.push({
        gate: "naming",
        level: "error",
        message: `${f}: does not match TYPE-kebab-case-title.md convention`,
      });
    }
  }
  return findings;
}

// ── Status-vocab gate ───────────────────────────────────────────

function checkStatusVocab(
  ticketsDir: string,
  statusAliases: Record<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(ticketsDir)) return findings;

  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    const path = join(ticketsDir, f);
    // scanHeaderStatusLines skips fenced code blocks — a `**Status:**` inside
    // a reproduction example is documentation, not metadata.
    for (const { value } of scanHeaderStatusLines(path)) {
      const { action } = resolveStatus(value, statusAliases);
      if (action === "valid") continue;
      findings.push({
        gate: "status-vocab",
        level: "error",
        message: `${f}: status "${value}" is not in the vocabulary (${STATUS_ENUM.join(", ")})`,
      });
    }
  }
  return findings;
}

// ── Epics-doc gate ──────────────────────────────────────────────

function checkEpicsDoc(epicsDir: string, outPath: string, backlogPath: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(outPath)) {
    findings.push({
      gate: "epics-doc",
      level: "error",
      message: `epics-index.md missing — run \`giwt plan gen-docs\` to generate`,
    });
    return findings;
  }
  const epics = collectEpics(epicsDir);
  const fresh = generateIndex(epics, backlogPath);
  const existing = readFileSync(outPath, "utf8");
  if (fresh !== existing) {
    findings.push({
      gate: "epics-doc",
      level: "error",
      message: `epics-index.md is stale — run \`giwt plan gen-docs\` to regenerate`,
    });
  }
  return findings;
}

// ── Ticket index gate (delegates to sync-index) ─────────────────

// Imported lazily to avoid circular deps; validate caller provides the
// runSync function. This keeps validate pure of CLI-side imports.
export type TicketSyncFn = (
  root: string,
  opts: { fix: boolean; verbose: boolean; ticketsPath: string; },
) => number;

function checkTicketIndex(
  worktreeRoot: string,
  ticketsPath: string,
  runSync: TicketSyncFn,
): Finding[] {
  const findings: Finding[] = [];
  const exitCode = runSync(worktreeRoot, {
    fix: false,
    verbose: false,
    ticketsPath,
  });
  if (exitCode !== 0) {
    findings.push({
      gate: "tickets",
      level: "error",
      message: `ticket index out of sync — run \`giwt sync\` to reconcile`,
    });
  }
  return findings;
}

// ── Fix functions (--fix mode) ──────────────────────────────────

/** Apply backlog fixes (orphans → index, phantoms → dropped). */
function fixBacklogGate(backlogDir: string, indexFiles: string[]): string[] {
  const result = reconcileBacklog(backlogDir, indexFiles);
  const report = applyFixes(backlogDir, result);
  return [...report.added, ...report.dropped];
}

/** Regenerate code-map.json from scratch. */
function fixCodeMapGate(
  projectRoot: string,
  mapPath: string,
  sources: Array<{ dir: string; kind: string; }>,
): string[] {
  const map = buildMap(projectRoot, sources);
  writeMap(mapPath, map);
  return [`regenerated code-map.json (${Object.keys(map).length} src paths)`];
}

/** Regenerate epics-index.md from scratch. */
function fixEpicsDocGate(epicsDir: string, outPath: string, backlogPath: string): string[] {
  const { output } = genDocs(epicsDir, outPath, backlogPath);
  return [`regenerated epics-index.md (${output.length} bytes)`];
}

/**
 * Rewrite fixable **Status:** values in ticket headers in place. Only the
 * value span of a Status line (first 30 lines) changes — decoration,
 * duplicate-of-* markers, and unresolvable values are left untouched.
 */
function fixStatusVocabGate(
  ticketsDir: string,
  statusAliases: Record<string, string>,
): string[] {
  const fixes: string[] = [];
  if (!existsSync(ticketsDir)) return fixes;

  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    const path = join(ticketsDir, f);
    const lines = readFileSync(path, "utf8").split("\n");
    let changed = false;
    // Same fence-aware scan as the check: fenced **Status:** lines are
    // documentation and are never rewritten.
    for (const { line, text } of scanHeaderStatusLines(path)) {
      const rw = rewriteStatusLine(text, statusAliases);
      if (!rw) continue;
      lines[line] = rw.line;
      changed = true;
      fixes.push(`${f}: "${rw.raw}" → "${rw.canonical}"`);
    }
    if (changed) writeFileSync(path, lines.join("\n"));
  }
  return fixes;
}

/** Run ticket index sync with fix=true. */
function fixTicketIndexGate(
  worktreeRoot: string,
  ticketsPath: string,
  runSyncFn: TicketSyncFn,
): string[] {
  runSyncFn(worktreeRoot, { fix: true, verbose: false, ticketsPath });
  return [`synced ticket index (index.json ↔ .md ↔ git issues)`];
}

// ── Main validate dispatcher ────────────────────────────────────

export interface ValidateOptions {
  projectRoot: string;
  worktreeRoot: string;
  ticketsDir: string;
  epicsDir: string;
  backlogDir: string;
  planDir: string;
  srcDir: string;
  codeMapPath: string;
  epicsIndexPath: string;
  mapSources: Array<{ dir: string; kind: string; }>;
  linkScanDirs: string[];
  backlogIndexFiles: string[];
  gates: GateName[];
  runSync: TicketSyncFn;
  /** Extra freeform → canonical Status aliases ([status.aliases] in giwt.toml). */
  statusAliases?: Record<string, string>;
  fix?: boolean;
}

export function runValidate(opts: ValidateOptions): ValidateResult {
  const gates = opts.gates.includes("all") ? ALL_GATES : opts.gates;
  const unknown = gates.filter((g) => !ALL_GATES.includes(g));
  if (unknown.length > 0) {
    throw new Error(
      `validate: unknown gate(s) ${unknown.join(", ")} — valid: all, ${ALL_GATES.join(", ")}`,
    );
  }
  const results: GateResult[] = [];
  const backlogPath = join(opts.planDir, "backlog", "open.md");

  for (const gate of gates) {
    switch (gate) {
      case "format": {
        const findings = [
          ...checkTicketFormat(opts.ticketsDir),
          ...checkEpicFormat(opts.epicsDir),
        ];
        results.push({
          gate,
          pass: findings.filter((f) => f.level === "error").length === 0,
          findings,
        });
        break;
      }
      case "linkage": {
        const findings = checkLinkage(opts.ticketsDir, opts.epicsDir);
        results.push({
          gate,
          pass: findings.filter((f) => f.level === "error").length === 0,
          findings,
        });
        break;
      }
      case "backlog": {
        const findings = checkBacklog(opts.backlogDir, opts.backlogIndexFiles);
        const hasErrors = findings.some((f) => f.level === "error");
        let pass = !hasErrors;
        let fixMsgs: string[] = [];
        if (opts.fix && hasErrors) {
          fixMsgs = fixBacklogGate(opts.backlogDir, opts.backlogIndexFiles);
          if (fixMsgs.length > 0) {
            // Re-check: applyFixes handles orphans/phantoms but "outside"
            // entries (warn level) remain — so error-level findings should
            // be gone after fix.
            const rechecked = checkBacklog(opts.backlogDir, opts.backlogIndexFiles);
            pass = !rechecked.some((f) => f.level === "error");
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "tickets": {
        const findings = checkTicketIndex(
          opts.worktreeRoot,
          opts.ticketsDir,
          opts.runSync,
        );
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          // Don't re-check — runSync is expensive (calls git issue CLI).
          // Trust the fix; user can re-run validate to confirm.
          fixMsgs = fixTicketIndexGate(opts.worktreeRoot, opts.ticketsDir, opts.runSync);
          if (fixMsgs.length > 0) pass = true;
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "code-map": {
        const findings = checkCodeMap(opts.projectRoot, opts.codeMapPath, opts.mapSources);
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          fixMsgs = fixCodeMapGate(opts.projectRoot, opts.codeMapPath, opts.mapSources);
          if (fixMsgs.length > 0) {
            const rechecked = checkCodeMap(opts.projectRoot, opts.codeMapPath, opts.mapSources);
            pass = rechecked.length === 0;
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "links": {
        const findings = checkLinks(
          opts.projectRoot,
          opts.linkScanDirs,
          opts.ticketsDir,
          opts.srcDir,
        );
        results.push({
          gate,
          pass: findings.length === 0,
          findings,
        });
        break;
      }
      case "spdx": {
        const findings = checkSpdx(opts.planDir);
        results.push({
          gate,
          pass: findings.length === 0,
          findings,
        });
        break;
      }
      case "naming": {
        const findings = checkNaming(opts.ticketsDir);
        results.push({
          gate,
          pass: findings.length === 0,
          findings,
        });
        break;
      }
      case "epics-doc": {
        const findings = checkEpicsDoc(opts.epicsDir, opts.epicsIndexPath, backlogPath);
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          fixMsgs = fixEpicsDocGate(opts.epicsDir, opts.epicsIndexPath, backlogPath);
          if (fixMsgs.length > 0) {
            const rechecked = checkEpicsDoc(opts.epicsDir, opts.epicsIndexPath, backlogPath);
            pass = rechecked.length === 0;
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "matrix": {
        const indexPath = join(opts.planDir, "tickets", "index.json");
        const outPath = join(opts.planDir, "feature-matrix.md");
        const findings: Finding[] = [];
        if (!existsSync(indexPath)) {
          findings.push({
            gate,
            level: "error",
            message: `${indexPath}: ticket index missing — run \`giwt sync\``,
          });
        } else {
          try {
            const fresh = matrixOutput(indexPath);
            if (!existsSync(outPath)) {
              findings.push({
                gate,
                level: "error",
                message: `${outPath}: missing — run \`giwt plan matrix\` to generate`,
              });
            } else if (readFileSync(outPath, "utf8") !== fresh.output) {
              findings.push({
                gate,
                level: "error",
                message: `${outPath}: stale — run \`giwt plan matrix\` to regenerate`,
              });
            }
          } catch (error) {
            findings.push({
              gate,
              level: "error",
              message: (error as Error).message,
            });
          }
        }
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass && existsSync(indexPath)) {
          // Regeneration is millisecond-scale (pure projection of the
          // index), so unlike the tickets gate we re-check after fixing.
          try {
            const { matrix } = genMatrix(indexPath, outPath);
            const rechecked = matrixOutput(indexPath);
            const clean = existsSync(outPath)
              && readFileSync(outPath, "utf8") === rechecked.output;
            if (clean) {
              // Regeneration resolves every finding — drop them so both the
              // per-gate pass and the aggregated issueCount reflect the
              // post-fix state (no re-run needed, unlike the tickets gate).
              findings.length = 0;
              pass = true;
            }
            fixMsgs = [`regenerated ${outPath} (${matrix.total} tickets)`];
          } catch {
            /* leave unfixed — findings already name the failure */
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "status-vocab": {
        const statusAliases = opts.statusAliases ?? {};
        const findings = checkStatusVocab(opts.ticketsDir, statusAliases);
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          fixMsgs = fixStatusVocabGate(opts.ticketsDir, statusAliases);
          if (fixMsgs.length > 0) {
            // Rewriting is a cheap in-place file edit, so re-check like the
            // code-map gate: the post-fix findings are exactly the values
            // --fix could not resolve (green only when none remain).
            const rechecked = checkStatusVocab(opts.ticketsDir, statusAliases);
            findings.length = 0;
            findings.push(...rechecked);
            pass = rechecked.length === 0;
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
    }
  }

  const issueCount = results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.level === "error").length,
    0,
  );
  const fixedCount = results.reduce(
    (sum, r) => sum + (r.fixes?.length ?? 0),
    0,
  );
  // A fixable gate that --fix left failing (the fix pass changed nothing)
  // is de-facto manual for these findings — report it alongside the
  // never-fixable gates so the summary names an actionable next step.
  const unfixable = opts.fix
    ? (results
      .filter((r) =>
        !r.pass
        && (!FIXABLE_GATES.includes(r.gate) || (r.fixes?.length ?? 0) === 0)
      )
      .map((r) => r.gate) as ConcreteGate[])
    : undefined;
  return {
    results,
    pass: issueCount === 0,
    issueCount,
    fixedCount,
    ...(unfixable && unfixable.length > 0 ? { unfixableGates: unfixable } : {}),
  };
}

// ── Bounded summary rendering (pure; caller prints) ─────────────

/** Max findings listed per gate in the default human summary (--json lifts the cap). */
export const MAX_LISTED_FINDINGS = 20;

/** Manual remedy per gate — every reported problem names an actionable next step. */
const MANUAL_FIX_HINTS: Record<ConcreteGate, string> = {
  format: "add the missing **Section:** headers to the flagged ticket/epic files",
  linkage: "add the missing epic↔ticket links to the flagged files",
  backlog: "reconcile the backlog indexes (giwt plan backlog-sync --fix)",
  tickets: "reconcile the ticket index (giwt sync)",
  "code-map": "regenerate .plan/code-map.json (giwt plan code-map)",
  links: "fix or remove the broken links/refs listed in the findings",
  spdx: "add an SPDX-License-Identifier header to the flagged .md files",
  naming: "rename the flagged files to the TYPE-kebab-case-title.md convention",
  "epics-doc": "regenerate .plan/epics-index.md (giwt plan gen-docs)",
  matrix: "regenerate .plan/feature-matrix.md (giwt plan matrix)",
  "status-vocab":
    "rename the flagged **Status:** values to the vocabulary, or add [status.aliases] entries in giwt.toml",
};

/** Per-gate error/warning counts for the summary line. */
function gateCounts(r: GateResult): string {
  const errors = r.findings.filter((f) => f.level === "error").length;
  const warns = r.findings.length - errors;
  const parts: string[] = [];
  if (errors > 0 || !r.pass) parts.push(`${errors} error(s)`);
  if (warns > 0) parts.push(`${warns} warning(s)`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** Explain which gates --fix left unfixed, each with a manual next step. */
export function renderUnfixableGates(gates: readonly ConcreteGate[]): string[] {
  return gates.map((g) => `--fix cannot auto-fix '${g}' — ${MANUAL_FIX_HINTS[g]}`);
}

/**
 * Render the summary-first, bounded validation report (no I/O):
 * per-gate pass/fail + counts, the first MAX_LISTED_FINDINGS findings per
 * gate, a "… and N more" pointer to --json, fix notes, and unfixable gates.
 */
export function renderValidateSummary(result: ValidateResult): string[] {
  const lines: string[] = [];
  for (const r of result.results) {
    const status = r.pass ? "✓" : "✗";
    const icon = r.pass ? "OK" : "FAIL";
    lines.push(`  ${status} ${r.gate.padEnd(12)} ${icon}${gateCounts(r)}`);
    for (const f of r.findings.slice(0, MAX_LISTED_FINDINGS)) {
      const prefix = f.level === "error" ? "  ✗" : "  ⚠";
      lines.push(`  ${prefix} ${f.message}`);
    }
    const hidden = r.findings.length - MAX_LISTED_FINDINGS;
    if (hidden > 0) {
      lines.push(`    … and ${hidden} more — full findings: giwt plan validate --json`);
    }
    for (const fx of r.fixes ?? []) {
      lines.push(`    ↳ fixed: ${fx}`);
    }
  }
  if (result.unfixableGates && result.unfixableGates.length > 0) {
    lines.push(...renderUnfixableGates(result.unfixableGates));
  }
  return lines;
}
