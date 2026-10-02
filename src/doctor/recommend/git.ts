// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Git-hygiene recommendations for `giwt doctor`.
 */

import type { RecommendFacts, ToolRecommendation } from "./types.ts";

export function recommendGit(f: RecommendFacts): ToolRecommendation[] {
  const { report, has } = f;
  const out: ToolRecommendation[] = [];

  // ── Git hygiene ──────────────────────────────────────────────

  out.push({
    id: "commitlint",
    category: "git",
    status: "add",
    reason: "Conventional Commits — install .commitlint.yaml + prepare-commit-msg hook",
    configWritable: true,
  });

  out.push({
    id: "husky",
    category: "git",
    status: has("husky") ? "already-present" : "skip",
    reason: has("husky")
      ? ".husky/ present"
      : ".githooks/ is the simpler alternative — pick husky only if you need npm-distributed hooks",
    configWritable: false,
  });

  out.push({
    id: "lefthook",
    category: "git",
    status: has("lefthook") ? "already-present" : "skip",
    reason: has("lefthook")
      ? "lefthook config present"
      : ".githooks/ + git config core.hooksPath is simpler for bun/TS projects",
    configWritable: false,
  });

  out.push({
    id: "preCommit",
    category: "git",
    status: has("preCommit") ? "already-present" : "add",
    reason: has("preCommit")
      ? "pre-commit hook present"
      : report.git.isGitRepo
      ? "typecheck + format + lint on staged files"
      : "no git repo — skipped",
    configWritable: !has("preCommit") && report.git.isGitRepo,
  });

  out.push({
    id: "postCommit",
    category: "git",
    status: has("postCommit") ? "already-present" : "skip",
    reason: has("postCommit")
      ? "post-commit hook present"
      : "agent ledger captures commit outcome — noop post-commit is fine",
    configWritable: false,
  });

  const agentIdentity = report.git.agentEmail !== null;
  out.push({
    id: "prePush",
    category: "git",
    status: has("prePush")
      ? "already-present"
      : report.git.isGitRepo && agentIdentity
      ? "add"
      : "skip",
    reason: has("prePush")
      ? "pre-push hook present"
      : report.git.isGitRepo && agentIdentity
      ? "agent identity (.credentials.env) present — block agent Co-authored-by trailers on protected branches"
      : report.git.isGitRepo
      ? "no .credentials.env — push protection skipped (would block every commit)"
      : "no git repo",
    configWritable: !has("prePush") && report.git.isGitRepo && agentIdentity,
  });

  out.push({
    id: "pushProtection",
    category: "git",
    status: report.git.agentEmail ? "add" : "skip",
    reason: report.git.agentEmail
      ? "block Co-authored-by: $AGENT_GPG_EMAIL on refs/heads/(main|master|dev|stg)"
      : "no .credentials.env — skipping",
    configWritable: false,
  });

  out.push({
    id: "linearHistory",
    category: "git",
    status: report.git.hasLinearHistoryConfig ? "already-present" : "add",
    reason: report.git.hasLinearHistoryConfig
      ? "git config (pull.ff=only / branch.*.rebase=true) already set"
      : "configure pull.ff=only and branch.<x>.rebase=true for linear history",
    configWritable: !report.git.hasLinearHistoryConfig && report.git.isGitRepo,
  });

  if (report.git.isGitRepo) {
    out.push({
      id: "actionlint",
      category: "git",
      status: has("workflows") ? "add" : "skip",
      reason: has("workflows")
        ? "GitHub Actions workflow lint — catches typos in workflow YAML"
        : "no .github/workflows — nothing to lint",
      configWritable: has("workflows"),
    });
  }

  out.push({
    id: "gitignore",
    category: "git",
    status: "add",
    reason: "baseline .gitignore for the detected languages (node_modules, target/, dist/, ...)",
    configWritable: true,
  });

  out.push({
    id: "editorconfig",
    category: "git",
    status: "add",
    reason: ".editorconfig normalizes whitespace/indent across editors",
    configWritable: true,
  });

  return out;
}
