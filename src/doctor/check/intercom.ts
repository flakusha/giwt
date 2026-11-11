// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `intercom` doctor check — read-only health of the durable coordination
 * store. Findings (all warning unless named):
 * - dangling `.tmp/intercom` link — store missing/re-keyed; re-run init;
 * - wrong-target `.tmp/intercom` link — a checkout pointing elsewhere;
 * - store drift — the store's key no longer matches the computed project
 *   key (repo moved/re-remote'd): re-run init to re-key, gc sweeps the old;
 * - stale claims — active lanes older than lane_stale_days;
 * - missing store with backend=pijul (error) — the pijul engine must be
 *   initialized before any claim.
 *
 * Never creates anything: init is the only store/link writer (DESIGN §4).
 */

import { existsSync } from "node:fs";
import { projectIdentity } from "../../intercom/ids";
import { projectLanes } from "../../intercom/projection";
import { linkStatus, readProjectMeta, storeDirFor } from "../../intercom/store";
import { capFindings, type CheckFinding, type CheckResult } from "./types.ts";

/** Settings-derived inputs threaded by runDoctorChecks. */
export interface IntercomCheckOptions {
  backend: "jsonl" | "pijul";
  laneStaleDays: number;
  /** The checkout whose `.tmp/intercom` link is inspected. */
  worktreeRoot: string;
}

function finding(
  file: string,
  rule: string,
  message: string,
  severity: "error" | "warning" = "warning",
): CheckFinding {
  return { file, line: 0, rule, message, severity, kind: "task" };
}

export function runIntercom(
  repoRoot: string,
  opts: IntercomCheckOptions,
  nowMs: number = Date.now(),
): CheckResult {
  const findings: CheckFinding[] = [];
  const notes: string[] = [];
  const identity = projectIdentity(repoRoot);
  const storeDir = storeDirFor(identity);
  const meta = readProjectMeta(storeDir);

  // The exposure link in this checkout.
  const link = `${opts.worktreeRoot}/.tmp/intercom`;
  const status = linkStatus(opts.worktreeRoot, storeDir);
  if (status.state === "dangling") {
    findings.push(
      finding(
        link,
        "intercom-link",
        `dangling link, target ${status.current} (store missing or re-keyed) — run giwt intercom init`,
      ),
    );
  } else if (status.state === "wrong") {
    findings.push(
      finding(
        link,
        "intercom-link",
        `wrong target (${
          status.isDir ? "real directory" : status.current
        }), expected ${storeDir} — refusing to re-point`,
      ),
    );
  } else if (status.state === "absent" && existsSync(storeDir)) {
    notes.push(
      "no .tmp/intercom link in this checkout — run giwt intercom init to expose the store",
    );
  }

  // Store drift: computed key vs the key the store was created with.
  if (meta !== null && meta.key !== identity.key) {
    findings.push(
      finding(
        storeDir,
        "intercom-drift",
        `store keyed '${meta.key}' but project computes '${identity.key}' — re-run giwt intercom init to re-key (gc sweeps the old store)`,
      ),
    );
  }
  if (meta !== null && meta.backend !== opts.backend) {
    findings.push(
      finding(
        storeDir,
        "intercom-backend",
        `store backend ${meta.backend} != settings ${opts.backend} — flip [intercom] backend or re-key the store`,
      ),
    );
  }

  // Missing store: a note for jsonl (init creates it lazily), an error for
  // the pijul backend (its engine must be initialized before any claim).
  if (!existsSync(storeDir)) {
    const msg = `no intercom store for this project (${storeDir}) — run giwt intercom init`;
    if (opts.backend === "pijul") {
      findings.push(finding(storeDir, "intercom-store", msg, "error"));
    } else {
      notes.push(msg);
    }
  } else {
    // Stale claims on the live board.
    const stale = projectLanes(storeDir, opts.laneStaleDays, nowMs).filter((r) =>
      r.status === "stale"
    );
    for (const row of stale.slice(0, 5)) {
      findings.push(
        finding(
          `${storeDir}/LANE-${row.lane}.md`,
          "intercom-stale",
          `lane '${row.lane}' (${row.owner}) stale ${row.ageDays}d — close it (giwt intercom done) or let gc stamp it`,
        ),
      );
    }
    if (stale.length > 5) notes.push(`… ${stale.length - 5} more stale lane(s) not shown`);
    notes.push(`store: ${storeDir} (${opts.backend})`);
  }

  const capped = capFindings(findings);
  return {
    id: "intercom",
    tool: "intercom",
    ok: !capped.findings.some((f) => f.severity === "error"),
    findings: capped.findings,
    ...(capped.findingsTotal !== undefined ? { findingsTotal: capped.findingsTotal } : {}),
    notes,
  };
}
