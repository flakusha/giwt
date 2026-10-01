// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt search` structured output redesign.
 *
 * Coverage (real git-issue CLI, real fixture repo — same convention as
 * issues.test.ts, deliberately NOT mock.module):
 *   - human output: one compact line per hit, match-context lines dropped
 *   - --json array of hit records
 *   - --toml round-trips through Bun.TOML.parse
 *   - --emoji one line per hit with state glyph
 *   - empty result set: human notice / machine empty output
 *   - missing pattern exits 1 with usage
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { search } from "./search";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeConfig(): WorktreeConfig {
  const root = mkdtempSync(join(tmpdir(), "giwt-search-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"]);
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"]);
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
}

function createExtidIssue(root: string, extid: string, title: string): string {
  const out = execFileSync("git", ["-C", root, "issue", "create", `${extid}: ${title}`], {
    encoding: "utf8",
  });
  const hash = out.match(/[0-9a-f]{7,40}/)?.[0];
  if (!hash) throw new Error(`could not extract issue hash from: ${out}`);
  return hash;
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
    await search(args, config);
  } catch {
    // __exit sentinel — surfaced via cap.exits
  }
  cap.restore();
  return cap;
}

describe("search", () => {
  it("human output: one line per hit, context lines dropped, title not repeated", async () => {
    const config = makeConfig();
    createExtidIssue(config.repoRoot, "TASK-alpha", "searchable alpha");
    createExtidIssue(config.repoRoot, "TASK-beta", "searchable beta");
    createExtidIssue(config.repoRoot, "TASK-gamma", "unrelated note");

    const cap = await run(["searchable"], config);
    expect(cap.exits).toEqual([]);

    expect((cap.out.match(/searchable alpha/g) ?? []).length).toBe(1);
    expect((cap.out.match(/searchable beta/g) ?? []).length).toBe(1);
    expect(cap.out).not.toContain("unrelated note");
    // git-issue search prints `<N>:<text>` match-context lines; the
    // redesigned output must not forward them.
    expect(cap.out).not.toMatch(/^\s*\d+:/m);
    expect(cap.out).toContain("TASK-alpha");
    expect(cap.out).toContain("TASK-beta");
  });

  it("--json emits an array of hit records", async () => {
    const config = makeConfig();
    const hash = createExtidIssue(config.repoRoot, "TASK-json", "findable json");

    const cap = await run(["findable", "--json"], config);
    const hits = JSON.parse(cap.out) as Array<Record<string, unknown>>;
    expect(hits).toEqual([
      { hash, state: "open", title: "TASK-json: findable json", extid: "TASK-json" },
    ]);
  });

  it("--toml round-trips through Bun.TOML.parse", async () => {
    const config = makeConfig();
    createExtidIssue(config.repoRoot, "TASK-toml", "findable toml");

    const cap = await run(["findable", "--toml"], config);
    const parsed = Bun.TOML.parse(cap.out) as {
      items: Array<{ extid: string; state: string; title: string; }>;
    };
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0]!.extid).toBe("TASK-toml");
    expect(parsed.items[0]!.state).toBe("open");
  });

  it("--emoji: one line per hit with state glyph", async () => {
    const config = makeConfig();
    createExtidIssue(config.repoRoot, "TASK-emo1", "findable one");
    createExtidIssue(config.repoRoot, "TASK-emo2", "findable two");

    const cap = await run(["findable", "--emoji"], config);
    const lines = cap.out.split("\n").filter((l) => l !== "");
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.startsWith("○ TASK-")).toBe(true);
    }
  });

  it("empty result set: human notice, machine formats emit empty output", async () => {
    const config = makeConfig();

    const capHuman = await run(["nosuchword"], config);
    expect(capHuman.exits).toEqual([]);
    expect(capHuman.out).toContain("no matches");

    const capJson = await run(["nosuchword", "--json"], config);
    expect(capJson.out).toBe("[]\n"); // raw() terminates with a newline
    const capToml = await run(["nosuchword", "--toml"], config);
    expect(capToml.out).toBe("\n"); // documented: empty toml renders ""

    const capEmoji = await run(["nosuchword", "--emoji"], config);
    expect(capEmoji.out).toBe("\n");
  });

  it("missing pattern exits 1 with usage", async () => {
    const config = makeConfig();
    const cap = await run([], config);
    expect(cap.exits).toEqual([1]);
    expect(cap.out).toContain("Usage: search");
  });
});
