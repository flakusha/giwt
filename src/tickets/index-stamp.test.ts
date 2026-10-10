// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Index-authenticity stamp coverage (FEAT-reject-manual-edits-to-plan-
 * tickets-index-json): out-of-band index edits are rejected with the clear
 * remedy message on read/use paths, while giwt sync writes (and re-writes)
 * refresh the stamp without false positives. Missing/corrupt stamps fail
 * open (legacy adoption); a present-but-mismatched stamp fails closed.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTicketIndex } from "../commands/ticket/lookup";
import { scratchRoot } from "../utils/scratch-tmp";
import { STAMP_SUFFIX, verifyIndexStamp, writeIndexStamp } from "./index-stamp";
import { persistIndexCanonical } from "./sync-index-write";

function tempDir(): string {
  return mkdtempSync(join(scratchRoot(), "giwt-index-stamp-"));
}

function writeIndexFile(root: string, body: string): string {
  const indexPath = join(root, "index.json");
  writeFileSync(indexPath, body);
  return indexPath;
}

describe("verifyIndexStamp verdicts", () => {
  test("missing index → ok; unstamped legacy index → unstamped (fail-open)", () => {
    const dir = tempDir();
    try {
      expect(verifyIndexStamp(join(dir, "index.json"))).toBe("ok");
      const indexPath = writeIndexFile(dir, "{}\n");
      expect(verifyIndexStamp(indexPath)).toBe("unstamped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stamped index matches → ok; hand-edited bytes → mismatch (fail-closed)", () => {
    const dir = tempDir();
    try {
      const indexPath = writeIndexFile(dir, "{}\n");
      writeIndexStamp(indexPath);
      expect(verifyIndexStamp(indexPath)).toBe("ok");
      // Out-of-band edit: bytes change, stamp does not.
      writeFileSync(indexPath, "{\"TASK-X\":{}}\n");
      expect(verifyIndexStamp(indexPath)).toBe("mismatch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrupt or malformed stamp content fails open as unstamped", () => {
    const dir = tempDir();
    try {
      const indexPath = writeIndexFile(dir, "{}\n");
      writeFileSync(indexPath + STAMP_SUFFIX, "not-a-hash");
      expect(verifyIndexStamp(indexPath)).toBe("unstamped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("giwt sync writing twice in a row refreshes the stamp — no false positive", () => {
    const dir = tempDir();
    try {
      const indexPath = join(dir, "index.json");
      persistIndexCanonical(dir, indexPath, { A: { extid: "A" } });
      expect(verifyIndexStamp(indexPath)).toBe("ok");
      persistIndexCanonical(dir, indexPath, { A: { extid: "A" }, B: { extid: "B" } });
      expect(verifyIndexStamp(indexPath)).toBe("ok");
      expect(existsSync(indexPath + STAMP_SUFFIX)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readTicketIndex rejection path", () => {
  test("hand-edited index is rejected with the frontmatter remedy message", () => {
    const dir = tempDir();
    try {
      const ticketsDir = join(dir, ".plan", "tickets");
      mkdirSync(ticketsDir, { recursive: true });
      const indexPath = join(ticketsDir, "index.json");
      writeFileSync(indexPath, "{}\n");
      writeIndexStamp(indexPath);
      // Manual edit AFTER the stamp.
      writeFileSync(indexPath, "{\"TASK-X\":{\"extid\":\"TASK-X\"}}\n");

      expect(() => readTicketIndex(dir, ".plan/tickets")).toThrow(
        /frontmatter is source of truth; edit the \.md and run giwt sync/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("happy path: sync-written index reads cleanly (unstamped legacy reads too)", () => {
    const dir = tempDir();
    try {
      const ticketsDir = join(dir, ".plan", "tickets");
      mkdirSync(ticketsDir, { recursive: true });
      const indexPath = join(ticketsDir, "index.json");
      persistIndexCanonical(dir, indexPath, {
        "TASK-OK": { extid: "TASK-OK", tags: ["t"] },
      });
      expect(readTicketIndex(dir, ".plan/tickets")["TASK-OK"]?.extid).toBe("TASK-OK");

      // Legacy unstamped index: fail-open adoption.
      const legacyDir = tempDir();
      try {
        const legacyTickets = join(legacyDir, ".plan", "tickets");
        mkdirSync(legacyTickets, { recursive: true });
        writeFileSync(join(legacyTickets, "index.json"), "{}\n");
        expect(readTicketIndex(legacyDir, ".plan/tickets")).toEqual({});
      } finally {
        rmSync(legacyDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
