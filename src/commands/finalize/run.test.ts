// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * FEAT-finalize-dry-run-scope-decision (Option B): the old `--dry-run`
 * name is rejected up-front — it only ever scoped the Step-6a prune and
 * mistook itself for the house "dry-run mutates nothing" convention.
 * The prune-plan-only behavior lives under `--prune-dry-run`.
 */

import { describe, expect, it } from "bun:test";
import { rejectLegacyDryRun } from "./run";

describe("finalize dry-run scope decision", () => {
  it("rejects the old --dry-run flag with a remedy naming --prune-dry-run", () => {
    expect(() => rejectLegacyDryRun(["--dry-run"])).toThrow("--dry-run is no longer accepted");
    expect(() => rejectLegacyDryRun(["--dry-run"])).toThrow("--prune-dry-run");
  });

  it("accepts --prune-dry-run and flag-free invocations", () => {
    expect(() => rejectLegacyDryRun(["--prune-dry-run"])).not.toThrow();
    expect(() => rejectLegacyDryRun(["--force"])).not.toThrow();
    expect(() => rejectLegacyDryRun([])).not.toThrow();
  });
});
