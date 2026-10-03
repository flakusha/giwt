// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Per-subcommand argument predicates for `giwt git` — the flag-level
 * checks that separate the safe shapes of a mutating subcommand from the
 * destructive/editor/credential ones (seeded from the cc-safety-net git
 * blocklist). Each predicate returns a block reason or null.
 */

import { configPredicate } from "./config-predicate";
import { hasForceShort, interactiveFlag, type PredicateCtx } from "./predicate-helpers";

export type { PredicateCtx };

/** `git checkout` — allow branch switches, block working-tree restores. */
function checkoutPredicate(args: readonly string[], ctx: PredicateCtx): string | null {
  if (args.includes("--")) {
    return "checkout with a path restore (`--`) discards uncommitted changes";
  }
  const interactive = interactiveFlag(args);
  if (interactive !== null) return interactive;
  if (
    args.includes("--pathspec-from-file") || args.some((a) => a.startsWith("--pathspec-from-file="))
  ) {
    return "checkout --pathspec-from-file can overwrite many files at once";
  }
  if (args.some(hasForceShort) || args.includes("--force")) {
    return "checkout --force discards uncommitted changes";
  }
  const operands = args.filter((a) => !a.startsWith("-"));
  if (operands.length > 1) {
    return "checkout <ref> <path> may overwrite working-tree paths — use giwt git switch or checkout -b";
  }
  const only = operands[0];
  if (only !== undefined && isPathLike(only, ctx)) {
    return `checkout '${only}' restores a path and discards its uncommitted changes — use giwt git switch`;
  }
  return null;
}

