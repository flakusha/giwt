// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Commit-message input extraction shared by `commit` and `commit-wt`.
 *
 * Supports `-F <path>` / `--message-file <path>` (use `-` for stdin) and
 * piped stdin, so multi-line messages reach `git commit -m` without
 * shell-argument mangling. Positional args are returned with the message
 * flags removed so callers keep their own positional parsing.
 */

import { log } from "./output";

export interface MessageInput {
  /** Positional args with `-F`/`--message-file` and its value removed. */
  rest: string[];
  /** Message from `-F`/stdin, or null when no message input was given. */
  message: string | null;
}

/**
 * Scan `args` for message-file input.
 *
 * Resolution order: explicit `-F <path>` / `--message-file <path>` (path `-`
 * reads stdin); otherwise, when no positional args remain and stdin is a
 * pipe, stdin is consumed as the message. Errors and exits on a missing or
 * unreadable message file.
 *
 * @param args - raw command arguments
 * @returns remaining positional args and the resolved message (or null)
 */
export async function extractMessageInput(args: string[]): Promise<MessageInput> {
  const rest: string[] = [];
  let filePath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "-F" || arg === "--message-file") {
      const value = args[++i];
      if (value === undefined) {
        log("error", `${arg} requires a file path (or "-" for stdin)`);
        process.exit(1);
      }
      filePath = value;
    } else {
      rest.push(arg);
    }
  }

  if (filePath !== null) {
    if (filePath === "-") {
      const stdinText = (await Bun.stdin.text()).replace(/\r\n/g, "\n");
      if (stdinText.trim().length === 0) {
        log("error", `-F - read from stdin, but stdin was empty`);
        process.exit(1);
      }
      return { message: stdinText, rest };
    }
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      log("error", `message file not found: ${filePath}`);
      process.exit(1);
    }
    const fileText = (await file.text()).replace(/\r\n/g, "\n");
    if (fileText.trim().length === 0) {
      log("error", `message file is empty: ${filePath}`);
      process.exit(1);
    }
    return { message: fileText, rest };
  }

  if (rest.length === 0 && !process.stdin.isTTY) {
    const text = (await Bun.stdin.text()).replace(/\r\n/g, "\n");
    if (text.trim().length === 0) {
      log("error", "commit message required — stdin was empty and no -F given");
      process.exit(1);
    }
    return { message: text, rest };
  }

  return { message: null, rest };
}

/**
 * Conventional-commits subject regex — matches `type(scope): subject` and
 * bare `type: subject`. Rejects leading whitespace, missing colon, and
 * uppercase type. The repo standard (`.agents/skills/commit-message/SKILL.md`)
 * calls out this shape explicitly; validating here makes the check visible
 * to agent commits the same way it would be in a CI lint.
 */
const SUBJECT_RE = /^[a-z]+(\([^)]+\))?(!)?: .{1,72}$/;

export interface MessageValidation {
  ok: boolean;
  reason?: string;
  subject?: string;
  bodyLines?: number;
}

/**
 * Lint a multi-line message for the project's commit conventions.
 * Returns `{ ok: true, subject, bodyLines }` on success, or `{ ok: false,
 * reason }` describing the first violation.
 *
 * Rules (intentionally minimal — see commit-message SKILL for the full set):
 *   - Subject line non-empty, no trailing period
 *   - Subject matches `type(scope)?: description`
 *   - Subject length <= 72 chars
 *   - Blank line between subject and body
 *
 * NOT enforced here: body-line wrap (project leaves that to the author),
 * ticket refs in body (skill encourages but doesn't require), Co-Authored-By
 * shape (only finalize adds that, downstream of this validator).
 */
export function validateMessage(message: string | null): MessageValidation {
  if (message === null) return { ok: false, reason: "no commit message provided" };
  // Strip leading BOM + leading whitespace lines so a CLI "banner" before
  // the subject doesn't fail validation.
  const normalised = message.replace(/^\uFEFF/, "");
  if (normalised.trim().length === 0) return { ok: false, reason: "commit message is empty" };
  const lines = normalised.split("\n");
  const subject = lines[0]!.trimEnd();
  if (subject.length === 0) return { ok: false, reason: "first line (subject) is blank" };
  if (subject.endsWith(".")) return { ok: false, reason: "subject must not end with a period" };
  if (subject.length > 72) {
    return { ok: false, reason: `subject length ${subject.length} exceeds 72 chars` };
  }
  if (!SUBJECT_RE.test(subject)) {
    return {
      ok: false,
      reason:
        `subject must match '<type>[(scope)][!]: <description>' (lowercase type, no trailing period); got: "${subject}"`,
    };
  }
  // Body (if present) must be separated from the subject by a blank line.
  const hasBody = lines.slice(1).some((l) => l.length > 0);
  if (hasBody && lines[1] !== "") {
    return { ok: false, reason: "body must be separated from subject by a blank line" };
  }
  return { ok: true, subject, bodyLines: lines.slice(2).length };
}
