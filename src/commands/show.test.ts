// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "../utils/scratch-tmp";
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
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { parseIssueShow, show } from "./show";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeConfig(): WorktreeConfig {
  const root = mkdtempSync(join(scratchRoot(), "giwt-show-"));
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
    expect(rec).toMatchObject({
      extid: "TASK-json",
      hash: fx.hash,
      state: "open",
      title: "TASK-json: json title",
      priority: "high",
      body: "json body",
    });
    expect(typeof rec.author).toBe("string");
    expect(typeof rec.created).toBe("string");
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

  // BUG-show-emoji-null-extid-mangles-title: extid is null for foreign
  // issues, but an `!== undefined` check let `replace("null: ", "")` eat a
  // literal `null: ` out of the title.
  it("--emoji keeps `null: ` in a title when the issue has no extid", async () => {
    const config = makeConfig();
    const out = execFileSync(
      "git",
      ["-C", config.repoRoot, "issue", "create", "null: packet loss", "-m", "b"],
      { encoding: "utf8" },
    );
    const hash = out.match(/[0-9a-f]{7,40}/)?.[0];
    if (!hash) throw new Error(`could not extract issue hash from: ${out}`);

    const cap = await run([hash, "--emoji"], config);
    expect(cap.exits).toEqual([]);
    expect(cap.out).toBe(`○ ${hash} null: packet loss\n`);
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
    expect(cap.err).toContain("usage: show");
  });

  it("warns once and keeps the chosen format when multiple output flags are given", async () => {
    const config = makeConfig();
    const fx = createExtidIssue(config.repoRoot, "TASK-flags", "flags title", "b");

    const cap = await run([fx.extid, "--json", "--toml"], config);
    expect(cap.exits).toEqual([]);
    expect((cap.err.match(/multiple output flags given/g) ?? []).length).toBe(1);
    expect(cap.err).toContain("--json");
    expect((JSON.parse(cap.out) as { extid: string; }).extid).toBe(fx.extid);
  });

  // TASK-show-state-resolve-plan-tickets-filename-slugs: the resolver must
  // accept every ID form an agent sees on disk — uppercase extid, lowercase
  // filename slug, slug.md, and hex hash.
  describe("resolveExtid input forms", () => {
    it("resolves lowercase slug, slug.md, and uppercase extid to the same issue", async () => {
      const config = makeConfig();
      const fx = createExtidIssue(config.repoRoot, "TASK-resolve-forms", "forms title", "b");

      for (const form of [fx.extid, "TASK-resolve-forms", "TASK-resolve-forms.md"]) {
        const cap = await run([form, "--json"], config);
        expect(cap.exits).toEqual([]);
        const rec = JSON.parse(cap.out) as { hash: string; extid: string; };
        expect(rec.hash).toBe(fx.hash);
        expect(rec.extid).toBe(fx.extid);
      }
    });

    it("slug.md resolves without leaking the suffix into the passthrough hash", async () => {
      const config = makeConfig();
      createExtidIssue(config.repoRoot, "BUG-suffix-check", "suffix title", "b");

      const cap = await run(["BUG-suffix-check.md", "--json"], config);
      const rec = JSON.parse(cap.out) as { extid: string; };
      expect(rec.extid).toBe("BUG-suffix-check");
    });

    it("prefers an exact extid over a prefix-colliding substring match", async () => {
      const config = makeConfig();
      const alpha = createExtidIssue(config.repoRoot, "TASK-alpha", "alpha title", "b");
      // git-issue sorts by creation second; make the longer prefix sort first
      // so the old first-substring-match bug would capture both lookups.
      Bun.sleepSync(1100);
      const alphabet = createExtidIssue(config.repoRoot, "TASK-alphabet", "alphabet title", "b");

      for (
        const [input, expected] of [[alphabet.extid, alphabet.hash], [
          alpha.extid,
          alpha.hash,
        ]] as const
      ) {
        const cap = await run([input, "--json"], config);
        expect(cap.exits).toEqual([]);
        expect((JSON.parse(cap.out) as { hash: string; }).hash).toBe(expected);
      }
    });

    it("does not resolve a short missing extid to a longer registered one", async () => {
      const config = makeConfig();
      createExtidIssue(config.repoRoot, "TASK-alphabet", "alphabet title", "b");

      const cap = await run(["TASK-alpha", "--json"], config);
      expect(cap.exits).toEqual([1]);
      expect(cap.err).toContain("TASK-alpha");
    });

    it("resolves a truncated slug only when one longer extid matches", async () => {
      const config = makeConfig();
      const extid = "TASK-" + "a".repeat(70);
      const fx = createExtidIssue(config.repoRoot, extid, "long slug", "b");

      const cap = await run([extid.slice(0, 60), "--json"], config);
      expect(cap.exits).toEqual([]);
      expect((JSON.parse(cap.out) as { hash: string; }).hash).toBe(fx.hash);
    });

    it("leaves a truncated prefix ambiguous when two extids share it", async () => {
      const config = makeConfig();
      const prefix = "TASK-" + "a".repeat(55); // 60 chars — the slug cap
      createExtidIssue(config.repoRoot, prefix + "beta", "beta title", "b");
      createExtidIssue(config.repoRoot, prefix + "gamma", "gamma title", "b");

      const cap = await run([prefix, "--json"], config);
      expect(cap.exits).toEqual([1]);
      expect(cap.err).toContain(prefix);
    });

    it("resolves a bare registry title, case-insensitively", async () => {
      const config = makeConfig();
      const out = execFileSync(
        "git",
        ["-C", config.repoRoot, "issue", "create", "TASK-bare registry title", "-m", "b"],
        { encoding: "utf8" },
      );
      const hash = out.match(/[0-9a-f]{7,40}/)?.[0];
      if (!hash) throw new Error(`could not extract issue hash from: ${out}`);

      for (const form of ["TASK-bare", "task-bare"]) {
        const cap = await run([form, "--json"], config);
        expect(cap.exits).toEqual([]);
        expect((JSON.parse(cap.out) as { hash: string; }).hash).toBe(hash);
      }
    });
  });
});

