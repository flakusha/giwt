// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt plan status --tickets` per-ticket breakdown.
 *
 * Coverage (fixture .plan/tickets — same convention as show.test.ts,
 * deliberately NOT mock.module):
 *   - human output: one `STATUS  n-unticked  NAME` line per ticket,
 *     sorted by name, plus a rollup line (counts per status + total)
 *   - Status parsed like sync-index: header region only (first 30
 *     lines), first Status line wins; missing → "undefined"
 *   - unticked acceptance counts scan the whole file
 *   - --json parses back to {name, status, unticked, path} records
 *   - --toml round-trips through Bun.TOML.parse
 *   - --emoji emits one line per record
 *   - empty tickets dir → zero rollup, exit 0; --json → []
 *   - unknown flag exits 1; machine flags without --tickets exit 1
 *   - plain `plan status` summary still renders
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempRoots: string[] = [];
const CLI = join(import.meta.dir, "..", "cli.ts");

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "giwt-plan-status-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"]);
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"]);
  return root;
}

function writeTicket(root: string, name: string, body: string): string {
  const dir = join(root, ".plan", "tickets");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

/** Mixed fixture: line-33 status ignored (header region), mixed checkboxes, bold-less status, ignored non-md file. */
function writeMixedFixture(root: string): string {
  writeTicket(
    root,
    "BUG-gamma.md",
    [
      "# BUG: gamma",
      "",
      "- [ ] first unchecked",
      ...Array.from({ length: 29 }, () => ""),
      // Line 33 — beyond the 30-line header region: must NOT set status.
      "**Status:** Done",
    ].join("\n"),
  );
  writeTicket(
    root,
    "FEAT-beta.md",
    [
      "# FEAT: beta",
      "",
      "**Status:** In Progress",
      "",
      "## Acceptance",
      "",
      "- [ ] one",
      "- [ ] two",
      "- [x] three",
    ].join("\n"),
  );
  writeTicket(
    root,
    "TASK-alpha.md",
    ["# TASK: alpha", "", "**Status**: Done", "", "Nothing left to do."].join("\n"),
  );
  // Non-ticket file must be ignored.
  writeFileSync(join(root, ".plan", "tickets", "index.json"), "{}\n");
  return join(root, ".plan", "tickets");
}

type Captured = { out: string; err: string; exits: number[]; };

/** Subprocess run: `bun src/cli.ts plan status <args>` with REPO_ROOT pinned to the fixture. */
function run(args: string[], root: string): Captured {
  const proc = Bun.spawnSync(["bun", CLI, "plan", "status", ...args], {
    cwd: root,
    env: { ...process.env, REPO_ROOT: root, TREE_DIR: root },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  });
  return {
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
    exits: proc.exitCode === 0 ? [] : [proc.exitCode ?? 1],
  };
}

describe("plan status --tickets", () => {
  it("human output lists one line per ticket sorted by name plus a rollup", async () => {
    const root = makeRoot();
    writeMixedFixture(root);
    const cap = await run(["--tickets"], root);
    expect(cap.exits).toEqual([]);
    expect(cap.out).toBe(
      [
        "undefined  1  BUG-gamma.md",
        "In Progress  2  FEAT-beta.md",
        "Done  0  TASK-alpha.md",
        "rollup: Done×1, In Progress×1, undefined×1 · unticked 3",
      ].join("\n") + "\n",
    );
  });

  it("--json emits records with name, status, unticked, path", async () => {
    const root = makeRoot();
    const ticketsDir = writeMixedFixture(root);
    const cap = await run(["--tickets", "--json"], root);
    expect(cap.exits).toEqual([]);
    const records = JSON.parse(cap.out) as Array<{
      name: string;
      status: string;
      unticked: number;
      path: string;
    }>;
    expect(records.map((r) => r.name)).toEqual([
      "BUG-gamma.md",
      "FEAT-beta.md",
      "TASK-alpha.md",
    ]);
    expect(records[0]).toEqual({
      name: "BUG-gamma.md",
      status: "undefined",
      unticked: 1,
      path: join(ticketsDir, "BUG-gamma.md"),
    });
    expect(records[1]?.status).toBe("In Progress");
    expect(records[1]?.unticked).toBe(2);
    expect(records[2]?.status).toBe("Done");
    expect(records[2]?.unticked).toBe(0);
  });

  it("--toml round-trips through Bun.TOML.parse", async () => {
    const root = makeRoot();
    const ticketsDir = writeMixedFixture(root);
    const cap = await run(["--tickets", "--toml"], root);
    const parsed = Bun.TOML.parse(cap.out) as {
      items: Array<{ name: string; status: string; unticked: number; path: string; }>;
    };
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[1]).toEqual({
      name: "FEAT-beta.md",
      status: "In Progress",
      unticked: 2,
      path: join(ticketsDir, "FEAT-beta.md"),
    });
  });

  it("--emoji emits one line per record, glyph by unticked count", async () => {
    const root = makeRoot();
    writeMixedFixture(root);
    const cap = await run(["--tickets", "--emoji"], root);
    const lines = cap.out.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("🟡 In Progress · 2 unticked · FEAT-beta.md");
    expect(lines[2]).toBe("✅ Done · 0 unticked · TASK-alpha.md");
  });

  it("annotated Done prose collapses into Done in the rollup, raw value kept on the line", async () => {
    const root = makeRoot();
    const ticketsDir = join(root, ".plan", "tickets");
    mkdirSync(ticketsDir, { recursive: true });
    writeFileSync(
      join(ticketsDir, "TASK-annotated.md"),
      "# T\n\n**Status:** Done (shipped: landed on master)\n\n- [x] done thing\n",
    );
    const cap = await run(["--tickets"], root);
    expect(cap.out).toBe(
      [
        "Done (shipped: landed on master)  0  TASK-annotated.md",
        "rollup: Done×1 · unticked 0",
      ].join("\n") + "\n",
    );
  });

  it("empty tickets dir → zero rollup, exit 0; --json → []", async () => {
    const root = makeRoot();
    mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
    const cap = await run(["--tickets"], root);
    expect(cap.exits).toEqual([]);
    expect(cap.out).toBe("rollup: (no tickets) · unticked 0\n");

    const capJson = await run(["--tickets", "--json"], root);
    expect(capJson.exits).toEqual([]);
    expect(capJson.out).toBe("[]\n");
  });

  it("missing .plan/tickets dir behaves like empty (zero rollup, exit 0)", async () => {
    const root = makeRoot();
    const cap = await run(["--tickets"], root);
    expect(cap.exits).toEqual([]);
    expect(cap.out).toBe("rollup: (no tickets) · unticked 0\n");
  });

  it("unknown flag exits 1 with usage; --help exits 0", async () => {
    const root = makeRoot();
    const cap = await run(["--bogus"], root);
    expect(cap.exits).toEqual([1]);
    expect(cap.out).toContain("Usage: giwt plan status");

    const capHelp = await run(["--help"], root);
    expect(capHelp.exits).toEqual([]);
    expect(capHelp.out).toContain("--tickets");
  });

  it("machine flags without --tickets exit 1 naming the requirement", async () => {
    const root = makeRoot();
    const cap = await run(["--json"], root);
    expect(cap.exits).toEqual([1]);
    expect(cap.err).toContain("--tickets");
  });

  it("multiple output flags warn and use the highest precedence", async () => {
    const root = makeRoot();
    writeMixedFixture(root);
    const cap = await run(["--tickets", "--json", "--emoji"], root);
    expect(cap.exits).toEqual([]);
    expect(cap.err).toContain("multiple output flags");
    const records = JSON.parse(cap.out) as unknown[];
    expect(records).toHaveLength(3);
  });

  it("plain plan status summary is unchanged", async () => {
    const root = makeRoot();
    writeMixedFixture(root);
    const cap = await run([], root);
    expect(cap.exits).toEqual([]);
    expect(cap.out).toContain("Plan Status");
    expect(cap.out).toContain("Tickets");
  });
});
