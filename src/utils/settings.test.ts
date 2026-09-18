// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/utils/settings.ts — layered TOML configuration.
 *
 * Resource contract (parallel-safe): every test owns a mkdtemp fixture
 * dir holding its own global/local config files; nothing shared, nothing
 * on the real HOME.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";

interface Fixture {
  root: string;
  globalPath: string;
  localPath: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-settings-"));
  const globalDir = join(root, "global", "giwt");
  mkdirSync(globalDir, { recursive: true });
  return {
    root,
    globalPath: join(globalDir, "config.toml"),
    localPath: join(root, "giwt.toml"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("loadSettings", () => {
  test("returns defaults when no config files exist", () => {
    const fx = makeFixture();
    try {
      const s = loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath });
      expect(s).toEqual(DEFAULT_SETTINGS);
    } finally {
      fx.cleanup();
    }
  });

  test("local file overrides defaults", () => {
    const fx = makeFixture();
    try {
      writeFileSync(fx.localPath, `[branches]\nroot = "main"\nprotected = ["main", "keep"]\n`);
      const s = loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath });
      expect(s.branches.root).toBe("main");
      expect(s.branches.protected).toEqual(["main", "keep"]);
      // Untouched sections keep their defaults.
      expect(s.paths.tree).toBe(DEFAULT_SETTINGS.paths.tree);
      expect(s.commands.check).toBe(DEFAULT_SETTINGS.commands.check);
    } finally {
      fx.cleanup();
    }
  });

  test("local overrides global, global overrides defaults", () => {
    const fx = makeFixture();
    try {
      writeFileSync(fx.globalPath, `[paths]\ntree = "global-tree"\n`);
      writeFileSync(fx.localPath, `[paths]\ntree = "local-tree"\n`);
      const s = loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath });
      expect(s.paths.tree).toBe("local-tree");
      // A global-only key still applies alongside the local file.
      expect(s.paths.tickets).toBe(DEFAULT_SETTINGS.paths.tickets);
    } finally {
      fx.cleanup();
    }
  });

  test("wrong value type throws naming file and key", () => {
    const fx = makeFixture();
    try {
      writeFileSync(fx.localPath, `[runlog]\nmax_runs = "many"\n`);
      expect(() => loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath }))
        .toThrow(/max_runs must be number/);
    } finally {
      fx.cleanup();
    }
  });

  test("commands.diff_base defaults to true and parses false from local config", () => {
    const fx = makeFixture();
    try {
      const defaults = loadSettings(fx.root, {
        globalPath: fx.globalPath,
        localPath: fx.localPath,
      });
      expect(defaults.commands.diffBase).toBe(true);
      writeFileSync(fx.localPath, `[commands]\ndiff_base = false\n`);
      const s = loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath });
      expect(s.commands.diffBase).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("commands.diff_base wrong type throws naming file and key", () => {
    const fx = makeFixture();
    try {
      writeFileSync(fx.localPath, `[commands]\ndiff_base = "yes"\n`);
      expect(() => loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath }))
        .toThrow(/diff_base must be boolean/);
    } finally {
      fx.cleanup();
    }
  });

  test("doctor jobs parses from [doctor] and defaults to 4", () => {
    const fx = makeFixture();
    try {
      const defaults = loadSettings(fx.root, {
        globalPath: fx.globalPath,
        localPath: fx.localPath,
      });
      expect(defaults.doctor.jobs).toBe(4);
      writeFileSync(fx.localPath, `[doctor]\njobs = 2\n`);
      const s = loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath });
      expect(s.doctor.jobs).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test("invalid TOML throws naming the file", () => {
    const fx = makeFixture();
    try {
      writeFileSync(fx.localPath, "[branches\nbroken");
      expect(() => loadSettings(fx.root, { globalPath: fx.globalPath, localPath: fx.localPath }))
        .toThrow(/invalid TOML/);
    } finally {
      fx.cleanup();
    }
  });
});
