// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the user-level check-fanout semaphore (src/utils/check-slots.ts):
 * memory-derived capacity, mkdir-atomic slot hold/release, and the
 * never-blocks contention timeout.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireCheckSlot,
  CHECK_SLOT_WAIT_MS,
  CHECK_TREE_MEM_BUDGET_MB,
  checkSlotCapacity,
  checkSlotWaitMs,
} from "./check-slots";

/** Fresh empty slot root per test. Removed deterministically in the
 *  file-level afterEach below — even a failed test cannot leak its
 *  fixture into /tmp. */
const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function newSlotRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "giwt-slots-"));
  tempRoots.push(root);
  return root;
}

/** acquireCheckSlot with a loud failure instead of a nullable result. */
function expectSlot(dir: string, availableMemMb: number) {
  const slot = acquireCheckSlot({ dir, availableMemMb });
  if (!slot) throw new Error("expected a free slot");
  return slot;
}

describe("checkSlotCapacity", () => {
  test("floors at one tree even on a starved box", () => {
    expect(checkSlotCapacity(0)).toBe(1);
    expect(checkSlotCapacity(CHECK_TREE_MEM_BUDGET_MB - 1)).toBe(1);
  });

  test("scales with whole check-tree budgets", () => {
    expect(checkSlotCapacity(CHECK_TREE_MEM_BUDGET_MB)).toBe(1);
    expect(checkSlotCapacity(CHECK_TREE_MEM_BUDGET_MB * 2 - 1)).toBe(1);
    expect(checkSlotCapacity(CHECK_TREE_MEM_BUDGET_MB * 2)).toBe(2);
    expect(checkSlotCapacity(CHECK_TREE_MEM_BUDGET_MB * 3)).toBe(3);
  });
});

describe("acquireCheckSlot", () => {
  const savedWait = process.env.GIWT_CHECK_SLOT_WAIT_MS;

  afterEach(() => {
    if (savedWait === undefined) delete process.env.GIWT_CHECK_SLOT_WAIT_MS;
    else process.env.GIWT_CHECK_SLOT_WAIT_MS = savedWait;
  });

  test("holds a slot while acquired and frees it on release (idempotent)", () => {
    const root = newSlotRoot();
    const slot = expectSlot(root, CHECK_TREE_MEM_BUDGET_MB);
    expect(slot.index).toBe(0);
    expect(existsSync(join(root, "0"))).toBe(true);

    slot.release();
    expect(existsSync(join(root, "0"))).toBe(false);
    slot.release(); // idempotent
    expect(existsSync(join(root, "0"))).toBe(false);
  });

  test("fills capacity before reporting contention, then frees for reuse", () => {
    const root = newSlotRoot();
    const one = expectSlot(root, CHECK_TREE_MEM_BUDGET_MB * 2);
    const two = expectSlot(root, CHECK_TREE_MEM_BUDGET_MB * 2);
    expect(one.index).toBe(0);
    expect(two.index).toBe(1);

    process.env.GIWT_CHECK_SLOT_WAIT_MS = "0";
    expect(acquireCheckSlot({ dir: root, availableMemMb: CHECK_TREE_MEM_BUDGET_MB * 2 }))
      .toBeNull();

    one.release();
    const three = expectSlot(root, CHECK_TREE_MEM_BUDGET_MB * 2);
    expect(three.index).toBe(0);
    three.release();
    two.release();
  });

  test("invalid wait override falls back to the default", () => {
    process.env.GIWT_CHECK_SLOT_WAIT_MS = "banana";
    expect(checkSlotWaitMs()).toBe(CHECK_SLOT_WAIT_MS);
  });

  test("waits out the contention budget, then gives up (never blocks)", () => {
    const root = newSlotRoot();
    expectSlot(root, CHECK_TREE_MEM_BUDGET_MB); // capacity 1, held
    // Generous budget: the first busy scan is fast, so the poll definitely
    // enters its full-jitter sleep before the deadline expires.
    process.env.GIWT_CHECK_SLOT_WAIT_MS = "600";
    const started = Date.now();
    const slot = acquireCheckSlot({ dir: root, availableMemMb: CHECK_TREE_MEM_BUDGET_MB });
    const elapsed = Date.now() - started;
    expect(slot).toBeNull();
    // The poll sleeps at least one jitter interval past the deadline before
    // the final busy scan, so the wait is real but bounded.
    expect(elapsed).toBeGreaterThanOrEqual(600);
    expect(elapsed).toBeLessThan(2000);
  });
});
