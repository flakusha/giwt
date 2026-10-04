// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt tmp` (src/commands/tmp.ts) and the gated /tmp scanner
 * (src/utils/tmpscan.ts): root refusal, prefix/age/type gates, dry-run
 * default, --apply deletion, and delete-time revalidation.
 *
 * Resource contract (parallel-safe): EVERY test owns a private
 * mkdtempSync(join(tmpdir(), "giwt-tmp-test-")) fixture root — itself
 * under the allowed /tmp tree, so validateTmpRoot accepts it — and a
 * config whose [tmp] settings point AT the fixture root, never at /tmp
 * itself. All fixtures are removed in the file-level afterEach; ages are
 * simulated with utimesSync (no sleeps), so no ordering or timing
 * dependence exists between tests.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import {
  DEFAULT_TMP_OPTIONS,
  deleteTmpCandidate,
  scanTmp,
  validateTmpRoot,
} from "../utils/tmpscan";
import { tmp } from "./tmp";

const HOUR = 3_600_000;

let root = "";

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
  root = "";
});

function makeRoot(): string {
  root = mkdtempSync(join(tmpdir(), "giwt-tmp-test-"));
  tempRoots.push(root);
  return root;
}

/** Aged fixture dir: created, backdated — dir AND children (the walker
 *  sizes mtime as the recursive max, so one fresh child would undo the
 *  age). */
function makeAged(name: string, ageHours: number, files = 1): string {
  const dir = join(root, name);
  mkdirSync(dir);
  const old = new Date(Date.now() - ageHours * HOUR);
  for (let i = 0; i < files; i++) {
    const f = join(dir, `f${i}`);
    writeFileSync(f, "x".repeat(10));
    utimesSync(f, old, old);
  }
  utimesSync(dir, old, old);
  return dir;
}

interface Capture {
  out: () => string;
  restore: () => void;
}

function capture(): Capture {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const spy = spyOn(process.stdout, "write").mockImplementation(push as never);
  return { out: () => chunks.join(""), restore: () => spy.mockRestore() };
}

function makeConfig(
  tmpOverrides: Partial<{
    root: string;
    prefixes: string[];
    maxAgeHours: number;
  }>,
): WorktreeConfig {
  return {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: {
      ...DEFAULT_SETTINGS,
      tmp: { ...DEFAULT_SETTINGS.tmp, ...tmpOverrides },
    },
  };
}