describe("parseIssueShow", () => {
  it("parses hyphenated and spaced states but rejects invalid hashes", () => {
    const withState = (state: string) =>
      [
        `Issue 0123456 [${state}]`,
        "============================================================",
        "Title:   TASK-dup: duplicate issue",
        "",
        "body",
      ].join("\n");
    expect(parseIssueShow(withState("duplicate-of-TASK-zzz"))?.state).toBe("duplicate-of-TASK-zzz");
    expect(parseIssueShow(withState("Not Started"))?.state).toBe("Not Started");
    expect(parseIssueShow("Issue nothex [open]\n====\nTitle: x\n")).toBeNull();
  });

  it("keeps thematic breaks in the body and cuts only at Updates", () => {
    const output = [
      "Issue 0123456 [open]",
      "============================================================",
      "Title:   TASK-break: body with a break",
      "",
      "first paragraph",
      "----------",
      "second paragraph",
      "",
      "------------------------------------------------------------",
      "Updates (1):",
      "  someone: state changed",
    ].join("\n");
    expect(parseIssueShow(output)?.body).toBe("first paragraph\n----------\nsecond paragraph");
  });

  it("parses every optional header field", () => {
    const output = [
      "Issue 0123456 [open]",
      "============================================================",
      "Title:   TASK-fields: all the fields",
      "Author:  tester <tester@localhost>",
      "Created: 2026-01-02 03:04:05 +0000",
      "Labels:  bug, docs",
      "Assignee: alice",
      "Priority: high",
      "Milestone: v1",
      "",
      "body",
    ].join("\n");
    expect(parseIssueShow(output)).toEqual({
      extid: "TASK-fields",
      hash: "0123456",
      state: "open",
      title: "TASK-fields: all the fields",
      labels: ["bug", "docs"],
      priority: "high",
      author: "tester <tester@localhost>",
      created: "2026-01-02 03:04:05 +0000",
      assignee: "alice",
      milestone: "v1",
      body: "body",
    });
  });
});
