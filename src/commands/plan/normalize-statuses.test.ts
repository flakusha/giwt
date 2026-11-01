// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertIndexUnedited, verifyIndexStamp, writeIndexStamp } from "../../tickets/index-stamp";
import type { WorktreeConfig } from "../../utils/config";
import { setOutputFormat } from "../../utils/output";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { runNormalizeStatuses } from "./normalize-statuses";

let root = "";
let config: WorktreeConfig;
let indexPath = "";

// Resource contract (parallel-safe): every test owns a mkdtemp fixture; the
// stdout spy is restored per test; no shared state, no process.exit leaks.
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
  indexPath = "";
});

function makeRepo(indexStatus: string): void {
  root = mkdtempSync(join(scratchRoot(), "giwt-normstat-"));
  mkdirSync(join(root, ".plan", "epics"), { recursive: true });
  mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
  writeFileSync(join(root, ".plan", "epics", "epic-x.md"), "# EPIC: X\n\n**Status:** Done\n");
  indexPath = join(root, ".plan", "tickets", "index.json");
  // "WONTFIX": not a matrix column (bucket "other") but resolveStatus maps it
  // to Wontfix → matrix "cancelled", so apply mode rewrites the index entry.
  writeFileSync(
    indexPath,
    JSON.stringify({ "TASK-x": { status: indexStatus, source: ".plan/tickets/t.md" } }, null, 2)
      + "\n",
  );
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
}

async function capture(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as never,
  );
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

describe("runNormalizeStatuses — index stamp contract", () => {
  test("--apply rewrites the index and leaves the stamp verdict ok", async () => {
    setOutputFormat("simple");
    makeRepo("WONTFIX");
    writeIndexStamp(indexPath); // healthy repo: stamp matches the bytes
    expect(verifyIndexStamp(indexPath)).toBe("ok");

    await capture(() => runNormalizeStatuses([], config));

    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, unknown>;
    expect(index).toEqual({ "TASK-x": { status: "cancelled", source: ".plan/tickets/t.md" } });
    expect(verifyIndexStamp(indexPath)).toBe("ok");
    expect(() => assertIndexUnedited(indexPath)).not.toThrow();
  });

  test("--apply refuses a manually edited (stale-stamp) index", async () => {
    setOutputFormat("simple");
    makeRepo("WONTFIX");
    writeIndexStamp(indexPath);
    // Out-of-band edit after stamping: the fail-closed signal.
    writeFileSync(indexPath, "{ \"TASK-x\": { \"status\": \"WONTFIX\" } }\n");

    let error: unknown;
    try {
      await capture(() => runNormalizeStatuses([], config));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("manually edited");
    // The out-of-band bytes are untouched — the command did not consume them.
    expect(readFileSync(indexPath, "utf8")).toBe("{ \"TASK-x\": { \"status\": \"WONTFIX\" } }\n");
  });

  test("--check exits 1 on drift and writes nothing", async () => {
    setOutputFormat("simple");
    makeRepo("WONTFIX");
    writeIndexStamp(indexPath);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code: number) => {
        throw new Error(`__exit:${code}`);
      }) as never,
    );
    const before = readFileSync(indexPath, "utf8");
    try {
      await capture(() => runNormalizeStatuses(["--check"], config));
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit:1");
    } finally {
      exitSpy.mockRestore();
    }
    expect(readFileSync(indexPath, "utf8")).toBe(before);
    expect(verifyIndexStamp(indexPath)).toBe("ok");
  });
});

describe("runNormalizeStatuses — epic headers, unresolved values, usage", () => {
  test("--apply rewrites a fixable epic header onto the canonical enum", async () => {
    setOutputFormat("simple");
    makeRepo("In Progress"); // index bucket in_progress: counted, untouched
    writeFileSync(join(root, ".plan", "epics", "epic-low.md"), "# EPIC: L\n\n**Status:** done\n");
    writeIndexStamp(indexPath);

    const out = await capture(() => runNormalizeStatuses([], config));

    const rewritten = readFileSync(join(root, ".plan", "epics", "epic-low.md"), "utf8");
    expect(rewritten).toContain("**Status:** Done");
    expect(out).toContain("\"done\" -> \"Done\"");
    // The canonical index entry is only counted, never rewritten.
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<
      string,
      { status?: string; }
    >;
    expect(index["TASK-x"]?.status).toBe("In Progress");
  });

  test("--check reports a fixable epic header without rewriting and exits 1", async () => {
    setOutputFormat("simple");
    makeRepo("Wontfix");
    writeFileSync(join(root, ".plan", "epics", "epic-low.md"), "# EPIC: L\n\n**Status:** done\n");
    writeIndexStamp(indexPath);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code: number) => {
        throw new Error(`__exit:${code}`);
      }) as never,
    );
    try {
      await capture(() => runNormalizeStatuses(["--check"], config));
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit:1");
    } finally {
      exitSpy.mockRestore();
    }
    expect(readFileSync(join(root, ".plan", "epics", "epic-low.md"), "utf8")).toContain(
      "**Status:** done",
    );
  });

  test("an off-vocabulary epic status is reported as INVALID, not rewritten", async () => {
    setOutputFormat("simple");
    makeRepo("Done");
    writeFileSync(
      join(root, ".plan", "epics", "epic-bad.md"),
      "# EPIC: B\n\n**Status:** bananas\n",
    );
    writeIndexStamp(indexPath);

    const out = await capture(() => runNormalizeStatuses([], config));

    expect(readFileSync(join(root, ".plan", "epics", "epic-bad.md"), "utf8")).toContain(
      "**Status:** bananas",
    );
    expect(out).toContain("INVALID \"bananas\"");
    expect(out).toContain("needs a human call");
  });

  test("a freeform index status with no vocabulary mapping is reported unresolved", async () => {
    setOutputFormat("simple");
    makeRepo("bananas");
    writeIndexStamp(indexPath);

    const out = await capture(() => runNormalizeStatuses([], config));

    expect(out).toContain("UNRESOLVED");
    expect(out).toContain("bananas");
    expect(JSON.parse(readFileSync(indexPath, "utf8"))["TASK-x"].status).toBe("bananas");
  });

  test("--help prints usage and exits 0", async () => {
    setOutputFormat("simple");
    makeRepo("Done");
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code: number) => {
        throw new Error(`__exit:${code}`);
      }) as never,
    );
    try {
      await capture(() => runNormalizeStatuses(["--help"], config));
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit:0");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("an unknown arg prints usage and exits 1", async () => {
    setOutputFormat("simple");
    makeRepo("Done");
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code: number) => {
        throw new Error(`__exit:${code}`);
      }) as never,
    );
    try {
      await capture(() => runNormalizeStatuses(["--bogus"], config));
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit:1");
    } finally {
      exitSpy.mockRestore();
    }
  });
});
