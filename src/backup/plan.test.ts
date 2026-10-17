// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BackupArchive,
  FULL_CADENCE_MS,
  listArchives,
  newestFullMs,
  parseArchiveName,
  planNextLevel,
  safeTargetName,
  selectChain,
  snarPath,
  stampMs,
  utcStamp,
} from "./plan";

function archive(target: string, level: "full" | "inc", stamp: string): BackupArchive {
  const name = `${target}.${level}.${stamp}.tar.zst`;
  return { target, level, stamp, archive: name, sidecar: `${name}.sha256` };
}

describe("utcStamp/stampMs", () => {
  test("formats a tar-name-safe UTC stamp", () => {
    expect(utcStamp(new Date("2026-10-17T09:15:00.000Z"))).toBe("20261017T091500Z");
  });

  test("strips non-zero milliseconds too", () => {
    expect(utcStamp(new Date("2026-10-17T09:15:00.803Z"))).toBe("20261017T091500Z");
  });

  test("round-trips through stampMs", () => {
    const ms = stampMs(utcStamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))));
    expect(ms).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
  });

  test("stampMs rejects malformed stamps", () => {
    expect(Number.isNaN(stampMs("20261017"))).toBe(true);
    expect(Number.isNaN(stampMs("2026-10-17T09:15:00Z"))).toBe(true);
  });
});

describe("safeTargetName", () => {
  test("collapses path separators and unsafe runes", () => {
    expect(safeTargetName("docs/api")).toBe("docs-api");
    expect(safeTargetName("a b/c d")).toBe("a-b-c-d");
  });

  test("maps the repo-root target to repo", () => {
    expect(safeTargetName(".")).toBe("repo");
  });

  test("never returns an empty name", () => {
    expect(safeTargetName("///")).toBe("target");
  });
});

describe("parseArchiveName", () => {
  test("parses full and incremental names", () => {
    expect(parseArchiveName("docs-api.full.20261017T091500Z.tar.zst")).toEqual({
      target: "docs-api",
      level: "full",
      stamp: "20261017T091500Z",
      archive: "docs-api.full.20261017T091500Z.tar.zst",
      sidecar: "docs-api.full.20261017T091500Z.tar.zst.sha256",
    });
    expect(parseArchiveName("repo.inc.20261018T000000Z.tar.zst")?.level).toBe("inc");
  });

  test("rejects non-archive names", () => {
    expect(parseArchiveName("docs-api.full.20261017T091500Z.tar.zst.sha256")).toBeNull();
    expect(parseArchiveName("state")).toBeNull();
    expect(parseArchiveName("x.full.notastamp.tar.zst")).toBeNull();
  });
});

describe("planNextLevel", () => {
  const now = Date.UTC(2026, 9, 17);

  test("full when no chain state exists", () => {
    expect(planNextLevel({ snarExists: false, youngestFullMs: null, now })).toBe("full");
  });

  test("full when the chain is open but no full archive exists", () => {
    expect(planNextLevel({ snarExists: true, youngestFullMs: null, now })).toBe("full");
  });

  test("incremental on a fresh chain", () => {
    expect(planNextLevel({ snarExists: true, youngestFullMs: now - 1000, now })).toBe("inc");
  });

  test("weekly full when the youngest full is stale", () => {
    expect(
      planNextLevel({ snarExists: true, youngestFullMs: now - FULL_CADENCE_MS, now }),
    ).toBe("full");
  });
});

describe("selectChain", () => {
  test("returns the youngest full plus later incrementals in replay order", () => {
    const archives = [
      archive("docs", "full", "20261001T000000Z"),
      archive("docs", "inc", "20261002T000000Z"),
      archive("docs", "inc", "20261003T000000Z"),
      archive("docs", "full", "20261010T000000Z"),
      archive("docs", "inc", "20261011T000000Z"),
      archive("other", "full", "20261001T000000Z"),
    ];
    expect(selectChain(archives, "docs").map((a) => a.stamp)).toEqual([
      "20261010T000000Z",
      "20261011T000000Z",
    ]);
  });

  test("empty when the target has no full archive", () => {
    const archives = [archive("docs", "inc", "20261011T000000Z")];
    expect(selectChain(archives, "docs")).toEqual([]);
  });
});

describe("newestFullMs", () => {
  test("picks the youngest full for the target", () => {
    const archives = [
      archive("docs", "full", "20261001T000000Z"),
      archive("docs", "inc", "20261002T000000Z"),
      archive("docs", "full", "20261010T000000Z"),
      archive("other", "full", "20261020T000000Z"),
    ];
    expect(newestFullMs(archives, "docs")).toBe(Date.UTC(2026, 9, 10));
  });

  test("null when the target has no full", () => {
    expect(newestFullMs([archive("docs", "inc", "20261011T000000Z")], "docs")).toBeNull();
  });
});

describe("snarPath", () => {
  test("lands under the state dir", () => {
    expect(snarPath("/root", "docs")).toBe(join("/root", "state", "docs.snar"));
  });
});

describe("listArchives", () => {
  const base = join(process.cwd(), ".tmp", "giwt-backup-plan-test");

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("lists valid archive files only", () => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "docs.full.20261017T091500Z.tar.zst"), "x");
    writeFileSync(join(base, "docs.full.20261017T091500Z.tar.zst.sha256"), "y");
    writeFileSync(join(base, "unrelated.txt"), "z");
    const found = listArchives(base);
    expect(found).toHaveLength(1);
    expect(found[0]!.archive).toBe("docs.full.20261017T091500Z.tar.zst");
  });

  test("zero-lists a missing root", () => {
    expect(listArchives(join(base, "does-not-exist"))).toEqual([]);
  });
});
