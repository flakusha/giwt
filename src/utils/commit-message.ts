// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Commit-message hygiene gate for `giwt git commit|merge` — rejects the same
 * hallucination classes the .githooks/commit-msg gate rejects, so the gate
 * holds even where hooks are not installed:
 *
 *   1. A literal `\n`/`\t` escape sequence is a model "newline" that is
 *      really two characters — git would store it verbatim in the message.
 *   2. A subject wider than 72 chars breaks the generated .commitlint.yaml
 *      subject-max-length rule (the same rule git log --oneline assumes).
 *
 * Validation, not sanitation: the caller must refuse the invocation and let
 * the author re-issue a clean message.
 */

/** Maximum subject length (first line), matching the generated commitlint rule. */
export const SUBJECT_MAX_LENGTH = 72;

/** Non-null when the message text violates the gate — the reason to surface. */
export function validateCommitMessageText(text: string): string | null {
  if (/\\[nt]/.test(text)) {
    return "message contains a literal \\n/\\t escape sequence — use a real newline";
  }
  const subject = text.split("\n", 1)[0] ?? "";
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return `subject is ${subject.length} chars (max ${SUBJECT_MAX_LENGTH}) — wrap the detail into the body`;
  }
  return null;
}