describe("validateTmpRoot", () => {
  test("accepts /tmp and paths under it", () => {
    expect(validateTmpRoot("/tmp")).toBe("/tmp");
    const r = makeRoot();
    expect(validateTmpRoot(r)).toBe(r);
  });

  test("refuses /, /home, /etc", () => {
    for (const bad of ["/", "/home", "/etc", "/var/tmp"]) {
      expect(() => validateTmpRoot(bad)).toThrow(/refusing/);
    }
  });

  test("refuses relative and empty paths", () => {
    for (const bad of ["rel/path", ""]) {
      expect(() => validateTmpRoot(bad)).toThrow(/absolute path/);
    }
  });

  test("refuses a nonexistent path", () => {
    expect(() => validateTmpRoot("/tmp/giwt-tmp-nope-definitely-missing")).toThrow();
  });

  test("unresolvable $TMPDIR is tolerated (contributes nothing)", () => {
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = "/tmp/giwt-tmp-tmpdir-nope-missing";
    try {
      expect(validateTmpRoot("/tmp")).toBe("/tmp");
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
  });
});

describe("scanTmp gates", () => {
  test("prefix/age/type gates split candidates from skips", () => {
    makeRoot();
    makeAged("fix-old", 8);
    makeAged("fix-fresh", 1); // age gate
    makeAged("other-old", 8); // prefix gate
    makeAged("wt-modules-abc123", 8); // default family: candidate
    makeAged("giwt-git-msg-42-1690000000", 8); // default family: candidate
    symlinkSync("/etc", join(root, "fix-link")); // type gate (symlink)
    writeFileSync(join(root, "fix-file"), "data");
    utimesSync(
      join(root, "fix-file"),
      new Date(Date.now() - 8 * HOUR),
      new Date(Date.now() - 8 * HOUR),
    );

    const scan = scanTmp(
      root,
      { prefixes: [...DEFAULT_TMP_OPTIONS.prefixes, "fix-"], maxAgeHours: 6 },
      Date.now(),
    );
    const names = scan.candidates.map((c) => c.name);
    expect(names).toEqual([
      "fix-old",
      "giwt-git-msg-42-1690000000",
      "wt-modules-abc123",
      "fix-file",
    ]); // bytes desc, deterministic
    const skipFor = (n: string) => scan.skips.find((s) => s.name === n)?.reason;
    expect(skipFor("fix-fresh")).toBe("age");
    expect(skipFor("other-old")).toBe("prefix");
    expect(skipFor("fix-link")).toBe("type");
    expect(scan.candidateBytes).toBeGreaterThan(0);
  });

  test("symlinks are type-skipped and never sized via their target", () => {
    makeRoot();
    makeAged("fix-a", 8);
    symlinkSync("/etc", join(root, "fix-deep-link"));
    const scan = scanTmp(root, { prefixes: ["fix-"], maxAgeHours: 6 });
    // /etc holds far more than our 10-byte fixture — if the walker followed
    // the symlink the entry would be enormous.
    expect(scan.entries.some((e) => e.name === "fix-deep-link")).toBe(false);
    expect(scan.skips.find((s) => s.name === "fix-deep-link")?.reason).toBe("type");
  });
});

describe("deleteTmpCandidate revalidation", () => {
  test("refuses an entry replaced by a symlink after the scan", () => {
    makeRoot();
    const dir = makeAged("fix-old", 8);
    const entry = { name: "fix-old", path: dir, bytes: 10, ageMs: 8 * HOUR, kind: "dir" as const };
    rmSync(dir, { recursive: true });
    symlinkSync("/etc", dir);
    expect(() => deleteTmpCandidate(entry, root)).toThrow(/revalidated/);
    expect(existsSync(dir)).toBe(true); // untouched
  });

  test("deletes a plain stale dir", () => {
    makeRoot();
    const dir = makeAged("fix-old", 8);
    deleteTmpCandidate(
      { name: "fix-old", path: dir, bytes: 10, ageMs: 8 * HOUR, kind: "dir" },
      root,
    );
    expect(existsSync(dir)).toBe(false);
  });

  test("throws on an entry that vanished since the scan", () => {
    makeRoot();
    const dir = makeAged("fix-old", 8);
    rmSync(dir, { recursive: true });
    expect(() =>
      deleteTmpCandidate(
        { name: "fix-old", path: dir, bytes: 10, ageMs: 8 * HOUR, kind: "dir" },
        root,
      )
    ).toThrow();
  });

  test("refuses an entry replaced by a symlink pointing inside root", () => {
    makeRoot();
    const target = makeAged("fix-target", 8);
    const link = join(root, "fix-old");
    symlinkSync(target, link);
    // realpath stays under root, so the realpath gate passes — the plain
    // dir/file gate is what refuses the symlink here.
    expect(() =>
      deleteTmpCandidate(
        { name: "fix-old", path: link, bytes: 10, ageMs: 8 * HOUR, kind: "dir" },
        root,
      )
    ).toThrow(/not a plain dir/);
    expect(existsSync(target)).toBe(true);
  });

  test("owner gate: entries of another uid are skipped, never candidates", () => {
    makeRoot();
    makeAged("fix-old", 8);
    const realUid = process.getuid?.() ?? 0;
    const spy = spyOn(process, "getuid").mockReturnValue((realUid ?? 0) + 1);
    try {
      const scan = scanTmp(root, { prefixes: ["fix-"], maxAgeHours: 6 });
      expect(scan.skips.find((s) => s.name === "fix-old")?.reason).toBe("owner");
      expect(scan.candidates).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test("delete-time owner recheck refuses an entry whose uid changed", () => {
    makeRoot();
    const dir = makeAged("fix-old", 8);
    const realUid = process.getuid?.() ?? 0;
    const spy = spyOn(process, "getuid").mockReturnValue((realUid ?? 0) + 1);
    try {
      expect(() =>
        deleteTmpCandidate(
          { name: "fix-old", path: dir, bytes: 10, ageMs: 8 * HOUR, kind: "dir" },
          root,
        )
      ).toThrow(/owner changed/);
    } finally {
      spy.mockRestore();
    }
    expect(existsSync(dir)).toBe(true);
  });
});

describe("giwt tmp handler", () => {
  test("dry-run default: plan printed, nothing deleted", async () => {
    makeRoot();
    const dir = makeAged("fix-old", 8);
    const out = capture();
    try {
      await tmp([], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
    }
    expect(existsSync(dir)).toBe(true);
    expect(out.out()).toContain("candidates: 1");
    expect(out.out()).toContain("Dry-run only");
  });

  test("--apply deletes only gated candidates and reports freed bytes", async () => {
    makeRoot();
    const old = makeAged("fix-old", 8);
    const fresh = makeAged("fix-fresh", 1);
    const foreign = makeAged("keep-me", 8);
    const out = capture();
    try {
      await tmp(["--apply"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
    }
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true); // age gate
    expect(existsSync(foreign)).toBe(true); // prefix gate
    expect(out.out()).toContain("freed");
  });

  test("--json payload carries candidate and mount facts", async () => {
    makeRoot();
    makeAged("fix-old", 8);
    const out = capture();
    try {
      await tmp(["--json"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
    }
    const payload = JSON.parse(out.out());
    expect(payload.applied).toBe(false);
    expect(payload.candidateCount).toBe(1);
    expect(payload.candidates[0].name).toBe("fix-old");
    expect(payload.ramBacked).toBe(true); // /tmp here is zram-backed
  });

  test("refuses a forbidden root before touching anything", async () => {
    makeRoot();
    const out = capture();
    try {
      await expect(
        tmp([], makeConfig({ root: "/home", prefixes: ["fix-"], maxAgeHours: 6 })),
      ).rejects.toThrow(/refusing/);
    } finally {
      out.restore();
    }
  });

  test("--help prints usage and scans nothing", async () => {
    makeRoot();
    const out = capture();
    try {
      await tmp(["--help"], makeConfig({ root: "/home", prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
    }
    expect(out.out()).toContain("Usage: giwt tmp");
  });

  test("unknown flag exits hard with usage", async () => {
    makeRoot();
    const errChunks: string[] = [];
    const errSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
      errChunks.push(String(chunk));
      return true;
    });
    const out = capture();
    const sentinel = exitSentinel();
    try {
      await expect(
        tmp(["--frobnicate"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 })),
      ).rejects.toThrow(/__exit:1/);
      expect(sentinel.codes).toEqual([1]);
      expect(errChunks.join("")).toContain("unknown flag '--frobnicate'");
    } finally {
      sentinel.restore();
      out.restore();
      errSpy.mockRestore();
    }
  });

  test("--max-age-hours requires a non-negative number", async () => {
    makeRoot();
    const out = capture();
    const sentinel = exitSentinel();
    try {
      await expect(
        tmp(["--max-age-hours", "bogus"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 })),
      ).rejects.toThrow(/__exit:1/);
      expect(sentinel.codes).toEqual([1]);
    } finally {
      sentinel.restore();
      out.restore();
    }
  });

  test("--max-age-hours 0 makes fresh entries eligible", async () => {
    makeRoot();
    const fresh = makeAged("fix-fresh", 0);
    const out = capture();
    try {
      await tmp(
        ["--apply", "--max-age-hours", "0"],
        makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }),
      );
    } finally {
      out.restore();
    }
    expect(existsSync(fresh)).toBe(false);
  });

  test("--verbose lists candidate paths with ages", async () => {
    makeRoot();
    makeAged("fix-old", 8);
    const out = capture();
    try {
      await tmp(
        ["--verbose"],
        makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }),
      );
    } finally {
      out.restore();
    }
    expect(out.out()).toContain("fix-old");
    expect(out.out()).toMatch(/8\.0h/);
  });

  test("--emoji prints one 🧹 summary line", async () => {
    makeRoot();
    makeAged("fix-old", 8);
    const out = capture();
    try {
      await tmp(["--emoji"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
    }
    expect(out.out()).toContain("🧹 tmp");
    expect(out.out()).toContain("1 candidate(s)");
  });

  test("--apply collects per-candidate failures, exits 1, keeps going", async () => {
    makeRoot();
    const doomed = makeAged("fix-old", 8);
    const survivor = makeAged("fix-also-old", 8);
    // A write-protected dir makes rmSync fail (EACCES on the child unlink)
    // while the sibling candidate still deletes — the per-candidate
    // collect-and-continue contract.
    chmodSync(doomed, 0o555);

    const errChunks: string[] = [];
    const errSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
      errChunks.push(String(chunk));
      return true;
    });
    const out = capture();
    try {
      await tmp(["--apply"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
      errSpy.mockRestore();
    }
    chmodSync(doomed, 0o755);
    expect(existsSync(doomed)).toBe(true); // failed, untouched
    expect(existsSync(survivor)).toBe(false); // still deleted
    expect(process.exitCode).toBe(1);
    expect(errChunks.join("")).toMatch(/failed to delete/);
    process.exitCode = 0;
  });

  test("--emoji marks a failed apply with ❌", async () => {
    makeRoot();
    const doomed = makeAged("fix-old", 8);
    chmodSync(doomed, 0o555);
    const out = capture();
    try {
      await tmp(["--apply", "--emoji"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
    }
    chmodSync(doomed, 0o755);
    expect(out.out()).toContain("❌ tmp");
    process.exitCode = 0;
  });

  test("multiple output flags warn and pick by precedence", async () => {
    makeRoot();
    makeAged("fix-old", 8);
    const errChunks: string[] = [];
    const errSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
      errChunks.push(String(chunk));
      return true;
    });
    const out = capture();
    try {
      await tmp(["--json", "--toml"], makeConfig({ root, prefixes: ["fix-"], maxAgeHours: 6 }));
    } finally {
      out.restore();
      errSpy.mockRestore();
    }
    expect(errChunks.join("")).toContain("multiple output flags");
    // json wins: payload parses as JSON, not TOML.
    expect(() => JSON.parse(out.out())).not.toThrow();
  });

  test("unreadable directory sizes to 0 instead of throwing", () => {
    makeRoot();
    const secret = join(root, "fix-secret");
    mkdirSync(secret);
    writeFileSync(join(secret, "f"), "x".repeat(64));
    chmodSync(secret, 0o000);
    try {
      const scan = scanTmp(root, { prefixes: ["fix-"], maxAgeHours: 0 });
      const entry = scan.entries.find((e) => e.name === "fix-secret");
      expect(entry?.bytes).toBe(0);
    } finally {
      chmodSync(secret, 0o755);
    }
  });

  test("unreadable root reports totals only, never throws", () => {
    makeRoot();
    chmodSync(root, 0o000);
    try {
      const scan = scanTmp(root, { prefixes: ["fix-"], maxAgeHours: 6 });
      expect(scan.entries).toEqual([]);
      expect(scan.candidates).toEqual([]);
      expect(scan.rootBytes).toBeGreaterThanOrEqual(0);
    } finally {
      chmodSync(root, 0o755);
    }
  });

  test("FIFO entries are type-skipped, never candidates", () => {
    makeRoot();
    const fifo = join(root, "fix-fifo");
    Bun.spawnSync(["mkfifo", fifo]);
    const scan = scanTmp(root, { prefixes: ["fix-"], maxAgeHours: 0 });
    expect(scan.skips.find((s) => s.name === "fix-fifo")?.reason).toBe("type");
    expect(scan.candidates).toEqual([]);
  });
});

function exitSentinel(): { codes: number[]; restore: () => void; } {
  const codes: number[] = [];
  const original = process.exit;
  process.exit = ((code?: number) => {
    codes.push(code ?? 0);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    codes,
    restore: () => {
      process.exit = original;
    },
  };
}
