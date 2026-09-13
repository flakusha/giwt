// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for worktree node_modules health + linking.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isUsableModulesDir, linkNodeModules } from "./modules";

function scratch(): string {
  const dir = join(tmpdir(), `wt-modules-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("isUsableModulesDir", () => {
  test("real directory is usable", () => {
    const dir = scratch();
    mkdirSync(join(dir, "mods"));
    expect(isUsableModulesDir(join(dir, "mods"))).toBe(true);
  });

  test("missing path is unusable", () => {
    expect(isUsableModulesDir(join(scratch(), "nope"))).toBe(false);
  });

  test("self-referential symlink loop is unusable", () => {
    const dir = scratch();
    symlinkSync("loop", join(dir, "loop"));
    expect(isUsableModulesDir(join(dir, "loop"))).toBe(false);
  });

  test("dangling symlink is unusable", () => {
    const dir = scratch();
    symlinkSync(join(dir, "gone"), join(dir, "dangling"));
    expect(isUsableModulesDir(join(dir, "dangling"))).toBe(false);
  });
});

describe("linkNodeModules", () => {
  test("links healthy root install into the worktree", () => {
    const root = scratch();
    mkdirSync(join(root, "node_modules", "elysia"), { recursive: true });
    const wt = scratch();
    linkNodeModules(root, wt);
    expect(existsSync(join(wt, "node_modules", "elysia"))).toBe(true);
  });

  test("repairs a dangling worktree link", () => {
    const root = scratch();
    mkdirSync(join(root, "node_modules"));
    const wt = scratch();
    symlinkSync(join(root, "elsewhere"), join(wt, "node_modules"));
    linkNodeModules(root, wt);
    expect(readlinkSync(join(wt, "node_modules"))).toBe(join(root, "node_modules"));
  });

  test("warns and skips when root install is unusable", () => {
    const root = scratch();
    symlinkSync("node_modules", join(root, "node_modules"));
    const wt = scratch();
    linkNodeModules(root, wt);
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
  });

  test("keeps an existing healthy worktree install", () => {
    const root = scratch();
    mkdirSync(join(root, "node_modules"));
    const wt = scratch();
    mkdirSync(join(wt, "node_modules", "custom"), { recursive: true });
    linkNodeModules(root, wt);
    expect(existsSync(join(wt, "node_modules", "custom"))).toBe(true);
  });
});
