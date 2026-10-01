// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt show` structured output redesign.
 *
 * Coverage (real git-issue CLI, real fixture repo — same convention as
 * issues.test.ts, deliberately NOT mock.module):
 *   - human output renders title/status/labels each exactly once
 *   - --json parses back to the expected record shape
 *   - --toml round-trips through Bun.TOML.parse
 *   - --emoji maps state → glyph (open → ○, closed → ✅)
 *   - unknown extid exits 1 naming the id
 *   - missing ID exits 1 with usage
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { show } from "./show";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeConfig(): WorktreeConfig {
  const root = mkdtempSync(join(tmpdir(), "giwt-show-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"]);
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"]);
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
}

interface Fixture {
  hash: string;
  extid: string;
}

function createExtidIssue(root: string, extid: string, title: string, body: string): Fixture {
  const out = execFileSync(
    "git",
    ["-C", root, "issue", "create", `${extid}: ${title}`, "-m", body],
    { encoding: "utf8" },
  );
  const hash = out.match(/[0-9a-f]{7,40}/)?.[0];
  if (!hash) throw new Error(`could not extract issue hash from: ${out}`);
  return { hash, extid };
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
    await show(args, config);
  } catch {
    // __exit sentinel — surfaced via cap.exits
  }
  cap.restore();
  return cap;
}

describe("show", () => {
  it("human output shows title, status, and labels exactly once each", async () => {
    const config = makeConfig();
    const fx = createExtidIssue(config.repoRoot, "TASK-demo", "demo title", "the body text");
    execFileSync("git", ["-C", config.repoRoot, "issue", "edit", fx.hash, "--label", "bug"]);

    const cap = await run([fx.extid], config);
    expect(cap.exits).toEqual([]);

    const titleCount = cap.out.split("demo title").length - 1;
    expect(titleCount).toBe(1);
    expect((cap.out.match(/\[Not Started\]/g) ?? []).length).toBe(1);
    expect((cap.out.match(/labels:/g) ?? []).length).toBe(1);
    expect(cap.out).toContain("bug");
    expect(cap.out).toContain("the body text");
    // Updates/comment tail from the live repo must not leak into the body.
    expect(cap.out).not.toContain("Updates");
  });

  it("--json parses back to the expected record shape", async () => {
    const config = makeConfig();
    const fx = createExtidIssue(config.repoRoot, "TASK-json", "json title", "json body");
    execFileSync("git", ["-C", config.repoRoot, "issue", "edit", fx.hash, "--priority", "high"]);

    const cap = await run([fx.extid, "--json"], config);
    const rec = JSON.parse(cap.out) as Record<string, unknown>;
    expect(rec).toEqual({
      extid: "TASK-json",
      hash: fx.hash,
      state: "open",
      title: "TASK-json: json title",
      priority: "high",
      body: "json body",
    });
  });

  it("--toml round-trips through Bun.TOML.parse", async () => {
    const config = makeConfig();
    const fx = createExtidIssue(config.repoRoot, "TASK-toml", "toml title", "toml body");

    const cap = await run([fx.extid, "--toml"], config);
    const parsed = Bun.TOML.parse(cap.out) as {
      value: { extid: string; hash: string; state: string; title: string; body: string; };
    };
    expect(parsed.value.extid).toBe("TASK-toml");
    expect(parsed.value.hash).toBe(fx.hash);
    expect(parsed.value.state).toBe("open");
    expect(parsed.value.body).toBe("toml body");
  });

  it("--emoji maps state to glyph: open → ○, closed → ✅", async () => {
    const config = makeConfig();
    const open = createExtidIssue(config.repoRoot, "TASK-open", "open emoji", "b");
    const done = createExtidIssue(config.repoRoot, "TASK-done", "done emoji", "b");
    execFileSync("git", ["-C", config.repoRoot, "issue", "state", done.hash, "--close"]);

    const capOpen = await run([open.extid, "--emoji"], config);
    expect(capOpen.out).toBe(`○ ${open.extid} open emoji\n`);

    const capDone = await run([done.hash, "--emoji"], config); // closed issues resolve by hash
    expect(capDone.out).toBe(`✅ ${done.extid} done emoji\n`);
  });

  it("unknown extid exits 1 and names the id", async () => {
    const config = makeConfig();
    const cap = await run(["TASK-nowhere"], config);
    expect(cap.exits).toEqual([1]);
    expect(cap.err).toContain("TASK-nowhere");
  });

  it("missing ID exits 1 with usage", async () => {
    const config = makeConfig();
    const cap = await run([], config);
    expect(cap.exits).toEqual([1]);
    expect(cap.out).toContain("Usage: show");
  });
});
