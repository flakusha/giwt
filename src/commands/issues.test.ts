// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "../utils/scratch-tmp";
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt issues --state` forwarding (FIX-giwt-issues-silently-drops-state).
 *
 * Coverage (real git-issue CLI, real fixture repo — same convention as
 * gi.test.ts, deliberately NOT mock.module):
 *   - default listing is open-only (backcompat)
 *   - --state closed / -s closed / --state=closed list closed issues
 *   - --state=all lists both states
 *   - unknown flag exits 1 with a usage line instead of silently succeeding
 *   - invalid/missing --state value exits 1
 *   - >50 results are capped with an explicit truncation notice (--all lifts it)
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { issues } from "./issues";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeConfig(): WorktreeConfig {
  const root = mkdtempSync(join(scratchRoot(), "giwt-issues-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"]);
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"]);
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
}

function createIssue(root: string, title: string): string {
  const out = execFileSync("git", ["-C", root, "issue", "create", title, "-m", "body"], {
    encoding: "utf8",
  });
  const hash = out.match(/[0-9a-f]{7,40}/)?.[0];
  if (!hash) throw new Error(`could not extract issue hash from: ${out}`);
  return hash;
}

function closeIssue(root: string, hash: string): void {
  execFileSync("git", ["-C", root, "issue", "state", hash, "--close"], { encoding: "utf8" });
}

type Captured = { out: string; err: string; exits: number[]; restore(): void; };

function capture(): Captured {
  const outs: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  const outSpy = spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown) => (outs.push(String(chunk)), true)) as never,
  );
  const errSpy = spyOn(process.stderr, "write").mockImplementation(
    ((chunk: unknown) => (errs.push(String(chunk)), true)) as never,
  );
  const origExit = process.exit;
  process.exit = ((code?: number): never => {
    exits.push(code ?? 0);
    throw new Error(`__exit:${code ?? 0}`);
  }) as never;
  return {
    get out(): string {
      return outs.join("");
    },
    get err(): string {
      return errs.join("");
    },
    get exits(): number[] {
      return exits;
    },
    restore(): void {
      outSpy.mockRestore();
      errSpy.mockRestore();
      process.exit = origExit;
    },
  };
}

async function run(args: string[], config: WorktreeConfig): Promise<Captured> {
  const cap = capture();
  try {
    await issues(args, config);
  } catch {
    // __exit sentinel — surfaced via cap.exits
  }
  cap.restore();
  return cap;
}

/**
 * Install a PATH shim named `git` that forwards every call to the real git
 * except `issue ls --format full`, which it answers with a listing on stdout
 * and a non-zero exit — the upstream git-issue quirk tracked as
 * BUG-issues-format-full-discards-listing-on-nonzero-exit.
 */
function installGitShim(stderrText = ""): { restore(): void; } {
  const root = mkdtempSync(join(scratchRoot(), "giwt-git-shim-"));
  tempRoots.push(root);
  const binDir = join(root, "bin");
  mkdirSync(binDir);
  const realGit = Bun.which("git")!;
  const shim = join(binDir, "git");
  const listing = [
    "deadbee [open] TASK-shim: listing survives a non-zero exit",
    "       priority:medium",
    "",
  ].join("\n");
  writeFileSync(
    shim,
    [
      `#!${process.execPath}`,
      `import { writeSync } from "node:fs";`,
      `const args = process.argv.slice(2);`,
      `const i = args.indexOf("issue");`,
      `const fi = args.indexOf("--format");`,
      `if (i >= 0 && args[i + 1] === "ls" && fi >= 0 && args[fi + 1] === "full") {`,
      `  writeSync(1, ${JSON.stringify(listing)});`,
      `  if (${JSON.stringify(stderrText)}) writeSync(2, ${JSON.stringify(stderrText)} + "\\n");`,
      `  process.exit(1);`,
      `}`,
      `const r = Bun.spawnSync([${JSON.stringify(realGit)}, ...args], { stdio: "inherit" });`,
      `process.exit(r.exitCode);`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const origPath = process.env.PATH;
  process.env.PATH = `${binDir}${origPath ? `:${origPath}` : ""}`;
  return {
    restore(): void {
      process.env.PATH = origPath;
    },
  };
}
describe("issues --state", () => {
  it("defaults to open-only", async () => {
    const config = makeConfig();
    const openHash = createIssue(config.repoRoot, "open probe");
    closeIssue(config.repoRoot, createIssue(config.repoRoot, "closed probe"));
    const cap = await run([], config);
    expect(cap.out).toContain("issues (1):");
    expect(cap.out).toContain(openHash);
    expect(cap.out).not.toContain("closed probe");
  });

  it("--state closed lists closed issues", async () => {
    const config = makeConfig();
    const closedHash = createIssue(config.repoRoot, "closed probe");
    closeIssue(config.repoRoot, closedHash);
    createIssue(config.repoRoot, "open probe");
    const cap = await run(["--state", "closed"], config);
    expect(cap.out).toContain("issues (1):");
    expect(cap.out).toContain(closedHash);
    expect(cap.out).not.toContain("open probe");
  });

  it("-s closed and --state=closed forms work", async () => {
    const config = makeConfig();
    const closedHash = createIssue(config.repoRoot, "closed probe");
    closeIssue(config.repoRoot, closedHash);
    for (const args of [["-s", "closed"], ["--state=closed"]]) {
      const cap = await run(args, config);
      expect(cap.out).toContain(closedHash);
    }
  });

  it("--state=all lists both states", async () => {
    const config = makeConfig();
    const openHash = createIssue(config.repoRoot, "open probe");
    const closedHash = createIssue(config.repoRoot, "closed probe");
    closeIssue(config.repoRoot, closedHash);
    const cap = await run(["--state", "all"], config);
    expect(cap.out).toContain("issues (2):");
    expect(cap.out).toContain(openHash);
    expect(cap.out).toContain(closedHash);
  });

  it("empty registry reports no issues", async () => {
    const config = makeConfig();
    const cap = await run([], config);
    expect(cap.out).toContain("no issues found");
  });

  it("--format (space and equals forms) is accepted", async () => {
    const config = makeConfig();
    for (const args of [["--format", "oneline"], ["--format=oneline"], ["-f", "oneline"]]) {
      const cap = await run(args, config);
      expect(cap.exits).toEqual([]);
      expect(cap.out).toContain("no issues found");
    }
  });

  it("unknown flag exits 1 with a usage line", async () => {
    const config = makeConfig();
    const cap = await run(["--bogus"], config);
    expect(cap.exits).toEqual([1]);
    expect(cap.err).toContain("unknown flag '--bogus'");
    expect(cap.err).toContain("usage: giwt issues");
  });

  it("invalid --state value exits 1", async () => {
    const config = makeConfig();
    for (const args of [["--state", "bogus"], ["--state=bogus"], ["--state", "--all"]]) {
      const cap = await run(args, config);
      expect(cap.exits).toEqual([1]);
      expect(cap.err).toContain("invalid --state");
      expect(cap.err).toContain("usage: giwt issues");
    }
  });

  it("missing --state value exits 1", async () => {
    const config = makeConfig();
    const cap = await run(["--state"], config);
    expect(cap.exits).toEqual([1]);
    expect(cap.err).toContain("missing value for '--state'");
  });

  it("caps at 50 with a truncation notice; --all lifts the cap", async () => {
    const config = makeConfig();
    for (let n = 0; n < 52; n++) {
      createIssue(config.repoRoot, `probe issue ${n}`);
    }
    // Listing order is not guaranteed; derive which two titles the cap hides.
    const capped = await run(["--state", "all"], config);
    const capAll = await run(["--state", "all", "--all"], config);
    expect(capped.out).toContain("issues (50 of 52, 2 hidden — use --all):");
    expect(capAll.out).toContain("issues (52):");
    const shownTitles = capped.out
      .split("\n")
      .filter((line) => /^[0-9a-f]{7,40} /.test(line))
      .map((line) => line.replace(/^[0-9a-f]{7,40} \S+ /, ""));
    const allTitles = capAll.out
      .split("\n")
      .filter((line) => /^[0-9a-f]{7,40} /.test(line))
      .map((line) => line.replace(/^[0-9a-f]{7,40} \S+ /, ""));
    expect(shownTitles.length).toBe(50);
    expect(allTitles.length).toBe(52);
    const hidden = allTitles.filter((title) => !shownTitles.includes(title));
    expect(hidden.length).toBe(2);
  }, 30000);

  it("--all/-a forwards to git issue ls and reveals closed issues", async () => {
    const config = makeConfig();
    const openHash = createIssue(config.repoRoot, "TASK-open all probe");
    const closedHash = createIssue(config.repoRoot, "TASK-closed all probe");
    closeIssue(config.repoRoot, closedHash);
    for (const args of [["--all"], ["-a"]]) {
      const cap = await run(args, config);
      expect(cap.exits).toEqual([]);
      expect(cap.out).toContain("issues (2):");
      expect(cap.out).toContain(openHash);
      expect(cap.out).toContain(closedHash);
    }
  });

  it("machine formats emit parseable records", async () => {
    const config = makeConfig();
    const hash = createIssue(config.repoRoot, "TASK-machine: probe");
    createIssue(config.repoRoot, "plain title without extid");

    const json = await run(["--json"], config);
    const records = JSON.parse(json.out) as Array<Record<string, unknown>>;
    expect(records.find((r) => r.hash === hash)).toEqual({
      hash,
      state: "open",
      title: "TASK-machine: probe",
      extid: "TASK-machine",
    });

    const toml = await run(["--toml"], config);
    const parsed = Bun.TOML.parse(toml.out) as { items: Array<Record<string, unknown>>; };
    expect(parsed.items.length).toBe(2);
    expect(parsed.items.find((r) => r.hash === hash)?.state).toBe("open");

    const emoji = await run(["--emoji"], config);
    expect(emoji.out.split("\n").filter((l) => l !== "")).toHaveLength(2);
    expect(emoji.out).toContain("○ TASK-machine");
  });

  it("warns once when multiple output flags are given", async () => {
    const config = makeConfig();
    createIssue(config.repoRoot, "TASK-flags probe");
    const cap = await run(["--json", "--emoji"], config);
    expect(cap.err).toContain("multiple output flags given — using --json");
    expect(JSON.parse(cap.out)).toHaveLength(1);
  });
});

