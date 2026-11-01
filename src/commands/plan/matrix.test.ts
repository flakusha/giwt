// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan matrix` command tests focused on the v2 format marker seam
 * (FEAT-feature-matrix-project-dimension-upstream-seam): the renderer emits
 * the marker, `--check` treats an on-disk v1 file as stale, and a
 * regeneration flips the gate back to clean.
 */
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { genMatrix, matrixOutput } from "../../plan/feature-matrix";
import type { IndexEntry } from "../../tickets/sync-ticket";
import type { WorktreeConfig } from "../../utils/config";
import { runMatrix } from "./matrix";

describe("plan matrix format marker", () => {
  spyOn(process, "exit").mockImplementation(
    ((code: number) => {
      throw new Error(`__exit:${code}`);
    }) as never,
  );
  let root = "";
  let outPath = "";
  let indexPath = "";
  let restoreOut: (...args: unknown[]) => unknown = () => {};
  let restoreErr: (...args: unknown[]) => unknown = () => {};

  const start = (): void => {
    restoreOut();
    restoreErr();
    root = mkdtempSync(join(tmpdir(), "giwt-plan-matrix-"));
    indexPath = join(root, ".plan", "tickets", "index.json");
    outPath = join(root, ".plan", "feature-matrix.md");
    mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
    restoreOut = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as never,
    ) as unknown as (...args: unknown[]) => unknown;
    restoreErr = spyOn(process.stderr, "write").mockImplementation(
      (() => true) as never,
    ) as unknown as (...args: unknown[]) => unknown;
  };

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    restoreOut();
    restoreErr();
  });

  const config = (): WorktreeConfig =>
    ({
      worktreeRoot: root,
      settings: { paths: { planDir: ".plan" } },
    }) as unknown as WorktreeConfig;

  const writeIndex = (): void => {
    const entry = (overrides: Partial<IndexEntry>): IndexEntry =>
      ({
        hash: "pending",
        extid: "TASK-X",
        type: "TASK",
        title: "x",
        label: "task",
        priority: "medium",
        epic: "",
        project: "",
        tags: [],
        source: "",
        status: "open",
        ...overrides,
      }) as IndexEntry;
    writeFileSync(
      indexPath,
      JSON.stringify({
        "TASK-ONE": entry({ extid: "TASK-ONE", tags: ["plan"], project: "loop-lore" }),
        "TASK-TWO": entry({ extid: "TASK-TWO", tags: [] }),
      }) + "\n",
    );
  };

  it("renderer emits the v2 format marker and the project section", () => {
    start();
    writeIndex();
    const { output } = matrixOutput(indexPath);
    expect(output).toContain("<!-- feature-matrix format: 2 -->");
    expect(output).toContain("## By project × status");
    expect(output).toContain("| loop-lore |");
    expect(output).toContain("| (unprojected) | 1 |");
    // genMatrix persists the same bytes — the marker is in the written file.
    genMatrix({ indexPath, outPath });
    expect(readFileSync(outPath, "utf8")).toBe(output);
  });

  it("--check flags an on-disk v1 file as stale", () => {
    start();
    writeIndex();
    genMatrix({ indexPath, outPath });
    // Simulate a v1 file: same shape minus the marker line.
    const v1 = readFileSync(outPath, "utf8").replace("<!-- feature-matrix format: 2 -->\n", "");
    writeFileSync(outPath, v1);
    expect(() => runMatrix(["--check"], config())).toThrow(/__exit:1/);
  });

  it("regenerate → check passes", () => {
    start();
    writeIndex();
    genMatrix({ indexPath, outPath });
    expect(() => runMatrix(["--check"], config())).not.toThrow();
  });

  it("default run writes the matrix file and reports success", () => {
    start();
    writeIndex();
    expect(() => runMatrix([], config())).not.toThrow();
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf8")).toContain("feature-matrix format: 2");
  });

  it("--json prints the matrix record on stdout without writing the file", () => {
    start();
    writeIndex();
    expect(() => runMatrix(["--json"], config())).not.toThrow();
    expect(existsSync(outPath)).toBe(false);
  });

  it("--check with --json refuses (mutually exclusive)", () => {
    start();
    writeIndex();
    expect(() => runMatrix(["--check", "--json"], config())).toThrow(/__exit:1/);
  });

  it("unknown flags print usage and exit 1", () => {
    start();
    expect(() => runMatrix(["--bogus"], config())).toThrow(/__exit:1/);
  });

  it("--check with a missing matrix file fails naming the path", () => {
    start();
    writeIndex();
    expect(() => runMatrix(["--check"], config())).toThrow(/__exit:1/);
  });

  it("a missing ticket index fails with the path named", () => {
    start();
    expect(() => runMatrix([], config())).toThrow(/index\.json/);
  });
});
