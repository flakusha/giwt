// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan report` command surface: subactions, --json, exit codes
 * (0 success / 1 usage error), negative space (empty index, zero matches,
 * empty epic values).
 */
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { runReport } from "./report";

describe("plan report command", () => {
  let root = "";
  let out = "";
  let restoreOut: (...args: unknown[]) => unknown = () => {};
  const exitSpy = spyOn(process, "exit").mockImplementation(
    ((code: number) => {
      throw new Error(`__exit:${code}`);
    }) as never,
  );

  const start = (): void => {
    root = mkdtempSync(join(tmpdir(), "giwt-plan-report-"));
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

  const writePlan = (index: unknown): void => {
    mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
    mkdirSync(join(root, ".plan", "epics"), { recursive: true });
    writeFileSync(join(root, ".plan", "tickets", "index.json"), JSON.stringify(index));
    writeFileSync(
      join(root, ".plan", "tickets", "A.md"),
      "# FEAT: A\n\n**Tags:** chat\n**Epic:** epic-real\n",
    );
    writeFileSync(join(root, ".plan", "epics", "epic-real.md"), "# EPIC: real\n");
  };

  const config = (): WorktreeConfig => ({ worktreeRoot: root }) as unknown as WorktreeConfig;

  const run = async (args: string[]): Promise<string> => {
    out = "";
    await runReport(args, config());
    return out;
  };

  it("aggregate is the default subaction and prints totals", async () => {
    start();
    writePlan({ "A": { source: ".plan/tickets/A.md", tags: ["chat"], epic: "epic-real" } });
    expect(await run([])).toContain("tickets: 1");
  });

  it("tags <tag> matches case-insensitively; zero matches prints an empty count", async () => {
    start();
    writePlan({ "A": { source: ".plan/tickets/A.md", tags: ["chat"] } });
    expect(await run(["tags", "CHAT"])).toContain("A");
    expect(await run(["tags", "no-such"])).toContain("(0 ticket(s))");
  });

  it("epic <id> resolves against index bindings", async () => {
    start();
    writePlan({ "A": { source: ".plan/tickets/A.md", tags: [], epic: "epic-real" } });
    expect(await run(["epic", "epic-real.md"])).toContain("A");
  });

  it("orphans lists orphan tags, bindings, and dangling Related refs", async () => {
    start();
    writePlan({ "A": { source: ".plan/tickets/A.md", tags: ["ghost"], epic: "epic-gone" } });
    writeFileSync(
      join(root, ".plan", "tickets", "A.md"),
      "# FEAT: A\n\n**Related:** no-such-file.md\n",
    );
    const text = await run(["orphans"]);
    expect(text).toContain("orphan tags");
    expect(text).toContain("A: ghost");
    expect(text).toContain("A: epic-gone");
    expect(text).toContain("no-such-file.md");
  });

  it("--json emits parseable output for every subaction", async () => {
    start();
    writePlan({ "A": { source: ".plan/tickets/A.md", tags: ["chat"], epic: "epic-real" } });
    const agg = JSON.parse(await run(["--json"]));
    expect(agg.command).toBe("aggregate");
    expect(agg.result.tickets).toBe(1);
    expect(agg.result.orphans).toBe(0);
    const tags = JSON.parse(await run(["tags", "chat", "--json"]));
    expect(tags.result).toHaveLength(1);
    const orphans = JSON.parse(await run(["orphans", "--json"]));
    expect(orphans.result.orphanTags).toEqual([]);
    expect(orphans.result.orphanBindings).toEqual([]);
  });

  it("an empty index and empty epic values are handled, not fatal", async () => {
    start();
    mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
    writeFileSync(join(root, ".plan", "tickets", "index.json"), "{}");
    expect(await run([])).toContain("tickets: 0");
    expect(await run(["epic", "anything"])).toContain("(0 ticket(s))");
  });

  it("a missing value for tags/epic is a usage error (exit 1)", async () => {
    start();
    writePlan({});
    await expect(run(["tags"])).rejects.toThrow("__exit:1");
    await expect(run(["epic"])).rejects.toThrow("__exit:1");
  });

  it("an unknown subaction exits 1", async () => {
    start();
    writePlan({});
    await expect(run(["bogus"])).rejects.toThrow("__exit:1");
  });

  it("success never calls process.exit", async () => {
    start();
    exitSpy.mockClear();
    writePlan({});
    await run([]);
    expect(exitSpy.mock.calls.length).toBe(0);
  });
});
