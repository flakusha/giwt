<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# Plan Interconnect

Derived producer/consumer/sibling graph over `.plan/` tickets, epics, and the
src/ paths they own. Regenerate with `giwt plan links --write`; freshness is
gated by `giwt plan links --check` / `giwt plan validate`. No timestamps —
output is byte-identical for identical inputs.

- tickets: 161
- epics: 0
- src paths owned: 130
- edges: produces 246, consumes 0, sibling 230, owns 0, related 0

## Shared src hubs

| src path | owners |
| --- | --- |
| `src/cli-registry.ts` | `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-`, `FEAT-advisory-giwt-lock-status-command` |
| `src/cli-usage.ts` | `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-`, `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p`, `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch`, `FEAT-advisory-giwt-lock-status-command`, `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename`, `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` |
| `src/cli.ts` | `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-`, `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c`, `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio`, `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote`, `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link`, `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` |
| `src/commands/abort.test.ts` | `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-`, `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` |
| `src/commands/abort.ts` | `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-`, `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` |
| `src/commands/commit-wt.ts` | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p`, `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla`, `FEAT-one-line-outcome-contract-for-direct-cli-calls` |
| `src/commands/finalize.test.ts` | `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c`, `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as`, `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` |
| `src/commands/finalize.ts` | `BUG-finalize-check-failure-report-never-names-failed-gates-check`, `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c`, `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c`, `FIX-add-jitter-to-the-finalize-lock-retry-backoff`, `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the`, `FIX-finalize-does-not-surface-gate-results-on-failure`, `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas`, `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` |
| `src/commands/finalize/checks.ts` | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |
| `src/commands/finalize/gates.ts` | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `BUG-squash-commit-failure-strands-staged-changes-in-dev` |
| `src/commands/finalize/merge-exec.ts` | `BUG-finalize-direct-merge-allows-fast-forward`, `BUG-squash-commit-failure-strands-staged-changes-in-dev` |
| `src/commands/finalize/merge.ts` | `BUG-finalize-step1-doesnt-check-untracked-files`, `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` |
| `src/commands/finalize/run.ts` | `BUG-finalize-alreadymerged-check-is-incomplete`, `BUG-finalize-step1-doesnt-check-untracked-files`, `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename`, `FEAT-one-line-outcome-contract-for-direct-cli-calls` |
| `src/commands/finalize/teardown.ts` | `BUG-finalize-teardown-branch-deletion-fallback-is-silent`, `BUG-finalize-teardown-doesnt-verify-worktree-exists`, `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal`, `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` |
| `src/commands/git.ts` | `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster`, `FEAT-giwt-git-passthrough-command-for-harness-rerouting`, `FEAT-rtk-minimal-context-output-for-giwt-git` |
| `src/commands/plan.ts` | `FEAT-feature-matrix-generation-from-ticket-index`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` |
| `src/commands/rebase.test.ts` | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re`, `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch`, `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` |
| `src/commands/rebase.ts` | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote`, `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re`, `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch`, `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` |
| `src/commands/remove.ts` | `BUG-finalize-teardown-branch-deletion-fallback-is-silent`, `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal`, `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch`, `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as`, `BUG-remove-path-auto-detection-matches-main-worktree-registratio`, `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` |
| `src/commands/runs.ts` | `FEAT-runs-json-diet-default-projection-and-query-filters`, `FIX-referenced-artifacts-must-outlive-the-console` |
| `src/commands/scoped-reconcile.ts` | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping`, `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` |
| `src/commands/sync.ts` | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping`, `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` |
| `src/commands/ticket.test.ts` | `BUG-giwt-ticket-extid-double-prefix-resolved`, `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` |
| `src/commands/ticket.ts` | `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re`, `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` |
| `src/commands/ticket/create.ts` | `BUG-ticket-template-emits-empty-context-acceptance-placeholders-`, `FEAT-reuse-toml-precedence-override-semantics-decision` |
| `src/doctor/check.ts` | `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout`, `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel`, `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c`, `TASK-giwt-doctor-scratchpad-check` |
| `src/git/policy.ts` | `FEAT-git-invocation-allowlist-policy-configurable-lists`, `FEAT-giwt-git-passthrough-command-for-harness-rerouting` |
| `src/git/predicates.ts` | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p`, `BUG-exec-identity-patterns-author-equals-form-only-misses-space-`, `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster`, `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` |
| `src/gpg-unlock.ts` | `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |
| `src/index.ts` | `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-`, `FEAT-runs-json-diet-default-projection-and-query-filters`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit`, `TASK-expose-file-size-check-via-public-api`, `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` |
| `src/plan/code-map.ts` | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping`, `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` |
| `src/plan/feature-matrix.ts` | `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-`, `FEAT-feature-matrix-generation-from-ticket-index`, `FEAT-reuse-toml-precedence-override-semantics-decision` |
| `src/plan/gen-docs.ts` | `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r`, `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` |
| `src/plan/reconcile-conflicts.ts` | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` |
| `src/plan/status-vocab.ts` | `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re`, `BUG-status-vocab-annotation-regex-rejects-nested-parentheses`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-`, `TASK-giwt-plan-validate-status-vocab-gate` |
| `src/plan/validate.ts` | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla`, `FEAT-feature-matrix-generation-from-ticket-index`, `TASK-giwt-plan-validate-status-vocab-gate`, `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis`, `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas`, `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-`, `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` |
| `src/resolve-diff-base.test.ts` | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |
| `src/tickets/sync-index.ts` | `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla`, `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow`, `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` |
| `src/tickets/sync-issues-ops.test.ts` | `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` |
| `src/tickets/sync-parse.ts` | `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing`, `FEAT-plan-links-derive-and-validate-producers-consumers-siblings`, `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` |
| `src/tickets/sync-ticket-index.test.ts` | `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick`, `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` |
| `src/tickets/sync-ticket.ts` | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-`, `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` |
| `src/utils/check-slots.ts` | `FEAT-advisory-giwt-lock-status-command`, `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` |
| `src/utils/config-writes.ts` | `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard`, `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` |
| `src/utils/config.ts` | `BUG-finalize-branchtopath-is-lossy`, `BUG-finalize-findworktree-only-checks-tree-dir`, `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` |
| `src/utils/git.ts` | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p`, `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re`, `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars`, `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` |
| `src/utils/ledger-core.ts` | `FEAT-ledger-core-canonical-module`, `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link`, `FIX-referenced-artifacts-must-outlive-the-console` |
| `src/utils/ledger.ts` | `BUG-ledger-append-race-drops-records-under-concurrent-agents`, `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` |
| `src/utils/output.ts` | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene`, `FEAT-one-line-outcome-contract-for-direct-cli-calls`, `FIX-json-output-polluted-by-run-record-announcement` |
| `src/utils/reuse-toml.ts` | `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-`, `FEAT-reuse-toml-precedence-override-semantics-decision` |
| `src/utils/runlog-types.ts` | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link`, `FIX-referenced-artifacts-must-outlive-the-console` |
| `src/utils/runlog.ts` | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene`, `FEAT-record-per-step-durationms-in-run-events`, `FIX-json-output-polluted-by-run-record-announcement` |
| `src/utils/scratch.ts` | `TASK-giwt-clean-age-size-capped-tmp-pruning`, `TASK-giwt-doctor-scratchpad-check` |
| `src/utils/worktree-root.test.ts` | `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c`, `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |

## Edges

| from | kind | to | via |
| --- | --- | --- | --- |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | produces | `src/commands/abort.test.ts` | - |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | produces | `src/commands/abort.ts` | - |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | produces | `src/commands/abort.test.ts` | - |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | produces | `src/commands/abort.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/cli-registry.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/cli.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/utils/reuse-toml.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/cli-usage.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/commands/commit-wt.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/git/predicates.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/utils/git.ts` | - |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | produces | `src/doctor/check/run.ts` | - |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | produces | `src/doctor/check/tools.ts` | - |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | produces | `src/doctor/check/types.ts` | - |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | produces | `src/git/predicates.ts` | - |
| `BUG-finalize-alreadymerged-check-is-incomplete` | produces | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-branchtopath-is-lossy` | produces | `src/utils/config.ts` | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | produces | `src/commands/finalize.ts` | - |
| `BUG-finalize-direct-merge-allows-fast-forward` | produces | `src/commands/finalize/merge-exec.ts` | - |
| `BUG-finalize-findworktree-only-checks-tree-dir` | produces | `src/utils/config.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | produces | `src/cli.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | produces | `src/commands/finalize.test.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | produces | `src/commands/finalize.ts` | - |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | produces | `src/commands/finalize/staging-sync.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/commands/plan/code-map.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/commands/scoped-reconcile.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/commands/sync.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/plan/code-map.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/plan/validate.ts` | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | produces | `src/commands/finalize/merge.ts` | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | produces | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | produces | `src/commands/finalize/teardown.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | produces | `src/commands/remove.ts` | - |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | produces | `src/commands/finalize/teardown.ts` | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | produces | `src/commands/finalize/teardown.ts` | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | produces | `src/commands/remove.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/commands/scoped-reconcile.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/commands/sync.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/plan/feature-matrix.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/plan/matrix.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/plan/reconcile-conflicts/generated.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/utils/spdx-fix.ts` | - |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | produces | `src/cli.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/create.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/doctor/apply.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/new-branch.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/sign.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/doctor/generators/hooks.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/utils/config-writes.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/utils/config.ts` | - |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | produces | `src/commands/remove.ts` | - |
| `BUG-giwt-ticket-extid-double-prefix-resolved` | produces | `src/commands/ticket.test.ts` | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | produces | `src/commands/ticket.ts` | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | produces | `src/plan/status-vocab.ts` | - |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | produces | `src/utils/ledger.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/commands/doctor.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/tickets/sync-index.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/tickets/sync-issues-ops.test.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/tickets/sync-ticket-index.test.ts` | - |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | produces | `src/plan/gen-docs.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | produces | `src/cli.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | produces | `src/commands/rebase.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | produces | `src/utils/settings.ts` | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | produces | `src/commands/git.ts` | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | produces | `src/git/predicate-helpers.ts` | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | produces | `src/git/predicates.ts` | - |
| `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | produces | `src/git/predicates.ts` | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | produces | `src/commands/rebase.test.ts` | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | produces | `src/commands/rebase.ts` | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | produces | `src/utils/git.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/commands/finalize.test.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/commands/rebase.test.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/commands/rebase.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/plan/reconcile-conflicts.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/resolve-diff-base.test.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | produces | `src/cli-usage.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | produces | `src/commands/rebase.test.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | produces | `src/commands/rebase.ts` | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/commit-wt.ts` | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/commit.ts` | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/finalize/merge.ts` | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/scoped-worktree.ts` | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/plan/reconcile-conflicts/git-io.ts` | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/finalize.test.ts` | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/finalize/teardown.ts` | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/remove.test.ts` | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/remove.ts` | - |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | produces | `src/commands/remove.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize.test.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize/checks.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize/gates.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize/run.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/plan/reconcile-conflicts.test.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/resolve-diff-base.test.ts` | - |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | produces | `src/commands/finalize/gates.ts` | - |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | produces | `src/commands/finalize/merge-exec.ts` | - |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | produces | `src/plan/status-vocab.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/plan/status-vocab.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/plan/validate.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/tickets/sync-index.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/tickets/sync-issues-ops.test.ts` | - |
| `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | produces | `src/tickets/sync-index.ts` | - |
| `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing` | produces | `src/tickets/sync-parse.ts` | - |
| `BUG-ticket-template-emits-empty-context-acceptance-placeholders-` | produces | `src/commands/ticket/create.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/cli-registry.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/cli-usage.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/commands/finalize/lock.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/commands/lock.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/utils/check-slots.ts` | - |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | produces | `src/doctor/check.ts` | - |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | produces | `src/utils/coauthors.ts` | - |
| `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | produces | `src/doctor/check.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | produces | `src/gpg-unlock.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | produces | `src/gpg-unlock` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | produces | `src/index.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/commands/plan.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/plan/feature-matrix.test.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/plan/feature-matrix.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/plan/validate.ts` | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | produces | `src/cli-usage.ts` | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | produces | `src/commands/finalize/run.ts` | - |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | produces | `src/git/policy.ts` | - |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | produces | `src/commands/git.ts` | - |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | produces | `src/git/policy.ts` | - |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | produces | `src/utils/settings-schema.ts` | - |
| `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | produces | `src/utils/git.ts` | - |
| `FEAT-ledger-core-canonical-module` | produces | `src/utils/ledger-core.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/cli.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/commands/ledger.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/ledger-core.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/ledger.test.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/ledger.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/runlog-types.ts` | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | produces | `src/utils/output.ts` | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | produces | `src/utils/runlog.ts` | - |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | produces | `src/commands/commit-wt.ts` | - |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | produces | `src/commands/finalize/run.ts` | - |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | produces | `src/utils/output.ts` | - |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | produces | `src/cli-usage.ts` | - |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | produces | `src/commands/plan/check-links.ts` | - |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | produces | `src/plan/check-links.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/db/schema-core.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/code-map.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/index-projection.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/interconnect.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/src-refs.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/routes/v1/actors-surface.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/tickets/sync-parse.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/cli-usage.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/commands/plan.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/index.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/plan/status-vocab.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/tickets/sync-normalize.ts` | - |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | produces | `src/plan/status-vocab` | - |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | produces | `src/plan` | - |
| `FEAT-record-per-step-durationms-in-run-events` | produces | `src/utils/runlog.ts` | - |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | produces | `src/plan/validate/content-gates.ts` | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/commands/matrix.ts` | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/commands/ticket/create.ts` | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/plan/feature-matrix.ts` | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/utils/reuse-toml.test.ts` | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/utils/reuse-toml.ts` | - |
| `FEAT-rtk-minimal-context-output-for-giwt-git` | produces | `src/commands/git.ts` | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | produces | `src/commands/runs.test.ts` | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | produces | `src/commands/runs.ts` | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | produces | `src/index.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | produces | `src/commands/finalize.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | produces | `src/doctor/check.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | produces | `src/utils/check-slots.ts` | - |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | produces | `src/tickets/sync-index-write.ts` | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/chat/service/branches.ts` | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/frontend/ui.ts` | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/plan/reconcile-conflicts.ts` | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/test-utils/isolate-only.ts` | - |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | produces | `src/commands/finalize.ts` | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | produces | `src/commands/ticket.test.ts` | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | produces | `src/finalize-signal-safety.test.ts` | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | produces | `src/utils/worktree-root.test.ts` | - |
| `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | produces | `src/utils/errors.test.ts` | - |
| `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | produces | `src/utils/worktree-root.test.ts` | - |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | produces | `src/commands/finalize.ts` | - |
| `FIX-finalize-does-not-surface-gate-results-on-failure` | produces | `src/commands/finalize.ts` | - |
| `FIX-giwt-issues-silently-drops-state-so-closed-issues-are-unreac` | produces | `src/commands/issues.ts` | - |
| `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | produces | `src/commands/remove.ts` | - |
| `FIX-json-output-polluted-by-run-record-announcement` | produces | `src/utils/output.ts` | - |
| `FIX-json-output-polluted-by-run-record-announcement` | produces | `src/utils/runlog.ts` | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/commands/runs.ts` | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/utils/ledger-core.ts` | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/utils/runlog-read.ts` | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/utils/runlog-types.ts` | - |
| `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | produces | `src/tickets/sync-parse.ts` | - |
| `INFRA-dispose-two-stale-loop-lore-worktrees` | produces | `src/assets/service/create.ts` | - |
| `TASK-add-author-identity-guard-to-commit-merge-paths` | produces | `src/utils/author-guard.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/finalize-lock-queue.test.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/finalize/checks.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/gpg-unlock.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/gripe.test.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/report.test.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/finalize-args.test.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/finalize-lock-fixture.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/gpg-unlock.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/gripe.test.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/index.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/report.test.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/resolve-diff-base.test.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/testkit/capture.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/testkit/finalize-lock-fixture.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/testkit` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/utils/gpg.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/utils/worktree-root.test.ts` | - |
| `TASK-commit-wt-on-protected-branch-direct-commit-scenario` | produces | `src/commands/commit-protected.test.ts` | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/commands/task/args.ts` | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/commands/worktree-bootstrap.ts` | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/tickets/sync-` | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/utils/args-scan.ts` | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/utils/config-writes.ts` | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/utils/ledger-read.ts` | - |
| `TASK-expose-file-size-check-via-public-api` | produces | `src/index.ts` | - |
| `TASK-expose-file-size-check-via-public-api` | produces | `src/utils/check-file-size.ts` | - |
| `TASK-giwt-clean-age-size-capped-tmp-pruning` | produces | `src/commands/clean.ts` | - |
| `TASK-giwt-clean-age-size-capped-tmp-pruning` | produces | `src/utils/scratch.ts` | - |
| `TASK-giwt-doctor-scratchpad-check` | produces | `src/doctor/check.ts` | - |
| `TASK-giwt-doctor-scratchpad-check` | produces | `src/utils/scratch.ts` | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | produces | `src/plan/status-vocab.ts` | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | produces | `src/plan/validate.ts` | - |
| `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | produces | `src/tickets/sync-index.ts` | - |
| `TASK-migrate-plan-backlog-sync-to-a-top-level-backlog-command` | produces | `src/commands/backlog.ts` | - |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | produces | `src/plan/validate.ts` | - |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | produces | `src/commands/finalize.ts` | - |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | produces | `src/plan/validate.ts` | - |
| `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | produces | `src/commands/finalize.ts` | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/cli.ts` | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/commands/rebase.test.ts` | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/commands/rebase.ts` | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/utils/git.ts` | - |
| `TASK-show-state-resolve-plan-tickets-filename-slugs` | produces | `src/commands/show.ts` | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/index.ts` | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/plan/validate.ts` | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/tickets/sync-reconcile.ts` | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/tickets/sync-ticket-index.test.ts` | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/tickets/sync-ticket.ts` | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/commands/ticket.ts` | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/plan/gen-docs.ts` | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/plan/validate.ts` | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/tickets/sync-ticket.ts` | - |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | `src/commands/abort.test.ts; src/commands/abort.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | `src/cli-usage.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | `src/cli.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | `src/cli.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `src/cli.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/cli-usage.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-advisory-giwt-lock-status-command` | `src/cli-registry.ts; src/cli-usage.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/utils/reuse-toml.ts` |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | `src/git/predicates.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | `src/git/predicates.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | `src/git/predicates.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | `src/utils/git.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/cli-usage.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `src/commands/commit-wt.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-advisory-giwt-lock-status-command` | `src/cli-usage.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | `src/utils/git.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/commit-wt.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/utils/git.ts` |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | sibling | `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | `src/git/predicates.ts` |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | sibling | `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | `src/git/predicates.ts` |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `src/commands/finalize/run.ts` |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize/run.ts` |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/commands/finalize/run.ts` |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-findworktree-only-checks-tree-dir` | `src/utils/config.ts` |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | `src/utils/config.ts` |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | `src/commands/finalize.ts` |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/commands/finalize.ts` |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `src/commands/finalize.ts` |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `src/commands/finalize/merge-exec.ts` |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | `src/utils/config.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | `src/cli.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `src/cli.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `src/commands/finalize.test.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize.test.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize.test.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/commands/finalize.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `src/commands/finalize.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | `src/commands/scoped-reconcile.ts; src/commands/sync.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/plan/validate.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `src/plan/validate.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `src/plan/code-map.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/validate.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `src/commands/finalize/merge.ts` |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize/run.ts` |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/commands/finalize/run.ts` |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `src/commands/finalize/teardown.ts` |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `src/commands/finalize/teardown.ts; src/commands/remove.ts` |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `src/commands/remove.ts` |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize/teardown.ts; src/commands/remove.ts` |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `src/commands/finalize/teardown.ts` |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize/teardown.ts` |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `src/commands/remove.ts` |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize/teardown.ts; src/commands/remove.ts` |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `src/plan/feature-matrix.ts` |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/plan/feature-matrix.ts` |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `src/cli.ts` |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `src/utils/config-writes.ts` |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/remove.ts` |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` |
| `BUG-giwt-ticket-extid-double-prefix-resolved` | sibling | `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | `src/commands/ticket.test.ts` |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | `src/plan/status-vocab.ts` |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/plan/status-vocab.ts` |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/plan/status-vocab.ts` |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts` |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/commands/ticket.ts` |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/utils/ledger.ts` |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/tickets/sync-index.ts; src/tickets/sync-issues-ops.test.ts` |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | `src/tickets/sync-index.ts` |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/tickets/sync-ticket-index.test.ts` |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/gen-docs.ts` |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | `src/commands/rebase.ts` |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `src/commands/rebase.ts` |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/commands/rebase.ts` |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts; src/commands/rebase.ts` |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | `src/git/predicates.ts` |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `src/commands/git.ts` |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `src/commands/git.ts` |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `src/commands/rebase.test.ts; src/commands/rebase.ts` |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/commands/rebase.test.ts; src/commands/rebase.ts` |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | `src/utils/git.ts` |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/commands/rebase.test.ts; src/commands/rebase.ts; src/utils/git.ts` |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/commands/rebase.test.ts; src/commands/rebase.ts` |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize.test.ts` |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize.test.ts; src/resolve-diff-base.test.ts` |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `src/plan/reconcile-conflicts.ts` |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/resolve-diff-base.test.ts` |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/commands/rebase.test.ts; src/commands/rebase.ts` |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-advisory-giwt-lock-status-command` | `src/cli-usage.ts` |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/commands/rebase.test.ts; src/commands/rebase.ts` |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/commit-wt.ts` |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize.test.ts` |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `src/commands/finalize/gates.ts` |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/commands/finalize/run.ts` |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/commands/finalize/checks.ts; src/resolve-diff-base.test.ts` |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/plan/status-vocab.ts` |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/plan/status-vocab.ts` |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | `src/tickets/sync-index.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `src/plan/validate.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/plan/status-vocab.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts; src/plan/validate.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` |
| `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` |
| `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `src/tickets/sync-parse.ts` |
| `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `src/tickets/sync-parse.ts` |
| `BUG-ticket-template-emits-empty-context-acceptance-placeholders-` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/commands/ticket/create.ts` |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/utils/check-slots.ts` |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | sibling | `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | `src/doctor/check.ts` |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/doctor/check.ts` |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/doctor/check.ts` |
| `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/doctor/check.ts` |
| `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/doctor/check.ts` |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/index.ts` |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `src/index.ts` |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/gpg-unlock.ts; src/index.ts` |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/commands/plan.ts` |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/plan/feature-matrix.ts` |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/validate.ts` |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `src/git/policy.ts` |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `src/commands/git.ts` |
| `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/utils/git.ts` |
| `FEAT-ledger-core-canonical-module` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/utils/ledger-core.ts` |
| `FEAT-ledger-core-canonical-module` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `src/utils/ledger-core.ts` |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `src/utils/ledger-core.ts; src/utils/runlog-types.ts` |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/utils/output.ts` |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `FEAT-record-per-step-durationms-in-run-events` | `src/utils/runlog.ts` |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `FIX-json-output-polluted-by-run-record-announcement` | `src/utils/output.ts; src/utils/runlog.ts` |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | sibling | `FIX-json-output-polluted-by-run-record-announcement` | `src/utils/output.ts` |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `src/tickets/sync-parse.ts` |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `src/index.ts` |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/index.ts` |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts` |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` |
| `FEAT-record-per-step-durationms-in-run-events` | sibling | `FIX-json-output-polluted-by-run-record-announcement` | `src/utils/runlog.ts` |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `src/commands/runs.ts` |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/index.ts` |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `src/commands/finalize.ts` |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/doctor/check.ts` |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | sibling | `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | `src/utils/worktree-root.test.ts` |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/utils/worktree-root.test.ts` |
| `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/utils/worktree-root.test.ts` |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` |
| `FIX-finalize-does-not-surface-gate-results-on-failure` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` |
| `FIX-finalize-does-not-surface-gate-results-on-failure` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` |
| `TASK-expose-file-size-check-via-public-api` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` |
| `TASK-giwt-clean-age-size-capped-tmp-pruning` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/utils/scratch.ts` |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts; src/tickets/sync-ticket.ts` |
