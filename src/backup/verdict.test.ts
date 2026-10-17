// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import type { BackupArchive } from "./plan";
import { interpretVerify, type MemberListing, parseManifest, parseTarListing } from "./verdict";

function member(archive: string, entries: string[], exitCode = 0): MemberListing {
  return { archive, exitCode, entries };
}

function chainEntry(name: string, level: "full" | "inc"): BackupArchive {
  return {
    target: "docs",
    level,
    stamp: "20261017T091500Z",
    archive: name,
    sidecar: `${name}.sha256`,
  };
}

const CHAIN = [chainEntry("docs.full.20261017T091500Z.tar.zst", "full")];

function okInputs(
  overrides: Partial<Parameters<typeof interpretVerify>[0]> = {},
): Parameters<typeof interpretVerify>[0] {
  return {
    chain: CHAIN,
    targetBase: "docs",
    listings: [member(CHAIN[0]!.archive, ["docs/", "docs/a.txt", "backup-manifest.json"])],
    extractFailures: [],
    extractedManifest: true,
    manifestUnreadable: false,
    extractedTargetDir: true,
    ...overrides,
  };
}

describe("parseTarListing", () => {
  test("trims entries and drops blank lines", () => {
    expect(parseTarListing("docs/\ndocs/a.txt\n\n  backup-manifest.json  \n")).toEqual([
      "docs/",
      "docs/a.txt",
      "backup-manifest.json",
    ]);
  });

  test("empty stdout yields no entries", () => {
    expect(parseTarListing("")).toEqual([]);
  });
});

describe("interpretVerify", () => {
  test("accepts a clean replay", () => {
    expect(interpretVerify(okInputs())).toEqual({ ok: true });
  });

  test("fails without a full archive", () => {
    const verdict = interpretVerify(okInputs({ chain: [] }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("no full archive");
  });

  test("fails when tar -t exits nonzero, naming the timeout when present", () => {
    const timedOut = interpretVerify(okInputs({
      listings: [member("x.tar.zst", [], 1)],
    }));
    expect(timedOut.ok).toBe(false);
    expect(timedOut.reason).toContain("tar -t failed on x.tar.zst");
    const withTimeout = interpretVerify(okInputs({
      listings: [{
        archive: "x.tar.zst",
        exitCode: -1,
        entries: [],
        timedOut: "timed out after 5ms",
      }],
    }));
    expect(withTimeout.reason).toContain("timed out after 5ms");
  });

  test("fails on an empty tar table", () => {
    const verdict = interpretVerify(okInputs({
      listings: [member(CHAIN[0]!.archive, [])],
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("tar table is empty");
  });

  test("fails when the manifest is absent from the table", () => {
    const verdict = interpretVerify(okInputs({
      listings: [member(CHAIN[0]!.archive, ["docs/a.txt"])],
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("backup-manifest.json missing from the tar table");
  });

  test("fails on an extraction failure", () => {
    const verdict = interpretVerify(okInputs({
      extractFailures: [{ archive: CHAIN[0]!.archive, reason: "zstd: corrupt" }],
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("extraction failed");
    expect(verdict.reason).toContain("zstd: corrupt");
  });

  test("fails when the manifest is missing on disk after the replay", () => {
    const verdict = interpretVerify(okInputs({ extractedManifest: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("missing after replay");
  });

  test("fails when the restored manifest is not giwt's", () => {
    const verdict = interpretVerify(okInputs({ manifestUnreadable: true }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("not the manifest giwt wrote");
  });

  test("fails when the target tree is missing after the replay", () => {
    const verdict = interpretVerify(okInputs({ extractedTargetDir: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("target tree docs/ missing");
  });

  test("repo-root targets skip the directory check", () => {
    const verdict = interpretVerify(okInputs({ targetBase: "", extractedTargetDir: false }));
    expect(verdict).toEqual({ ok: true });
  });
});

describe("parseManifest", () => {
  test("accepts giwt's manifest shape", () => {
    expect(
      parseManifest(
        "{\"target\":\"docs/api\",\"level\":\"inc\",\"created\":\"2026-10-17T09:15:00.000Z\"}",
      ),
    ).toEqual({
      target: "docs/api",
      level: "inc",
      created: "2026-10-17T09:15:00.000Z",
    });
  });

  test("rejects wrong shapes and invalid JSON", () => {
    expect(parseManifest("{}")).toBeNull();
    expect(parseManifest("{\"target\":1,\"level\":\"inc\",\"created\":\"x\"}")).toBeNull();
    expect(parseManifest("{\"target\":\"x\",\"level\":\"full\"}")).toBeNull();
    expect(parseManifest("not json")).toBeNull();
  });
});
