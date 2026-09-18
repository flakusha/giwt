// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for isOrphanRebaseMarker (src/commands/abort.ts).
 *
 * Resource contract (parallel-safe): pure functions over an in-memory
 * FsOps map — no filesystem access, no shared state, no ordering.
 *
 * Regression context (ticket FIX-abort-leaves-stale-rebase-head-…): a
 * REBASE_HEAD marker without rebase-merge/rebase-apply dirs is a leftover
 * breadcrumb from a concluded rebase; abort must remove it and finalize
 * must not block on it. Observed 2026-09-18: abort claimed success, the
 * marker survived, finalize kept failing until manual `rm .git/REBASE_HEAD`.
 */

import { describe, expect, test } from "bun:test";
import { type FsOps, isOrphanRebaseMarker } from "./abort";

function makeFs(files: Record<string, boolean>): FsOps {
  return {
    existsSync: (path) => files[path] === true,
    readFileSync: () => {
      throw new Error("readFileSync not exercised by isOrphanRebaseMarker");
    },
    unlinkSync: () => {},
  };
}

const GIT_DIR = "/repo/.git";

describe("isOrphanRebaseMarker", () => {
  test("marker without rebase-merge/rebase-apply dirs is an orphan", () => {
    const fs = makeFs({ [`${GIT_DIR}/REBASE_HEAD`]: true });
    expect(isOrphanRebaseMarker(GIT_DIR, fs)).toBe(true);
  });

  test("marker with an active rebase-merge dir is not an orphan", () => {
    const fs = makeFs({ [`${GIT_DIR}/REBASE_HEAD`]: true, [`${GIT_DIR}/rebase-merge`]: true });
    expect(isOrphanRebaseMarker(GIT_DIR, fs)).toBe(false);
  });

  test("marker with an active rebase-apply dir is not an orphan", () => {
    const fs = makeFs({ [`${GIT_DIR}/REBASE_HEAD`]: true, [`${GIT_DIR}/rebase-apply`]: true });
    expect(isOrphanRebaseMarker(GIT_DIR, fs)).toBe(false);
  });

  test("no marker at all is not an orphan", () => {
    const fs = makeFs({});
    expect(isOrphanRebaseMarker(GIT_DIR, fs)).toBe(false);
  });
});
