// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** VCS-internal members are excluded from the tar payload, anchored to the target. */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildTarPlan } from "./tarball.ts";

function plan(targetAbs: string, excludes: readonly string[]) {
  return buildTarPlan({
    payloadTar: "/tmp/payload.tar",
    archivePath: "/tmp/archive.tar.zst",
    stagingSnar: "/tmp/stage.snar",
    staging: "/tmp/stage",
    rootAbs: "/repo",
    targetAbs,
    snapshot: null,
    dbRefs: [],
    scratchRel: null,
    excludes,
  });
}

describe("buildTarPlan VCS excludes", () => {
  test("anchors each exclude and its children at a repo-root target", () => {
    const payload = plan("/repo", [".jj", ".pijul/pristine"]).payload;
    for (
      const member of ["repo/.jj", "repo/.jj/*", "repo/.pijul/pristine", "repo/.pijul/pristine/*"]
    ) {
      expect(payload).toContain(member);
    }
    expect(payload.filter((a) => a === "--exclude").length).toBe(4);
  });

  test("anchors excludes at a subdirectory target", () => {
    const payload = plan(join("/repo", "docs"), [".jj"]).payload;
    expect(payload).toContain("docs/.jj");
    expect(payload).toContain("docs/.jj/*");
  });
});
