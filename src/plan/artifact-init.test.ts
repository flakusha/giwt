// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingPlanArtifacts, warnMissingPlanArtifacts } from "./artifact-init";

const ALL_ARTIFACTS = [
  "code-map.json",
  "epics-index.md",
  "feature-matrix.md",
  "interconnect.json",
  "interconnect.md",
];

// Five call sites need the same mkdtemp fixture root — shared builder keeps
// naming/cleanup lockstep.
function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "giwt-artifact-init-"));
}

// Capture both streams: log() routes info to stdout but warn/error to stderr
// (merge for assertions, same pattern as abort.test.ts/backlog.test.ts).
function capture(): { text: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const out = spyOn(process.stdout, "write").mockImplementation(push as never);
  const err = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    text: () => chunks.join(""),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

describe("missingPlanArtifacts", () => {
  it("reports all five on an empty plan dir", () => {
    const root = makeRoot();
    try {
      expect(missingPlanArtifacts(root)).toEqual(ALL_ARTIFACTS);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports only the missing subset for a partial set", () => {
    const root = makeRoot();
    try {
      writeFileSync(join(root, "code-map.json"), "{}\n");
      writeFileSync(join(root, "feature-matrix.md"), "# matrix\n");
      expect(missingPlanArtifacts(root)).toEqual([
        "epics-index.md",
        "interconnect.json",
        "interconnect.md",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports none when every artifact exists", () => {
    const root = makeRoot();
    try {
      for (const name of ALL_ARTIFACTS) writeFileSync(join(root, name), "x\n");
      expect(missingPlanArtifacts(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("warnMissingPlanArtifacts", () => {
  it("emits exactly one info line naming the missing artifacts and both remedies", () => {
    const root = makeRoot();
    const cap = capture();
    try {
      warnMissingPlanArtifacts(root);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("plan artifacts not initialized");
    expect(out).toContain("code-map.json");
    expect(out).toContain("interconnect.md");
    expect(out).toContain("giwt plan code-map/matrix/gen-docs/links --write");
    expect(out).toContain("bun run plan:artifacts");
    expect(out.split("plan artifacts not initialized").length - 1).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("stays silent when every artifact exists", () => {
    const root = makeRoot();
    for (const name of ALL_ARTIFACTS) writeFileSync(join(root, name), "x\n");
    const cap = capture();
    try {
      warnMissingPlanArtifacts(root);
    } finally {
      cap.restore();
    }
    expect(cap.text()).not.toContain("plan artifacts not initialized");
    rmSync(root, { recursive: true, force: true });
  });
});
