// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Git hooks generator.
 *
 * Emits three executable scripts under .githooks/ plus an .install.sh
 * helper. Mirrors loop-lore's hook suite but reads AGENT_GPG_EMAIL from
 * .credentials.env at runtime so generated hooks are project-agnostic.
 *
 *   - pre-commit            — format + lint + SPDX + check-report freshness
 *   - pre-push              — block agent pushes on protected branches; tag validation
 *   - prepare-commit-msg    — enforce Conventional Commits via commit-check
 *   - .install.sh           — git config core.hooksPath + chmod +x
 *
 * String.raw with backslash-escaped dollar braces preserves bash variable
 * syntax like \${AGENT_GPG_EMAIL:-} or \${VAR#PREFIX} without TypeScript
 * treating them as template-literal expressions.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const PRE_COMMIT = String.raw`#!/bin/sh
# Pre-commit hook — staged files only (fast).
#
# Checks staged TS / config / md / shell files for formatting + lint
# and verifies SPDX headers on TS. Non-fatal warnings for the rest.
# Full gate (typecheck + tests) is 'bun run check'; hook only runs when
# staged files exist.
#
# Install: git config core.hooksPath .githooks && chmod +x .githooks/pre-commit

set -u

failures=0
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
cd "\$REPO_TOP" || exit 1

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
cyan() { printf '\033[36m%s\033[0m\n' "$*"; }

echo ""
echo "=== pre-commit ==="
echo ""

STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.tsx?$' || true)
STAGED_CFG=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(json|toml|md)$' || true)
STAGED_SH=$(git diff --cached --name-only --diff-filter=ACM | grep -E '(\.sh$|(^|/)\.githooks/)' || true)

if [ -z "$STAGED_TS" ] && [ -z "$STAGED_CFG" ] && [ -z "$STAGED_SH" ]; then
  yellow "No staged TS/config/md/shell files to check — skipping"
  exit 0
fi

echo "Staged files:"
[ -n "$STAGED_TS" ] && echo "  TS: $(echo "$STAGED_TS" | wc -l | tr -d ' ')"
[ -n "$STAGED_CFG" ] && echo "  config: $(echo "$STAGED_CFG" | wc -l | tr -d ' ')"
echo ""

# -- Step 1: format staged files (dprint) --
echo "--- Step 1: dprint fmt --allow-no-files --staged -- --" >&2 || true
if command -v dprint >/dev/null 2>&1; then
  FORMAT_FILES=""
  [ -n "$STAGED_TS" ] && FORMAT_FILES="$FORMAT_FILES $STAGED_TS"
  [ -n "$STAGED_CFG" ] && FORMAT_FILES="$FORMAT_FILES $STAGED_CFG"
  if [ -n "$FORMAT_FILES" ]; then
    if echo "$FORMAT_FILES" | xargs dprint fmt --allow-no-files 2>/dev/null; then
      green "PASS: formatting"
      echo "$FORMAT_FILES" | xargs git add 2>/dev/null
    else
      red "FAIL: formatting"
      failures=$((failures + 1))
    fi
  fi
fi

# -- Step 2: lint staged TS --
if [ -n "$STAGED_TS" ]; then
  echo ""
  echo "--- Step 2: oxlint ---"
  if command -v oxlint >/dev/null 2>&1; then
    if echo "$STAGED_TS" | xargs oxlint --no-error-on-unmatched-pattern 2>/dev/null; then
      green "PASS: lint"
    else
      red "FAIL: lint"
      failures=$((failures + 1))
    fi
  fi
fi

# -- Step 3: SPDX headers on staged TS (warn-only) --
if [ -n "$STAGED_TS" ]; then
  echo ""
  echo "--- Step 3: SPDX headers ---"
  MISSING_SPDX=$(echo "$STAGED_TS" | xargs grep -L 'SPDX-License-Identifier' 2>/dev/null || true)
  if [ -z "$MISSING_SPDX" ]; then
    green "  SPDX headers OK"
  else
    yellow "  missing SPDX-License-Identifier:"
    echo "$MISSING_SPDX" | sed 's/^/    /'
  fi
fi

# -- Step 4: check-report freshness --
echo ""
echo "--- Step 4: check-report freshness ---"
REPORT_FILE="\$REPO_TOP/.tmp/check-report.json"
if [ -f "$REPORT_FILE" ]; then
  REPORT_HEAD=$(grep -o '"gitHead"[[:space:]]*:[[:space:]]*"[^"]*"' "$REPORT_FILE" 2>/dev/null | head -1 | sed 's/.*"gitHead"[[:space:]]*:[[:space:]]*\([^]]*\).*/\1/')
  CURRENT_HEAD=$(git rev-parse --short HEAD 2>/dev/null || true)
  if [ -n "$REPORT_HEAD" ] && [ -n "$CURRENT_HEAD" ]; then
    if [ "$REPORT_HEAD" != "$CURRENT_HEAD" ]; then
      yellow "  check report stale — run 'bun run check' to refresh"
    else
      green "  check report current ($CURRENT_HEAD)"
    fi
  fi
else
  yellow "  no check report — run 'bun run check' to generate one"
fi

echo ""
if [ "$failures" -gt 0 ]; then
  red "=== $failures check(s) failed — commit blocked ==="
  red "To commit without checks: git commit --no-verify"
  exit 1
fi
green "=== Staged files OK ==="
exit 0
`;

const PRE_PUSH = String.raw`#!/bin/sh
# Pre-push hook
# 1. Block agent pushes (Co-authored-by trailer detection)
# 2. Validate tag pushes match package.json version
#
# Reads AGENT_GPG_EMAIL from .credentials.env at runtime.
# Override: git push --no-verify (human approval required)

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
CRED_FILE="\$REPO_ROOT/.credentials.env"
PKG_FILE="\$REPO_ROOT/package.json"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# --- Agent push detection ---
detect_agent_push() {
  [ -f "$CRED_FILE" ] || return 0
  # shellcheck source=/dev/null
  . "$CRED_FILE"
  local agent_email="\${AGENT_GPG_EMAIL:-}"
  [ -n "$agent_email" ] || return 0

  local protected="refs/heads/(main|master|dev|stg)$"

  while read local_ref local_sha remote_ref remote_sha; do
    [ "$local_sha" != "0000000000000000000000000000000000000000" ] || continue
    [ "$local_ref" =~ $protected ] || continue

    local range
    if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
      range="$local_sha"
    else
      range="$remote_sha..$local_sha"
    fi

    local agent_commits
    agent_commits=$(git log "$range" --format='%b' | grep -c "Co-authored-by:.*$agent_email" || true)

    if [ "$agent_commits" -gt 0 ]; then
      red ""
      red "PUSH BLOCKED: Agent commits detected in $local_ref"
      red ""
      red "   Override (human approval required): git push --no-verify"
      red ""
      exit 1
    fi
  done
}

# --- Tag version validation ---
validate_tag_push() {
  [ -f "$PKG_FILE" ] || return 0
  local pkg_version
  pkg_version=$(grep -o '"version": *"[^"]*"' "$PKG_FILE" | head -1 | cut -d'"' -f4)
  [ -n "$pkg_version" ] || return 0

  while read local_ref local_sha remote_ref remote_sha; do
    [ "$local_ref" = refs/tags/* ] || continue
    local tag_name="\${local_ref#refs/tags/}"

    if [ "$tag_name" =~ -(dev|alpha|beta|rc) ]; then
      green "  OK Tag '$tag_name' is pre-release — version drift allowed"
      continue
    fi

    local expected_tag="v$pkg_version"
    if [ "$tag_name" != "$expected_tag" ]; then
      red ""
      red "PUSH BLOCKED: Tag '$tag_name' doesn't match package.json version"
      red "   Expected: $expected_tag (package.json: $pkg_version)"
      red "   Override (human approval required): git push --no-verify"
      red ""
      exit 1
    fi
    green "  OK Tag '$tag_name' matches package.json version $pkg_version"
  done
}

echo ""
echo "=== pre-push checks ==="
echo ""

detect_agent_push
validate_tag_push

green "=== Pre-push checks passed ==="
exit 0
`;

const PREPARE_COMMIT_MSG = String.raw`#!/bin/bash
# Validate commit message format before commit is created.
# Skipped for template / merge / squash sources.
#
# Install: git config core.hooksPath .githooks && chmod +x .githooks/prepare-commit-msg

COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="$2"

if [ -z "$COMMIT_SOURCE" ] || [ "$COMMIT_SOURCE" = "template" ] || [ "$COMMIT_SOURCE" = "merge" ] || [ "$COMMIT_SOURCE" = "squash" ]; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
CHECK_SCRIPT="\$REPO_ROOT/scripts/commit-check.ts"

if [ -f "$CHECK_SCRIPT" ] && command -v bun >/dev/null 2>&1; then
  if bun run "$CHECK_SCRIPT" < "$COMMIT_MSG_FILE" 2>/dev/null; then
    exit 0
  else
    echo "Invalid commit message format. Expected: type(scope): subject" >&2
    echo "Types: feat, fix, refactor, chore, test, docs, style, perf, build, ci, revert" >&2
    echo "Example: feat(core): add SSE streaming endpoint" >&2
    echo "" >&2
    echo "Fix your commit message or use --no-verify to skip." >&2
    exit 1
  fi
fi

exit 0
`;

const INSTALL_SH = String.raw`#!/bin/sh
# Install .githooks/ as the project's git hooksPath.
# Idempotent — safe to re-run.

set -e
REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_DIR="\$REPO_ROOT/.githooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "ERROR: $HOOKS_DIR not found" >&2
  exit 1
fi

git config core.hooksPath "$HOOKS_DIR"
chmod +x "$HOOKS_DIR"/*

echo "OK core.hooksPath set to $HOOKS_DIR"
echo "OK hooks executable"
`;

export function generateHooks(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    { path: ".githooks/pre-commit", content: PRE_COMMIT, executable: true },
    { path: ".githooks/pre-push", content: PRE_PUSH, executable: true },
    { path: ".githooks/prepare-commit-msg", content: PREPARE_COMMIT_MSG, executable: true },
    { path: ".githooks/.install.sh", content: INSTALL_SH, executable: true },
  ];
}
