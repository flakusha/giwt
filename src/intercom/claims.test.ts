// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Lane claim mechanics: O_EXCL double-claim refusal (with owner naming),
 * completion stubs, detail embedding, and lane-name validation.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { checkLaneName, claimLane, hasClaim, hasFixed, writeFixed } from "./claims";

let storeDir = "";
const tempRoots: string[] = [];

beforeEach(() => {
  storeDir = mkdtempSync(join(scratchRoot(), "giwt-intercom-claims-"));
  tempRoots.push(storeDir);
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkLaneName", () => {
  it("accepts filename-safe names and rejects separators/dots-leading", () => {
    expect(checkLaneName("finalize-wave")).toBe("finalize-wave");
    expect(checkLaneName("land_x.2")).toBe("land_x.2");
    expect(() => checkLaneName("a/b")).toThrow(/invalid lane name/);
    expect(() => checkLaneName(".hidden")).toThrow(/invalid lane name/);
    expect(() => checkLaneName("")).toThrow(/invalid lane name/);
    expect(() => checkLaneName("x".repeat(81))).toThrow(/invalid lane name/);
  });
});

describe("claimLane", () => {
  it("creates the claim file with owner/scope/date header", () => {
    const path = claimLane(storeDir, "lane-a", "agent-1", "prep work");
    expect(existsSync(path)).toBe(true);
    expect(hasClaim(storeDir, "lane-a")).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toContain("# LANE: lane-a");
    expect(body).toContain("owner=agent-1");
    expect(body).toContain("scope=prep work");
    expect(body).toMatch(/date=\d{4}-\d{2}-\d{2}T/);
  });

  it("fails the double claim loudly, naming the existing owner", () => {
    claimLane(storeDir, "lane-a", "agent-1");
    expect(() => claimLane(storeDir, "lane-a", "agent-2")).toThrow(/already claimed .* by agent-1/);
  });

  it("scope header is omitted when no scope given", () => {
    const path = claimLane(storeDir, "lane-b", "agent-1");
    expect(readFileSync(path, "utf8")).not.toContain("scope=");
  });
});

describe("writeFixed", () => {
  it("creates the completion stub and refuses a second one", () => {
    const path = writeFixed(storeDir, "lane-a", { owner: "agent-1", note: "landed" });
    expect(hasFixed(storeDir, "lane-a")).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("# FIXED: lane-a");
    expect(() => writeFixed(storeDir, "lane-a", { owner: "agent-2" })).toThrow(
      /already has a completion report/,
    );
  });

  it("embeds a detail file's contents so evidence survives its scratch dir", () => {
    const detail = mkdtempSync(join(scratchRoot(), "giwt-intercom-detail-"));
    tempRoots.push(detail);
    const detailPath = join(detail, "report.md");
    writeFileSync(detailPath, "commit abc, gates green");
    const path = writeFixed(storeDir, "lane-c", { owner: "a", detailPath });
    const body = readFileSync(path, "utf8");
    expect(body).toContain("## Detail");
    expect(body).toContain("commit abc, gates green");
  });

  it("rejects an unreadable detail file without writing the stub", () => {
    expect(() => writeFixed(storeDir, "lane-d", { owner: "a", detailPath: "/no/such/file" }))
      .toThrow(
        /unreadable detail file/,
      );
    expect(hasFixed(storeDir, "lane-d")).toBe(false);
  });
});
