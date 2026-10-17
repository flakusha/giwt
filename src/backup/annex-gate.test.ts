/**
 * Unit tests for the annex-aware dump gate (src/backup/annex-gate.ts): the
 * fixture is a plain directory tree — detection is filesystem-only, and the
 * availability probe runs through an injected spawn seam, so no real
 * git-annex is needed. Spawn spies record invocations to assert the
 * non-annex zero-spawn-cost contract.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { annexAdvisory, warnAnnexAdvisory } from "./annex-gate";

function fakeRepo(name: string, annex: boolean): { repo: string; cleanup: () => void; } {
  const repo = mkdtempSync(join(scratchRoot(), `giwt-annex-gate-${name}-`));
  mkdirSync(join(repo, ".git"), { recursive: true });
  if (annex) mkdirSync(join(repo, ".git", "annex"), { recursive: true });
  writeFileSync(join(repo, "data.txt"), "content\n");
  return { repo, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

interface SpyResult {
  calls: string[][];
  spawn: (cmd: string[]) => { exitCode: number; stdout: string; stderr: string; };
}

function spawnSpy(res: { exitCode: number; stdout: string; }): SpyResult {
  const calls: string[][] = [];
  return {
    calls,
    spawn: (cmd: string[]) => {
      calls.push(cmd);
      return { ...res, stderr: "" };
    },
  };
}

describe("annexAdvisory", () => {
  test("non-annex repo: no advisory and zero spawn cost", () => {
    const fx = fakeRepo("plain", false);
    try {
      const spy = spawnSpy({ exitCode: 0, stdout: "" });
      expect(annexAdvisory({ repoRoot: fx.repo, spawn: spy.spawn })).toBeNull();
      expect(spy.calls).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("annex repo with dropped-but-present files: advisory names counts and samples", () => {
    const fx = fakeRepo("dropped", true);
    try {
      const spy = spawnSpy({ exitCode: 0, stdout: "big.bin\nphoto.jpg\n" });
      const advisory = annexAdvisory({ repoRoot: fx.repo, spawn: spy.spawn });
      expect(advisory).toEqual({ dropped: 2, sample: ["big.bin", "photo.jpg"] });
      expect(spy.calls).toEqual([[
        "git",
        "-C",
        fx.repo,
        "annex",
        "find",
        "--not",
        "--in",
        "here",
      ]]);
    } finally {
      fx.cleanup();
    }
  });

  test("annex repo with every file present locally: clean, no advisory", () => {
    const fx = fakeRepo("present", true);
    try {
      const spy = spawnSpy({ exitCode: 0, stdout: "" });
      expect(annexAdvisory({ repoRoot: fx.repo, spawn: spy.spawn })).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  test("annex probe failure (annex unavailable): no advisory, dump stays usable", () => {
    const fx = fakeRepo("probe-fail", true);
    try {
      const spy = spawnSpy({ exitCode: 1, stdout: "" });
      expect(annexAdvisory({ repoRoot: fx.repo, spawn: spy.spawn })).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  test("worktree .git pointer file: annex dir found through the gitdir pointer", () => {
    const outer = mkdtempSync(join(scratchRoot(), "giwt-annex-gate-wt-"));
    try {
      const realGitDir = join(outer, "main", ".git");
      mkdirSync(join(realGitDir, "annex"), { recursive: true });
      const worktree = join(outer, "wt");
      mkdirSync(worktree, { recursive: true });
      writeFileSync(join(worktree, ".git"), `gitdir: ${realGitDir}\n`);
      const spy = spawnSpy({ exitCode: 0, stdout: "a.bin\n" });
      expect(annexAdvisory({ repoRoot: worktree, spawn: spy.spawn })).toEqual({
        dropped: 1,
        sample: ["a.bin"],
      });
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });

  test("sample is capped at 5 entries while dropped keeps the full count", () => {
    const fx = fakeRepo("cap", true);
    try {
      const files = Array.from({ length: 7 }, (_, i) => `f${i}.bin`);
      const spy = spawnSpy({ exitCode: 0, stdout: `${files.join("\n")}\n` });
      const advisory = annexAdvisory({ repoRoot: fx.repo, spawn: spy.spawn });
      expect(advisory!.dropped).toBe(7);
      expect(advisory!.sample).toHaveLength(5);
    } finally {
      fx.cleanup();
    }
  });

  test("warnAnnexAdvisory names count, files, remediation, and overflow", () => {
    const writes: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = (chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    };
    try {
      warnAnnexAdvisory({ dropped: 7, sample: ["a.bin", "b.bin"] });
    } finally {
      process.stderr.write = original;
    }
    const out = writes.join("");
    expect(out).toContain("7 dropped-but-present annexed file(s)");
    expect(out).toContain("NOT content");
    expect(out).toContain("git annex get <files>");
    expect(out).toContain("annex content missing: a.bin");
    expect(out).toContain("annex content missing: b.bin");
    expect(out).toContain("… and 5 more");
  });

  test("warnAnnexAdvisory with no overflow omits the 'more' line", () => {
    const writes: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = (chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    };
    try {
      warnAnnexAdvisory({ dropped: 1, sample: ["only.bin"] });
    } finally {
      process.stderr.write = original;
    }
    const out = writes.join("");
    expect(out).toContain("only.bin");
    expect(out).not.toContain("more");
  });
});
