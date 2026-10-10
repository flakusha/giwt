// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan metadata` command + normalizePlanMetadata orchestration: the
 * four projection behaviors, --dry-run write-freedom (mtime + content), the
 * linked-worktree index-write guard (skip + deferred report), usage/help.
 */
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizePlanMetadata } from "../../plan/metadata-normalize";
import type { WorktreeConfig } from "../../utils/config";
import { runMetadata } from "./metadata";

describe("plan metadata", () => {
  const exitSpy = spyOn(process, "exit").mockImplementation(
    ((code: number) => {
      throw new Error(`__exit:${code}`);
    }) as never,
  );
  let root = "";
  let out = "";
  let restoreOut: (...args: unknown[]) => unknown = () => {};

  const start = (): void => {
    out = "";
    root = mkdtempSync(join(tmpdir(), "giwt-plan-meta-"));
    restoreOut = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: unknown) => {
        out += String(chunk);
        return true;
      }) as never,
    ) as unknown as (...args: unknown[]) => unknown;
  };

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    restoreOut();
  });

  const writePlan = (): void => {
    mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
    mkdirSync(join(root, ".plan", "epics"), { recursive: true });
    writeFileSync(
      join(root, ".plan", "tickets", "BUG-001.md"),
      "# BUG: one\n\n**Labels:** chat, bug\n**Epic**: epic-real\n",
    );
    writeFileSync(
      join(root, ".plan", "tickets", "BUG-002.md"),
      "# BUG: two\n\n**Status:** Done\n",
    );
    writeFileSync(join(root, ".plan", "epics", "epic-real.md"), "# EPIC: real\n");
    writeFileSync(
      join(root, ".plan", "tickets", "index.json"),
      JSON.stringify(
        {
          "BUG-001": { source: ".plan/tickets/BUG-001.md", tags: [], epic: "" },
          "BUG-002": { source: ".plan/tickets/BUG-002.md", tags: ["stale-tag"], epic: "" },
        },
        null,
        2,
      ) + "\n",
    );
  };

  const readIndex = (): Record<
    string,
    { tags?: string[]; epic?: string; source?: string; }
  > => JSON.parse(readFileSync(join(root, ".plan", "tickets", "index.json"), "utf8"));

  it("rewrites Labels→Tags and colon-outside Epic, then projects onto the index", () => {
    start();
    writePlan();
    const r = normalizePlanMetadata({ root, dryRun: false, allowIndexWrite: true });
    expect(r.filesChanged).toBe(1);
    expect(r.labelsToTags).toBe(1);
    expect(r.epicColonOutside).toBe(1);
    const md = readFileSync(join(root, ".plan", "tickets", "BUG-001.md"), "utf8");
    expect(md).toContain("**Tags:** chat, bug");
    expect(md).toContain("**Epic:** epic-real");
    expect(readIndex()["BUG-001"]).toEqual({
      source: ".plan/tickets/BUG-001.md",
      tags: ["chat", "bug"],
      epic: "epic-real",
    });
    expect(r.indexTagsFilled).toBe(1);
    expect(r.indexEpicsFilled).toBe(1);
  });

  it("backfills empty tag arrays", () => {
    start();
    writePlan();
    const r = normalizePlanMetadata({ root, dryRun: false, allowIndexWrite: true });
    expect(readIndex()["BUG-001"]!.tags).toEqual(["chat", "bug"]);
    expect(r.indexTagsFilled).toBeGreaterThan(0);
  });

  it("frontmatter wins: divergent index tags are repaired from the .md", () => {
    start();
    writePlan();
    writeFileSync(
      join(root, ".plan", "tickets", "index.json"),
      JSON.stringify({
        "BUG-001": {
          source: ".plan/tickets/BUG-001.md",
          tags: ["prose-fragment-garbage"],
          epic: "",
        },
      }),
    );
    normalizePlanMetadata({ root, dryRun: false, allowIndexWrite: true });
    expect(readIndex()["BUG-001"]!.tags).toEqual(["chat", "bug"]);
  });

  it("retention: a ticket with no Tags line keeps its stale index tags", () => {
    start();
    writePlan();
    const r = normalizePlanMetadata({ root, dryRun: false, allowIndexWrite: true });
    // BUG-002.md has no Tags line — its stale-tag entry must survive.
    expect(readIndex()["BUG-002"]!.tags).toEqual(["stale-tag"]);
    expect(r.indexTagsFilled).toBe(1);
  });

  it("a file with no Tags line is left untouched by the md rewrite pass", () => {
    start();
    writePlan();
    normalizePlanMetadata({ root, dryRun: false, allowIndexWrite: true });
    expect(readFileSync(join(root, ".plan", "tickets", "BUG-002.md"), "utf8"))
      .toBe("# BUG: two\n\n**Status:** Done\n");
  });

  it("--dry-run makes no writes: mtimes and contents are byte-identical", () => {
    start();
    writePlan();
    // Canonical md already — dry-run must still leave everything untouched.
    writeFileSync(
      join(root, ".plan", "tickets", "BUG-001.md"),
      "# BUG: one\n\n**Tags:** chat, bug\n**Epic:** epic-real\n",
    );
    const md = join(root, ".plan", "tickets", "BUG-001.md");
    const idx = join(root, ".plan", "tickets", "index.json");
    const beforeMd = readFileSync(md, "utf8");
    const beforeIdx = readFileSync(idx, "utf8");
    const mtimeMd = statSync(md).mtimeMs;
    const mtimeIdx = statSync(idx).mtimeMs;
    const r = normalizePlanMetadata({ root, dryRun: true, allowIndexWrite: true });
    expect(r.filesChanged).toBe(0);
    expect(r.indexTagsFilled).toBe(1);
    expect(r.indexDeferred).toBe(false);
    expect(readFileSync(md, "utf8")).toBe(beforeMd);
    expect(readFileSync(idx, "utf8")).toBe(beforeIdx);
    expect(statSync(md).mtimeMs).toBe(mtimeMd);
    expect(statSync(idx).mtimeMs).toBe(mtimeIdx);
  });

  it("the worktree index-write guard skips the write and reports deferred", () => {
    start();
    writePlan();
    const before = readFileSync(join(root, ".plan", "tickets", "index.json"), "utf8");
    const r = normalizePlanMetadata({ root, dryRun: false, allowIndexWrite: false });
    expect(r.indexDeferred).toBe(true);
    expect(r.indexTagsFilled).toBe(1);
    expect(readFileSync(join(root, ".plan", "tickets", "index.json"), "utf8")).toBe(before);
  });

  it("the command renders --json with dryRun true", async () => {
    start();
    writePlan();
    const cfg = ({ worktreeRoot: root, repoRoot: root }) as unknown as WorktreeConfig;
    await runMetadata(["--dry-run", "--json"], cfg);
    const payload = JSON.parse(out);
    expect(payload.dryRun).toBe(true);
    expect(payload.indexDeferred).toBe(false);
  });

  it("renders the human-readable report on a real run", async () => {
    start();
    writePlan();
    // A dangling epic binding + dangling **Related:** ref exercise the
    // advisory render block; BUG-002 (no Tags line) lands in stillUntagged.
    writeFileSync(
      join(root, ".plan", "tickets", "index.json"),
      JSON.stringify(
        {
          "BUG-001": { source: ".plan/tickets/BUG-001.md", tags: [], epic: "" },
          "BUG-002": {
            source: ".plan/tickets/BUG-002.md",
            tags: ["stale-tag"],
            epic: "epic-nowhere",
          },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(root, ".plan", "tickets", "BUG-002.md"),
      // Declares epic-nowhere with no epic file behind it → the binding
      // survives frontmatter-wins projection AND lands in danglingEpics.
      "# BUG: two\n\n**Status:** Done\n**Epic:** epic-nowhere\n**Related:** TASK-nope.md\n",
    );
    const cfg = ({ worktreeRoot: root, repoRoot: root }) as unknown as WorktreeConfig;
    await runMetadata([], cfg);
    expect(out).toContain("=== Plan metadata normalization ===");
    expect(out).toContain("**Labels:** → **Tags:** rewrites: 1");
    expect(out).toContain("files changed: 1");
    expect(out).toContain("tags backfilled: 1");
    expect(out).toContain("Advisory — needs a human decision:");
    expect(out).toContain(".plan/tickets/BUG-002.md: epic-nowhere");
    expect(out).toContain("tickets still carrying no tags: 1");
    expect(out).toContain("**Related:** refs naming no plan file: 1");
    expect(out).toContain("BUG-002.md: TASK-nope.md");
    expect(out).toContain("giwt sync && giwt plan matrix && giwt plan code-map");
  });

  it("--help prints usage and an unknown flag exits 1", async () => {
    start();
    writePlan();
    const cfg = ({ worktreeRoot: root, repoRoot: root }) as unknown as WorktreeConfig;
    await runMetadata(["--help"], cfg);
    expect(out).toContain("Usage: giwt plan metadata");
    await expect(runMetadata(["--nope"], cfg)).rejects.toThrow("__exit:1");
    expect(exitSpy).toHaveBeenCalled();
  });
});
