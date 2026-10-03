// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { SUBJECT_MAX_LENGTH, validateCommitMessageText } from "./commit-message";

describe("validateCommitMessageText", () => {
  test("accepts a normal message with real newlines", () => {
    expect(validateCommitMessageText("feat: x\n\nbody text\n")).toBeNull();
  });

  test("rejects a literal backslash-n sequence", () => {
    const reason = validateCommitMessageText("feat: x\\n\\nbody");
    expect(reason).toContain("escape sequence");
  });

  test("rejects a literal backslash-t sequence", () => {
    expect(validateCommitMessageText("feat: x\\tbody")).toContain("escape sequence");
  });

  test("rejects a subject over the limit and accepts one at the limit", () => {
    const atLimit = "x".repeat(SUBJECT_MAX_LENGTH);
    expect(validateCommitMessageText(atLimit)).toBeNull();
    const overLimit = `feat: ${"x".repeat(SUBJECT_MAX_LENGTH)}`;
    expect(validateCommitMessageText(overLimit)).toContain(`max ${SUBJECT_MAX_LENGTH}`);
  });

  test("body width is not validated — only the first line", () => {
    const wideBody = `feat: x\n\n${"y".repeat(200)}\n`;
    expect(validateCommitMessageText(wideBody)).toBeNull();
  });
});
