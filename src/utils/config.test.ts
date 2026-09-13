// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for linkWorktreeCredentials: root `.credentials.env` is symlinked
 * into fresh worktrees (parity between `new` and `create`), idempotently.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkWorktreeCredentials } from "./config";

describe("linkWorktreeCredentials", () => {
  it("symlinks root credentials into the worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "ll-creds-root-"));
    const wt = mkdtempSync(join(tmpdir(), "ll-creds-wt-"));
    try {
      writeFileSync(join(root, ".credentials.env"), "AGENT_GPG_KEY_ID=test");
      linkWorktreeCredentials(root, wt);
      expect(readlinkSync(join(wt, ".credentials.env"))).toBe(join(root, ".credentials.env"));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("skips silently when root has no credentials file", () => {
    const root = mkdtempSync(join(tmpdir(), "ll-creds-noroot-"));
    const wt = mkdtempSync(join(tmpdir(), "ll-creds-nowt-"));
    try {
      linkWorktreeCredentials(root, wt);
      expect(existsSync(join(wt, ".credentials.env"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("keeps an existing worktree credentials file", () => {
    const root = mkdtempSync(join(tmpdir(), "ll-creds-keep-root-"));
    const wt = mkdtempSync(join(tmpdir(), "ll-creds-keep-wt-"));
    try {
      writeFileSync(join(root, ".credentials.env"), "AGENT_GPG_KEY_ID=root");
      const wtCreds = join(wt, ".credentials.env");
      symlinkSync(join(root, ".credentials.env"), wtCreds);
      linkWorktreeCredentials(root, wt);
      expect(readlinkSync(wtCreds)).toBe(join(root, ".credentials.env"));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });
});
