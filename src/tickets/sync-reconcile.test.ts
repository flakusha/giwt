// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Coverage for the argv-form, hex-guarded git object check. */

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { gitObjectExists } from "./sync-reconcile";

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

test("gitObjectExists resolves a real commit and rejects unknown hashes", () => {
  expect(gitObjectExists(head)).toBe(true);
  expect(gitObjectExists(head.slice(0, 7))).toBe(true);
  expect(gitObjectExists("0".repeat(40))).toBe(false);
});

test("gitObjectExists refuses non-hex refs before any spawn", () => {
  for (
    const ref of [
      "HEAD",
      "not-a-hash",
      "012345",
      "0".repeat(41),
      "0123456^{commit}; echo injected",
      "0123456; touch /tmp/giwt-injected",
    ]
  ) {
    expect(gitObjectExists(ref)).toBe(false);
  }
});
