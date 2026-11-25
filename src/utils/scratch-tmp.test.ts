// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchRoot } from "./scratch-tmp";

describe("scratchRoot", () => {
  const saved = process.env.LOOP_LORE_TMP_ROOT;

  afterEach(() => {
    if (saved === undefined) delete process.env.LOOP_LORE_TMP_ROOT;
    else process.env.LOOP_LORE_TMP_ROOT = saved;
  });

  test("defaults to <os tmpdir>/loop-lore/giwt when env unset", () => {
    delete process.env.LOOP_LORE_TMP_ROOT;
    const r = scratchRoot();
    expect(r).toBe(join(tmpdir(), "loop-lore", "giwt"));
    expect(existsSync(r)).toBe(true);
  });

  test("falls back to default when env is empty/whitespace", () => {
    process.env.LOOP_LORE_TMP_ROOT = "   ";
    const r = scratchRoot();
    expect(r).toBe(join(tmpdir(), "loop-lore", "giwt"));
    expect(existsSync(r)).toBe(true);
  });

  test("honors LOOP_LORE_TMP_ROOT (trimmed) when set", () => {
    const base = join(tmpdir(), `giwt-scratchroot-override-${Date.now()}`);
    process.env.LOOP_LORE_TMP_ROOT = `  ${base}  `;
    try {
      const r = scratchRoot();
      expect(r).toBe(join(base, "giwt"));
      expect(existsSync(r)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("creates the directory recursively", () => {
    const base = join(tmpdir(), "giwt-scratchroot-nested", "a", "b");
    process.env.LOOP_LORE_TMP_ROOT = base;
    try {
      const r = scratchRoot();
      expect(existsSync(r)).toBe(true);
    } finally {
      rmSync(join(tmpdir(), "giwt-scratchroot-nested"), { recursive: true, force: true });
    }
  });
});