describe("issues --format and record counting", () => {
  it("counts issue records, not full-format continuation lines", async () => {
    const config = makeConfig();
    const h1 = createIssue(config.repoRoot, "TASK-first: with priority");
    const h2 = createIssue(config.repoRoot, "TASK-second: with priority");
    // Every issue carries a detail line so the CLI's set -e quirk cannot
    // exit 1 on a trailing detail-less row; the count is what is under test.
    for (const hash of [h1, h2]) {
      execFileSync("git", ["-C", config.repoRoot, "issue", "edit", hash, "--priority", "medium"]);
    }

    for (const args of [["--format", "full"], ["--all", "--format", "full"]]) {
      const cap = await run(args, config);
      expect(cap.exits).toEqual([]);
      expect(cap.out).toContain("issues (2):");
      expect(cap.out).toContain("priority:medium");
      expect(cap.out).toContain(h1);
      expect(cap.out).toContain(h2);
    }
  });

  it("rejects an unknown --format with a usage error", async () => {
    const config = makeConfig();
    for (const args of [["--format", "bogus"], ["--format=bogus"], ["-f", "bogus"]]) {
      const cap = await run(args, config);
      expect(cap.exits).toEqual([1]);
      expect(cap.err).toContain("invalid --format");
      expect(cap.err).toContain("expected short|full|oneline");
      expect(cap.err).toContain("usage: giwt issues");
    }
  });

  it("surfaces the underlying command failure detail", async () => {
    const config = makeConfig();
    const cap = capture();
    let thrown: unknown;
    try {
      await issues(["--format", "oneline"], {
        ...config,
        repoRoot: join(config.repoRoot, "does-not-exist"),
      });
    } catch (error) {
      thrown = error;
    } finally {
      cap.restore();
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("No such file or directory");

    // The known empty-stderr case still gets an actionable remedy.
    const capFull = capture();
    let fullThrown: unknown;
    try {
      await issues(["--format", "full"], {
        ...config,
        repoRoot: join(config.repoRoot, "does-not-exist"),
      });
    } catch (error) {
      fullThrown = error;
    } finally {
      capFull.restore();
    }
    expect((fullThrown as Error).message).toContain("retry with --format oneline");
  });
});

describe("issues --format full with a non-zero git exit", () => {
  it("keeps the listing git wrote before exiting non-zero", async () => {
    const config = makeConfig();
    const shim = installGitShim();
    try {
      const human = await run(["--format", "full"], config);
      expect(human.exits).toEqual([]);
      expect(human.out).toContain("issues (1):");
      expect(human.out).toContain("deadbee");
      expect(human.out).toContain("TASK-shim: listing survives a non-zero exit");

      const json = await run(["--format", "full", "--json"], config);
      expect(json.exits).toEqual([]);
      expect(JSON.parse(json.out)).toEqual([
        {
          hash: "deadbee",
          state: "open",
          title: "TASK-shim: listing survives a non-zero exit",
          extid: "TASK-shim",
        },
      ]);
    } finally {
      shim.restore();
    }
  });
});

describe("issues --format full with a non-zero git exit", () => {
  it("keeps the listing git wrote before exiting non-zero", async () => {
    const config = makeConfig();
    const shim = installGitShim();
    try {
      const human = await run(["--format", "full"], config);
      expect(human.exits).toEqual([]);
      expect(human.out).toContain("issues (1):");
      expect(human.out).toContain("deadbee");
      expect(human.out).toContain("TASK-shim: listing survives a non-zero exit");
      // The upstream quirk exits with an empty stderr — nothing to warn about.
      expect(human.err).not.toContain("git issue ls exited");

      const json = await run(["--format", "full", "--json"], config);
      expect(json.exits).toEqual([]);
      expect(JSON.parse(json.out)).toEqual([
        {
          hash: "deadbee",
          state: "open",
          title: "TASK-shim: listing survives a non-zero exit",
          extid: "TASK-shim",
        },
      ]);
    } finally {
      shim.restore();
    }
  });

  it("warns when a non-zero exit also reports an error on stderr", async () => {
    const config = makeConfig();
    const shim = installGitShim("fatal: registry is corrupt");
    try {
      const cap = await run(["--format", "full"], config);
      // The listing is still shown, but the real failure is not swallowed.
      expect(cap.exits).toEqual([]);
      expect(cap.out).toContain("deadbee");
      expect(cap.err).toContain("git issue ls exited 1");
      expect(cap.err).toContain("fatal: registry is corrupt");
    } finally {
      shim.restore();
    }
  });
});
