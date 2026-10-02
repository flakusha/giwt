// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Human-readable reconciliation report rendering for `runSync`, plus the
 * actionable/advisory counting shared by the pre-fix gate and the post-fix
 * summary (identical field sums in both places).
 */

import { raw } from "../utils/output";
import type { SyncReport } from "./sync-ticket-types";

/**
 * Count *actionable* vs advisory findings. Only actionable issues gate the
 * result. Placeholder hashes, missing-hash suggestions, missing git_issue
 * links, and orphan git issues are advisory (yellow), not failures. Stale
 * open git issues are actionable.
 */
export function countIssueTotals(report: SyncReport): { total: number; advisory: number; } {
  const total = report.orphanFiles.length
    + report.phantomEntries.length
    + report.hashMismatches.length
    + report.statusMismatches.length
    + report.staleOpenGitIssues.length
    + report.titleDrifts.length
    + report.mdStatusStale.length
    + report.indexStatusStale.length;
  const advisory = report.placeholderHashes.length
    + report.missingHashes.length
    + report.missingGitIssueLinks.length
    + report.orphanGitIssues.length
    + report.importableTickets.length
    + report.foreignIssues.length
    + report.foreignUnparsedIssues.length
    + report.duplicateOpenIssues.length
    + report.danglingMdRefs.length;
  return { total, advisory };
}

