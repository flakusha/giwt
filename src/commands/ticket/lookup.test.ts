// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { expect, test } from "bun:test";
import type { IndexEntry } from "../../tickets/sync-ticket";
import { issueHashFor } from "./lookup";

function entry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    hash: "pending",
    extid: "TASK-PROBE",
    type: "TASK",
    title: "probe",
    label: "task",
    priority: "medium",
    epic: "",
    project: "",
    tags: [],
    source: ".plan/tickets/task-probe.md",
    ...overrides,
  };
}

test("issueHashFor prefers the explicit git_issue link over a legacy commit hash", () => {
  expect(issueHashFor("/nonexistent", entry({ hash: "1234567", git_issue: "abcdef0" }))).toBe(
    "abcdef0",
  );
});

test("issueHashFor falls back to hash when git_issue is absent", () => {
  expect(issueHashFor("/nonexistent", entry({ hash: "1234567" }))).toBe("1234567");
});
