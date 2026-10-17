// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { type BackupArchive } from "./plan";
import { selectRotation } from "./rotation";

function on(stamp: string): BackupArchive {
  // "docs" target; stamp 2026MMDDTHHMMSSZ
  const name = `docs.full.${stamp}.tar.zst`;
  return { target: "docs", level: "full", stamp, archive: name, sidecar: `${name}.sha256` };
}

const KEEP_DEFAULT = { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 };

describe("selectRotation", () => {
  test("keeps everything under the budgets", () => {
    const archives = [
      on("20261001T000000Z"),
      on("20261002T000000Z"),
      on("20261003T000000Z"),
    ];
    const plan = selectRotation({ archives, policy: KEEP_DEFAULT });
    expect(plan.prune).toEqual([]);
    expect(plan.keep).toHaveLength(3);
  });

  test("prunes the oldest dailies beyond the budget", () => {
    const archives = Array.from(
      { length: 10 },
      (_, i) => on(`202610${String(i + 1).padStart(2, "0")}T000000Z`),
    );
    const plan = selectRotation({
      archives,
      policy: { keepDaily: 7, keepWeekly: 0, keepMonthly: 0 },
    });
    expect(plan.keep.map((a) => a.stamp)).toEqual([
      "20261004T000000Z",
      "20261005T000000Z",
      "20261006T000000Z",
      "20261007T000000Z",
      "20261008T000000Z",
      "20261009T000000Z",
      "20261010T000000Z",
    ]);
    expect(plan.prune.map((a) => a.stamp)).toEqual([
      "20261001T000000Z",
      "20261002T000000Z",
      "20261003T000000Z",
    ]);
  });

  test("monthly buckets keep the newest archive of the 12 newest months", () => {
    const archives: BackupArchive[] = [];
    for (let monthsBack = 14; monthsBack >= 0; monthsBack--) {
      const d = new Date(Date.UTC(2026, 9 - monthsBack, 15));
      const stamp = `${d.getUTCFullYear()}${
        String(d.getUTCMonth() + 1).padStart(2, "0")
      }15T000000Z`;
      archives.push(on(stamp));
    }
    const plan = selectRotation({
      archives,
      policy: { keepDaily: 0, keepWeekly: 0, keepMonthly: 12 },
    });
    expect(plan.prune).toHaveLength(3);
    // Oldest three months drop; everything else survives. (Month index -5
    // of 2026 rolls to 2025-08, so the generated set starts there.)
    expect(plan.prune[0]!.stamp).toBe("20250815T000000Z");
    expect(plan.prune[1]!.stamp).toBe("20250915T000000Z");
    expect(plan.prune[2]!.stamp).toBe("20251015T000000Z");
  });

  test("zero budgets prune everything unpinned", () => {
    const archives = [on("20261001T000000Z"), on("20261002T000000Z")];
    const plan = selectRotation({
      archives,
      policy: { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
    });
    expect(plan.keep).toEqual([]);
    expect(plan.prune).toHaveLength(2);
  });

  test("pinned archives survive any budget (live chain protection)", () => {
    const archives = [on("20261001T000000Z"), on("20261002T000000Z")];
    const plan = selectRotation({
      archives,
      policy: { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
      pinned: new Set(["docs.full.20261002T000000Z.tar.zst"]),
    });
    expect(plan.keep.map((a) => a.archive)).toEqual(["docs.full.20261002T000000Z.tar.zst"]);
    expect(plan.prune.map((a) => a.archive)).toEqual(["docs.full.20261001T000000Z.tar.zst"]);
  });

  test("weekly buckets align on ISO weeks across month boundaries", () => {
    // Oct 27 2026 (Tue, ISO week 44), Nov 2 (Mon, week 45), Nov 8 (Sun, week 45).
    const archives = [
      on("20261027T000000Z"),
      on("20261102T000000Z"),
      on("20261108T000000Z"),
    ];
    const plan = selectRotation({
      archives,
      policy: { keepDaily: 0, keepWeekly: 1, keepMonthly: 0 },
    });
    // One weekly bucket kept → the newest archive of the newest week.
    expect(plan.keep.map((a) => a.stamp)).toEqual(["20261108T000000Z"]);
  });
});