export function renderReport(report: SyncReport, verbose: boolean): void {
  raw(`\n📋 Reconciliation Report`);
  raw(`${"─".repeat(60)}`);

  if (report.orphanFiles.length > 0) {
    raw(`\n🔴 Orphan files (.md not in index): ${report.orphanFiles.length}`);
    if (verbose) {
      report.orphanFiles.forEach((f) => raw(`   ${f}`));
    } else {
      report.orphanFiles.slice(0, 10).forEach((f) => raw(`   ${f}`));
      if (report.orphanFiles.length > 10) {
        raw(`   ... and ${report.orphanFiles.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 No orphan files`);
  }

  if (report.phantomEntries.length > 0) {
    raw(`\n🔴 Phantom entries (index has no .md): ${report.phantomEntries.length}`);
    if (verbose) {
      report.phantomEntries.forEach((e) => raw(`   ${e}`));
    } else {
      report.phantomEntries.slice(0, 10).forEach((e) => raw(`   ${e}`));
      if (report.phantomEntries.length > 10) {
        raw(`   ... and ${report.phantomEntries.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 No phantom entries`);
  }

  if (report.hashMismatches.length > 0) {
    raw(`\n🔴 Hash mismatches: ${report.hashMismatches.length}`);
    for (const m of report.hashMismatches) {
      raw(
        `   ${m.extid}: index=${m.indexHash} → git="${m.gitTitle ?? "NOT FOUND"}" (${
          m.gitStatus ?? "?"
        })`,
      );
    }
  } else {
    raw(`\n🟢 No hash mismatches`);
  }

  if (report.placeholderHashes.length > 0) {
    raw(`\n🟡 Placeholder hashes (no git issue, not a commit): ${report.placeholderHashes.length}`);
    for (const m of report.placeholderHashes) {
      raw(`   ${m.extid}: index=${m.indexHash}`);
    }
  } else {
    raw(`\n🟢 No placeholder hashes`);
  }

  if (report.statusMismatches.length > 0) {
    raw(`\n🟡 Status mismatches: ${report.statusMismatches.length}`);
    for (const m of report.statusMismatches) {
      raw(`   ${m.extid}: index=${m.indexStatus} vs git=${m.gitStatus}`);
    }
  } else {
    raw(`\n🟢 No status mismatches`);
  }

  if (report.missingHashes.length > 0) {
    raw(`\n🟡 Missing hashes (could be linked): ${report.missingHashes.length}`);
    if (verbose) {
      for (const m of report.missingHashes) {
        raw(`   ${m.extid}: suggested hash=${m.suggestedHash} (git="${m.suggestedTitle}")`);
      }
    } else {
      report.missingHashes.slice(0, 10).forEach((m) => {
        raw(`   ${m.extid}: → ${m.suggestedHash}`);
      });
      if (report.missingHashes.length > 10) {
        raw(`   ... and ${report.missingHashes.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 No missing hashes`);
  }

  // ── New: git_issue link + stale + orphan checks ──────────────

  if (report.missingGitIssueLinks.length > 0) {
    raw(
      `\n🟡 Missing git_issue links (index entry has no git_issue field): ${report.missingGitIssueLinks.length}`,
    );
    for (const m of report.missingGitIssueLinks) {
      raw(`   ${m.extid}: → ${m.suggestedGitIssue} (git="${m.gitTitle}")`);
    }
  } else {
    raw(`\n🟢 No missing git_issue links`);
  }

  if (report.staleOpenGitIssues.length > 0) {
    raw(`\n🔴 Stale open git issues (index=done, git=open): ${report.staleOpenGitIssues.length}`);
    for (const m of report.staleOpenGitIssues) {
      raw(`   ${m.extid}: git issue ${m.gitIssueHash} still open`);
    }
  } else {
    raw(`\n🟢 No stale open git issues`);
  }

  if (report.orphanGitIssues.length > 0) {
    raw(`\n🟡 Orphan git issues (open, no index entry): ${report.orphanGitIssues.length}`);
    for (const m of report.orphanGitIssues) {
      raw(`   ${m.hash} ${m.extid}: ${m.title.slice(0, 60)}`);
    }
  } else {
    raw(`\n🟢 No orphan git issues`);
  }

  // ── Issue-lifecycle drift (import / foreign / move) ──────────

  if (report.importableTickets.length > 0) {
    raw(`\n🟡 Importable tickets (.md, no git issue): ${report.importableTickets.length}`);
    for (const m of report.importableTickets.slice(0, verbose ? Infinity : 10)) {
      raw(`   ${m.extid}: ${m.source}`);
    }
    if (!verbose && report.importableTickets.length > 10) {
      raw(`   ... and ${report.importableTickets.length - 10} more`);
    }
    raw(`   → rerun with --fix --import to create the missing issues`);
  } else {
    raw(`\n🟢 No importable tickets`);
  }

  if (report.titleDrifts.length > 0) {
    raw(`\n🔴 Title drift (issue extid ≠ ticket extid, slug match): ${report.titleDrifts.length}`);
    for (const m of report.titleDrifts) {
      raw(`   ${m.extid}: issue ${m.hash} still "${m.issueExtid}"`);
    }
  } else {
    raw(`\n🟢 No title drift`);
  }

  if (report.mdStatusStale.length > 0) {
    raw(
      `\n🟡 .md status stale (index authoritative for done-ness): ${report.mdStatusStale.length}`,
    );
    for (const m of report.mdStatusStale) {
      raw(`   ${m.extid}: .md="${m.mdStatus}" → ${m.indexStatus}`);
    }
  } else {
    raw(`\n🟢 No stale .md statuses`);
  }

  if (report.indexStatusStale.length > 0) {
    raw(
      `\n🟡 Index status lags an appended .md done-marker (fixable): ${report.indexStatusStale.length}`,
    );
    for (const m of report.indexStatusStale) {
      raw(`   ${m.extid}: index="${m.indexStatus}" → done`);
    }
  }

  if (report.foreignIssues.length > 0) {
    raw(
      `\n🟡 Foreign issues (open in registry, no .plan/ reflection): ${report.foreignIssues.length}`,
    );
    for (const m of report.foreignIssues.slice(0, verbose ? Infinity : 10)) {
      raw(`   ${m.hash} ${m.extid}: ${m.title.slice(0, 60)}`);
    }
    if (!verbose && report.foreignIssues.length > 10) {
      raw(`   ... and ${report.foreignIssues.length - 10} more`);
    }
    raw(`   → import manually or rerun --fix --import-back`);
  } else {
    raw(`\n🟢 No foreign issues`);
  }

  if (report.foreignUnparsedIssues.length > 0) {
    raw(
      `\n🟡 Foreign issues without TYPE-extid (manual only): ${report.foreignUnparsedIssues.length}`,
    );
    for (const m of report.foreignUnparsedIssues.slice(0, verbose ? Infinity : 10)) {
      raw(`   ${m.hash}: ${m.title.slice(0, 60)}`);
    }
    if (!verbose && report.foreignUnparsedIssues.length > 10) {
      raw(`   ... and ${report.foreignUnparsedIssues.length - 10} more`);
    }
  } else {
    raw(`\n🟢 No unparsed foreign issues`);
  }

  if (report.duplicateOpenIssues.length > 0) {
    raw(`\n🟡 Duplicate open issues (manual dedupe): ${report.duplicateOpenIssues.length}`);
    for (const m of report.duplicateOpenIssues) {
      raw(`   ${m.extid}: ${m.hashes.join(", ")}`);
    }
  } else {
    raw(`\n🟢 No duplicate open issues`);
  }

  if (report.danglingMdRefs.length > 0) {
    raw(`\n🟡 Dangling .md issue refs (hash not in registry): ${report.danglingMdRefs.length}`);
    for (const m of report.danglingMdRefs) {
      raw(`   ${m.extid}: git issue: ${m.hash}`);
    }
  } else {
    raw(`\n🟢 No dangling .md refs`);
  }

  // Advisory: non-epic tickets not bound to any epic. Deliberately not
  // counted in totalIssues or advisoryCount — a count in advisoryCount would
  // trigger gratuitous --fix index rewrites on every run.
  if (report.unboundEpics.length > 0) {
    raw(`\n🟡 Unbound to epic (advisory, non-gating): ${report.unboundEpics.length}`);
    if (verbose) {
      report.unboundEpics.forEach((extid) => raw(`   ${extid}`));
    } else {
      report.unboundEpics.slice(0, 10).forEach((extid) => raw(`   ${extid}`));
      if (report.unboundEpics.length > 10) {
        raw(`   ... and ${report.unboundEpics.length - 10} more`);
      }
    }
  } else {
    raw(`\n🟢 All non-epic tickets bound to an epic`);
  }
}