function isPathLike(operand: string, ctx: PredicateCtx): boolean {
  if (
    operand === "." || operand === ".." || operand.startsWith("./")
    || operand.startsWith("../") || operand.startsWith("/") || operand.endsWith("/")
    || operand.includes(":") || /[*?[]/.test(operand)
  ) return true;
  return ctx.pathExists(operand);
}

/** `git switch` — allow branch creation, block force/discarding switches. */
function switchPredicate(args: readonly string[]): string | null {
  if (args.includes("--discard-changes")) {
    return "switch --discard-changes discards uncommitted changes";
  }
  if (args.includes("--force") || args.some(hasForceShort)) {
    return "switch --force discards uncommitted changes";
  }
  return null;
}

/** `git restore` — only `--staged` (unstage) shapes are recoverable. */
function restorePredicate(args: readonly string[]): string | null {
  const staged = args.includes("--staged") || args.includes("-S")
    || args.some((a) => a.startsWith("--staged="));
  const worktree = args.includes("--worktree") || args.includes("-W");
  if (
    staged && !worktree && !args.includes("--source")
    && !args.some((a) => a.startsWith("--source="))
  ) return null;
  return "restore overwrites working-tree files permanently — only `--staged` (index-only) forms pass";
}

/** `git push` — block plain force and `+ref` refspecs. */
function pushPredicate(args: readonly string[]): string | null {
  if (args.includes("--force") || args.includes("-f")) {
    return "push --force destroys remote history — use --force-with-lease";
  }
  const lease = args.some((a) => a === "--force-with-lease" || a.startsWith("--force-with-lease="));
  if (!lease && args.some((a) => !a.startsWith("-") && a.includes(":") && a.startsWith("+"))) {
    return "push refspec '+<ref>' is a force push — use --force-with-lease";
  }
  return null;
}

/** `git reset` — block modes that discard the working tree. */
function resetPredicate(args: readonly string[]): string | null {
  if (args.includes("--hard")) return "reset --hard destroys all uncommitted changes";
  if (args.includes("--merge")) return "reset --merge can lose uncommitted changes";
  return null;
}

/** `git commit` — require an explicit message source (no editor), no -e. */
function commitPredicate(args: readonly string[]): string | null {
  if (args.includes("--allow-empty-message")) {
    return "commit --allow-empty-message skips the message gate";
  }
  if (args.includes("--author") || args.some((a) => a.startsWith("--author="))) {
    return "commit --author overrides the pinned repo identity";
  }
  if (args.includes("-e") || args.includes("--edit")) return "commit --edit opens an editor";
  if (args.includes("-p") || args.includes("--patch") || args.includes("--interactive")) {
    return "interactive commit opens an editor";
  }
  const source = args.some((a) =>
    a === "-m" || a === "--message" || a.startsWith("-m") && a.length > 2
    || a.startsWith("--message=") || a === "-F" || a === "--file" || a === "-F="
    || a.startsWith("--file=") || /^-F./.test(a) || a === "-C" || /^-C./.test(a)
    || a.startsWith("--reuse-message=") || a.startsWith("--fixup=") || a.startsWith("--squash=")
    || a === "--fixup" || a === "--squash"
  );
  if (source) return null;
  const amendNoEdit = args.includes("--amend") && args.includes("--no-edit");
  if (amendNoEdit) return null;
  return "commit without -m/-F/--amend --no-edit opens an interactive editor";
}

/** `git merge` — block aborts (discards conflict resolutions). */
function mergePredicate(args: readonly string[]): string | null {
  if (args.includes("--abort")) return "merge --abort discards conflict resolutions";
  return null;
}

/** `git rebase` — block aborts and interactive editor mode. */
function rebasePredicate(args: readonly string[]): string | null {
  if (args.includes("--abort")) return "rebase --abort discards conflict resolutions";
  if (args.includes("-i") || args.includes("--interactive")) {
    return "interactive rebase opens an editor";
  }
  return null;
}

/** `git cherry-pick` / `revert` — block aborts. */
function abortBlocker(cmd: string) {
  return (args: readonly string[]): string | null =>
    args.includes("--abort") ? `${cmd} --abort discards conflict resolutions` : null;
}

/** `git rm` — block force; --cached/-n stay allowed. */
function rmPredicate(args: readonly string[]): string | null {
  if (args.includes("--force") || args.some(hasForceShort)) {
    return "rm --force removes files git would refuse to delete";
  }
  return null;
}

/** `git stash` — drop/clear destroy stashes; -p is interactive. */
function stashPredicate(args: readonly string[]): string | null {
  const verb = args.find((a) => !a.startsWith("-"));
  if (verb === "drop") return "stash drop permanently deletes stashed changes";
  if (verb === "clear") return "stash clear deletes ALL stashed changes";
  return interactiveFlag(args);
}

/** `git reflog` — expire/delete destroy recovery history. */
function reflogPredicate(args: readonly string[]): string | null {
  const verb = args.find((a) => !a.startsWith("-"));
  if (verb === "expire" || verb === "delete") {
    return "reflog expire/delete destroys recovery history";
  }
  return null;
}

/** `git branch` — -D and force-deletes skip the merge check. */
function branchPredicate(args: readonly string[]): string | null {
  if (args.some((a) => /^-[a-zA-Z]*D/.test(a))) {
    return "branch -D force-deletes without the merge check";
  }
  const deleteFlag = args.includes("-d") || args.includes("--delete")
    || args.some((a) => /^-[a-zA-Z]*d/.test(a));
  if (deleteFlag && (args.includes("--force") || args.some(hasForceShort))) {
    return "branch -d --force force-deletes without the merge check";
  }
  return null;
}

/** `git tag` — tag deletion is permanent. */
function tagPredicate(args: readonly string[]): string | null {
  if (args.includes("--delete") || args.some((a) => /^-[a-zA-Z]*d/.test(a))) {
    return "tag -d permanently deletes the tag";
  }
  return null;
}

/** Shared `-d`/`--delete` blocker (update-ref, symbolic-ref, replace). */
function deleteBlocker(cmd: string) {
  return (args: readonly string[]): string | null =>
    args.includes("-d") || args.includes("--delete")
      ? `${cmd} -d deletes refs permanently`
      : null;
}

/** `git worktree` — remove --force skips the dirty-tree check. */
function worktreePredicate(args: readonly string[]): string | null {
  const verb = args.find((a) => !a.startsWith("-"));
  if (
    verb === "remove"
    && (args.includes("--force") || args.includes("-f") || args.some(hasForceShort))
  ) return "worktree remove --force discards uncommitted worktree changes";
  return null;
}

/** `git add` — interactive modes open a TTY loop. */
function addPredicate(args: readonly string[]): string | null {
  if (
    args.includes("-p") || args.includes("--patch") || args.includes("--interactive")
    || args.includes("-i") || args.includes("-e") || args.includes("--edit")
  ) return "interactive add opens an editor/TTY loop";
  return null;
}

/** `git bisect` — `run` executes an arbitrary command per step. */
function bisectPredicate(args: readonly string[]): string | null {
  const verb = args.find((a) => !a.startsWith("-"));
  if (verb === "run") return "bisect run executes an arbitrary command";
  return null;
}

/** Subcommand → predicate. Missing entry = no flag check beyond global scans. */
export const PREDICATES: Record<
  string,
  (args: readonly string[], ctx: PredicateCtx) => string | null
> = {
  checkout: checkoutPredicate,
  switch: switchPredicate,
  restore: restorePredicate,
  push: pushPredicate,
  reset: resetPredicate,
  commit: commitPredicate,
  merge: mergePredicate,
  rebase: rebasePredicate,
  "cherry-pick": abortBlocker("cherry-pick"),
  revert: abortBlocker("revert"),
  rm: rmPredicate,
  stash: stashPredicate,
  reflog: reflogPredicate,
  branch: branchPredicate,
  tag: tagPredicate,
  "update-ref": deleteBlocker("update-ref"),
  "symbolic-ref": deleteBlocker("symbolic-ref"),
  replace: deleteBlocker("replace"),
  worktree: worktreePredicate,
  add: addPredicate,
  bisect: bisectPredicate,
  config: configPredicate,
};
