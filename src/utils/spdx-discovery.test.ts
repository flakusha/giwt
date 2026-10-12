// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import {
  filterCheckableFiles,
  getStagedFiles,
  getTrackedFiles,
  hasCheckableExtension,
  isExcluded,
  setExcludePatterns,
  setGitRunner,
} from "./spdx-discovery";

describe("hasCheckableExtension", () => {
  test("accepts known extensions", () => {
    expect(hasCheckableExtension("src/foo.ts")).toBe(true);
    expect(hasCheckableExtension("src/foo.tsx")).toBe(true);
    expect(hasCheckableExtension("src/foo.js")).toBe(true);
    expect(hasCheckableExtension("src/foo.mjs")).toBe(true);
    expect(hasCheckableExtension("src/foo.html")).toBe(true);
    expect(hasCheckableExtension("src/foo.css")).toBe(true);
    expect(hasCheckableExtension("docs/foo.md")).toBe(true);
    expect(hasCheckableExtension("docs/foo.mdx")).toBe(true);
  });

  test("rejects unknown extensions", () => {
    expect(hasCheckableExtension("src/foo.py")).toBe(false);
    expect(hasCheckableExtension("src/foo.json")).toBe(false);
    expect(hasCheckableExtension("Makefile")).toBe(false);
  });
});

describe("isExcluded", () => {
  test("excludes common patterns", () => {
    expect(isExcluded("src/db/migrations/foo.ts")).toBe(true);
    expect(isExcluded("src/node_modules/foo/index.js")).toBe(true);
    expect(isExcluded("src/dist/bundle.js")).toBe(true);
    expect(isExcluded("src/types.d.ts")).toBe(true);
    expect(isExcluded("src/foo.test.ts")).toBe(true);
    expect(isExcluded("src/foo.spec.ts")).toBe(true);
  });

  test("does not exclude normal source files", () => {
    expect(isExcluded("src/index.ts")).toBe(false);
    expect(isExcluded("docs/readme.md")).toBe(false);
  });

  test("respects extra exclude patterns", () => {
    setExcludePatterns([/generated/]);
    expect(isExcluded("src/generated/foo.ts")).toBe(true);
    expect(isExcluded("src/index.ts")).toBe(false);
    setExcludePatterns([]);
  });
});

describe("filterCheckableFiles", () => {
  test("filters by extension and exclusion", () => {
    const files = [
      "src/foo.ts",
      "src/bar.py",
      "src/baz.test.ts",
      "src/qux.d.ts",
      "",
      "   ",
    ];
    expect(filterCheckableFiles(files)).toEqual(["src/foo.ts"]);
  });
});

describe("getStagedFiles / getTrackedFiles", () => {
  test("getStagedFiles filters staged files", async () => {
    setGitRunner(async () => "src/foo.ts\nsrc/bar.py\n");
    try {
      const files = await getStagedFiles();
      expect(files).toEqual(["src/foo.ts"]);
    } finally {
      setGitRunner(async (command) => {
        const { $ } = await import("bun");
        return await $`${command}`.text();
      });
    }
  });

  test("getTrackedFiles filters tracked files", async () => {
    setGitRunner(async () => "src/index.ts\nREADME.md\n");
    try {
      const files = await getTrackedFiles();
      expect(files).toEqual(["src/index.ts", "README.md"]);
    } finally {
      setGitRunner(async (command) => {
        const { $ } = await import("bun");
        return await $`${command}`.text();
      });
    }
  });
});
