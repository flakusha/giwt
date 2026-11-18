// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import type { VcsBackendName } from "../vcs/types";
import { resurrectedScanOptions } from "./history-detectors";

function config(backend: VcsBackendName): WorktreeConfig {
  return {
    repoRoot: "/repo",
    worktreeRoot: "/repo",
    treeDir: "tree",
    settings: { ...DEFAULT_SETTINGS, vcs: { backend } },
  };
}

describe("resurrected backend dispatch", () => {
  test("git backend keeps the default git providers", () => {
    const opts = resurrectedScanOptions(config("git"), ["migrations"]);
    expect(opts).toEqual({ repoRoot: "/repo", dirs: ["migrations"] });
    expect("trackedBlobs" in opts).toBe(false);
    expect("blobText" in opts).toBe(false);
  });

  test("pijul backend injects both providers", () => {
    const opts = resurrectedScanOptions(config("pijul"), ["migrations"]);
    expect("trackedBlobs" in opts && typeof opts.trackedBlobs === "function").toBe(true);
    expect("blobText" in opts && typeof opts.blobText === "function").toBe(true);
  });
});
