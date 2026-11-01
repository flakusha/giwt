<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# Plan Interconnect

Derived producer/consumer/sibling graph over `.plan/` tickets and epics, the
src/ paths they own, and the artifacts they declare (**Generates:**). Sibling
edges derived from feature-matrix co-membership carry `derived` provenance.
Regenerate with `giwt plan links --write`; freshness is gated by `giwt plan
links --check` / `giwt plan validate`. No timestamps — output is
byte-identical for identical inputs.

- tickets: 179
- epics: 1
- artifacts: 0
- src paths owned: 145
- edges: produces 283, consumes 4, sibling 1081, owns 4, related 16, generates 0

- derived edges: 792 (feature-matrix co-membership)

## Shared src hubs

| src path | owners |
| --- | --- |
| `src/backup/annex-status.ts` | `BUG-dump-on-annex-repos-is-a-silent-partial-backup`, `FEAT-programmatic-api-surface-for-backup-and-annex-seams` |
| `src/backup/tarball.ts` | `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees`, `BUG-dump-on-annex-repos-is-a-silent-partial-backup` |
| `src/cli-registry.ts` | `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-`, `FEAT-advisory-giwt-lock-status-command` |
| `src/cli-usage.ts` | `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-`, `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p`, `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch`, `FEAT-advisory-giwt-lock-status-command`, `FEAT-annex-sync-orchestration-lane-in-giwt-backup`, `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename`, `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` |
| `src/cli.ts` | `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-`, `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c`, `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the`, `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio`, `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote`, `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link`, `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` |
| `src/commands/abort.test.ts` | `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-`, `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` |
| `src/commands/abort.ts` | `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-`, `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` |
| `src/commands/backlog.ts` | `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic`, `TASK-migrate-plan-backlog-sync-to-a-top-level-backlog-command` |
| `src/commands/backup.ts` | `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees`, `BUG-dump-on-annex-repos-is-a-silent-partial-backup`, `FEAT-annex-sync-orchestration-lane-in-giwt-backup` |
| `src/commands/commit-wt.ts` | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p`, `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla`, `FEAT-one-line-outcome-contract-for-direct-cli-calls` |
| `src/commands/finalize.test.ts` | `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c`, `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as`, `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` |
| `src/commands/finalize.ts` | `BUG-finalize-check-failure-report-never-names-failed-gates-check`, `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c`, `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c`, `FIX-add-jitter-to-the-finalize-lock-retry-backoff`, `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the`, `FIX-finalize-does-not-surface-gate-results-on-failure`, `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas`, `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` |
| `src/commands/finalize/checks.ts` | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |
| `src/commands/finalize/gates.ts` | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `BUG-squash-commit-failure-strands-staged-changes-in-dev` |
| `src/commands/finalize/merge-exec.ts` | `BUG-finalize-direct-merge-allows-fast-forward`, `BUG-squash-commit-failure-strands-staged-changes-in-dev` |
| `src/commands/finalize/merge.ts` | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the`, `BUG-finalize-step1-doesnt-check-untracked-files`, `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` |
| `src/commands/finalize/run.ts` | `BUG-finalize-alreadymerged-check-is-incomplete`, `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the`, `BUG-finalize-step1-doesnt-check-untracked-files`, `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename`, `FEAT-one-line-outcome-contract-for-direct-cli-calls` |
| `src/commands/finalize/teardown.ts` | `BUG-finalize-teardown-branch-deletion-fallback-is-silent`, `BUG-finalize-teardown-doesnt-verify-worktree-exists`, `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal`, `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` |
| `src/commands/git.ts` | `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster`, `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des`, `FEAT-giwt-git-passthrough-command-for-harness-rerouting`, `FEAT-rtk-minimal-context-output-for-giwt-git` |
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
| `src/git/policy.ts` | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des`, `FEAT-git-invocation-allowlist-policy-configurable-lists`, `FEAT-giwt-git-passthrough-command-for-harness-rerouting`, `FEAT-programmatic-api-surface-for-backup-and-annex-seams` |
| `src/git/predicates.ts` | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p`, `BUG-exec-identity-patterns-author-equals-form-only-misses-space-`, `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster`, `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` |
| `src/gpg-unlock.ts` | `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |
| `src/index.ts` | `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-`, `FEAT-programmatic-api-surface-for-backup-and-annex-seams`, `FEAT-runs-json-diet-default-projection-and-query-filters`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit`, `TASK-expose-file-size-check-via-public-api`, `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-`, `epic-backup-annex-and-api` |
| `src/plan/code-map.ts` | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping`, `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` |
| `src/plan/feature-matrix.ts` | `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-`, `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u`, `FEAT-feature-matrix-generation-from-ticket-index`, `FEAT-reuse-toml-precedence-override-semantics-decision` |
| `src/plan/gen-docs.ts` | `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r`, `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` |
| `src/plan/reconcile-conflicts.ts` | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` |
| `src/plan/status-vocab.ts` | `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re`, `BUG-status-vocab-annotation-regex-rejects-nested-parentheses`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-`, `TASK-giwt-plan-validate-status-vocab-gate` |
| `src/plan/validate.ts` | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla`, `FEAT-feature-matrix-generation-from-ticket-index`, `TASK-giwt-plan-validate-status-vocab-gate`, `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis`, `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas`, `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-`, `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` |
| `src/plan/validate/content-gates.ts` | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-`, `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` |
| `src/resolve-diff-base.test.ts` | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di`, `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |
| `src/tickets/sync-index-write.ts` | `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a`, `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` |
| `src/tickets/sync-index.ts` | `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a`, `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla`, `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow`, `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic`, `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` |
| `src/tickets/sync-issues-ops.test.ts` | `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick`, `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` |
| `src/tickets/sync-normalize.ts` | `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u`, `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` |
| `src/tickets/sync-parse.ts` | `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing`, `FEAT-plan-links-derive-and-validate-producers-consumers-siblings`, `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` |
| `src/tickets/sync-ticket-index.test.ts` | `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u`, `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick`, `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` |
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
| `src/utils/settings.ts` | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote`, `FEAT-annex-sync-orchestration-lane-in-giwt-backup` |
| `src/utils/worktree-root.test.ts` | `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c`, `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f`, `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` |

## Edges

| from | kind | to | via | derived |
| --- | --- | --- | --- | --- |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | consumes | `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | `src/backup/tarball.ts; src/commands/backup.ts` | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | consumes | `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | `src/backup/tarball.ts; src/commands/backup.ts` | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | consumes | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | `src/backup/annex-status.ts` | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | consumes | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | `src/git/policy.ts` | - |
| `epic-backup-annex-and-api` | owns | `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | - | - |
| `epic-backup-annex-and-api` | owns | `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | - | - |
| `epic-backup-annex-and-api` | owns | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | - | - |
| `epic-backup-annex-and-api` | owns | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | - | - |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | produces | `src/commands/abort.test.ts` | - | - |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | produces | `src/commands/abort.ts` | - | - |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | produces | `src/commands/abort.test.ts` | - | - |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | produces | `src/commands/abort.ts` | - | - |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | produces | `src/backup/tarball.ts` | - | - |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | produces | `src/backup/verify.ts` | - | - |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | produces | `src/commands/backup.ts` | - | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/cli-registry.ts` | - | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/cli-usage.ts` | - | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/cli.ts` | - | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | produces | `src/utils/reuse-toml.ts` | - | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/cli-usage.ts` | - | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/commands/commit-wt.ts` | - | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/git/predicates.ts` | - | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | produces | `src/utils/git.ts` | - | - |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | produces | `src/doctor/check/run.ts` | - | - |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | produces | `src/doctor/check/tools.ts` | - | - |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | produces | `src/doctor/check/types.ts` | - | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | produces | `src/backup/annex-gate.ts` | - | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | produces | `src/backup/annex-status.ts` | - | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | produces | `src/backup/tarball.ts` | - | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | produces | `src/commands/backup.ts` | - | - |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | produces | `src/git/predicates.ts` | - | - |
| `BUG-finalize-alreadymerged-check-is-incomplete` | produces | `src/commands/finalize/run.ts` | - | - |
| `BUG-finalize-branchtopath-is-lossy` | produces | `src/utils/config.ts` | - | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | produces | `src/commands/finalize.ts` | - | - |
| `BUG-finalize-direct-merge-allows-fast-forward` | produces | `src/commands/finalize/merge-exec.ts` | - | - |
| `BUG-finalize-findworktree-only-checks-tree-dir` | produces | `src/utils/config.ts` | - | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | produces | `src/cli.ts` | - | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | produces | `src/commands/finalize.test.ts` | - | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | produces | `src/commands/finalize.ts` | - | - |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | produces | `src/commands/finalize/staging-sync.ts` | - | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | produces | `src/cli.ts` | - | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | produces | `src/commands/finalize/merge.ts` | - | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | produces | `src/commands/finalize/run.ts` | - | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/commands/plan/code-map.ts` | - | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/commands/scoped-reconcile.ts` | - | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/commands/sync.ts` | - | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/plan/code-map.ts` | - | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | produces | `src/plan/validate.ts` | - | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | produces | `src/commands/finalize/merge.ts` | - | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | produces | `src/commands/finalize/run.ts` | - | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | produces | `src/commands/finalize/teardown.ts` | - | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | produces | `src/commands/remove.ts` | - | - |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | produces | `src/commands/finalize/teardown.ts` | - | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | produces | `src/commands/finalize/teardown.ts` | - | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | produces | `src/commands/remove.ts` | - | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/commands/scoped-reconcile.ts` | - | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/commands/sync.ts` | - | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/plan/feature-matrix.ts` | - | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/plan/matrix.ts` | - | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/plan/reconcile-conflicts/generated.ts` | - | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | produces | `src/utils/spdx-fix.ts` | - | - |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | produces | `src/cli.ts` | - | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/create.ts` | - | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/doctor/apply.ts` | - | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/new-branch.ts` | - | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/commands/sign.ts` | - | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/doctor/generators/hooks.ts` | - | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/utils/config-writes.ts` | - | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | produces | `src/utils/config.ts` | - | - |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | produces | `src/commands/remove.ts` | - | - |
| `BUG-giwt-ticket-extid-double-prefix-resolved` | produces | `src/commands/ticket.test.ts` | - | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | produces | `src/commands/ticket.ts` | - | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | produces | `src/plan/status-vocab.ts` | - | - |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | produces | `src/utils/ledger.ts` | - | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | produces | `src/tickets/sync-index-write.ts` | - | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | produces | `src/tickets/sync-index.ts` | - | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | produces | `src/tickets/sync-worktree.test.ts` | - | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | produces | `src/utils/worktree-probe.ts` | - | - |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | produces | `src/plan/feature-matrix.ts` | - | - |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | produces | `src/tickets/sync-normalize.ts` | - | - |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | produces | `src/tickets/sync-ticket-index.test.ts` | - | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/commands/doctor.ts` | - | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/tickets/sync-index.ts` | - | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/tickets/sync-issues-ops.test.ts` | - | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | produces | `src/tickets/sync-ticket-index.test.ts` | - | - |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | produces | `src/plan/gen-docs.ts` | - | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | produces | `src/cli.ts` | - | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | produces | `src/commands/rebase.ts` | - | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | produces | `src/utils/settings.ts` | - | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | produces | `src/commands/git.ts` | - | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | produces | `src/git/predicate-helpers.ts` | - | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | produces | `src/git/predicates.ts` | - | - |
| `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | produces | `src/git/predicates.ts` | - | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | produces | `src/commands/rebase.test.ts` | - | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | produces | `src/commands/rebase.ts` | - | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | produces | `src/utils/git.ts` | - | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/commands/finalize.test.ts` | - | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/commands/rebase.test.ts` | - | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/commands/rebase.ts` | - | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/plan/reconcile-conflicts.ts` | - | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | produces | `src/resolve-diff-base.test.ts` | - | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | produces | `src/cli-usage.ts` | - | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | produces | `src/commands/rebase.test.ts` | - | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | produces | `src/commands/rebase.ts` | - | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/commit-wt.ts` | - | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/commit.ts` | - | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/finalize/merge.ts` | - | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/commands/scoped-worktree.ts` | - | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | produces | `src/plan/reconcile-conflicts/git-io.ts` | - | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/finalize.test.ts` | - | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/finalize/teardown.ts` | - | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/remove.test.ts` | - | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | produces | `src/commands/remove.ts` | - | - |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | produces | `src/commands/remove.ts` | - | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize.test.ts` | - | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize/checks.ts` | - | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize/gates.ts` | - | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/commands/finalize/run.ts` | - | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/plan/reconcile-conflicts.test.ts` | - | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | produces | `src/resolve-diff-base.test.ts` | - | - |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | produces | `src/commands/finalize/gates.ts` | - | - |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | produces | `src/commands/finalize/merge-exec.ts` | - | - |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | produces | `src/plan/status-vocab.ts` | - | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/plan/status-vocab.ts` | - | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/plan/validate.ts` | - | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/tickets/sync-index.ts` | - | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | produces | `src/tickets/sync-issues-ops.test.ts` | - | - |
| `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | produces | `src/tickets/sync-index.ts` | - | - |
| `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing` | produces | `src/tickets/sync-parse.ts` | - | - |
| `BUG-ticket-template-emits-empty-context-acceptance-placeholders-` | produces | `src/commands/ticket/create.ts` | - | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/cli-registry.ts` | - | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/cli-usage.ts` | - | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/commands/finalize/lock.ts` | - | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/commands/lock.ts` | - | - |
| `FEAT-advisory-giwt-lock-status-command` | produces | `src/utils/check-slots.ts` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | produces | `src/backup/annex-sync.ts` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | produces | `src/cli-usage.ts` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | produces | `src/commands/backup-gates.ts` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | produces | `src/commands/backup.ts` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | produces | `src/utils/settings.ts` | - | - |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | produces | `src/doctor/check.ts` | - | - |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | produces | `src/utils/coauthors.ts` | - | - |
| `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | produces | `src/doctor/check.ts` | - | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | produces | `src/gpg-unlock.ts` | - | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | produces | `src/gpg-unlock` | - | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | produces | `src/index.ts` | - | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/commands/plan.ts` | - | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/plan/feature-matrix.test.ts` | - | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/plan/feature-matrix.ts` | - | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | produces | `src/plan/validate.ts` | - | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | produces | `src/cli-usage.ts` | - | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | produces | `src/commands/finalize/run.ts` | - | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | produces | `src/commands/git.ts` | - | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | produces | `src/git/policy-annex.ts` | - | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | produces | `src/git/policy.test.ts` | - | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | produces | `src/git/policy.ts` | - | - |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | produces | `src/git/policy.ts` | - | - |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | produces | `src/commands/git.ts` | - | - |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | produces | `src/git/policy.ts` | - | - |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | produces | `src/utils/settings-schema.ts` | - | - |
| `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | produces | `src/utils/git.ts` | - | - |
| `FEAT-ledger-core-canonical-module` | produces | `src/utils/ledger-core.ts` | - | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/cli.ts` | - | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/commands/ledger.ts` | - | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/ledger-core.ts` | - | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/ledger.test.ts` | - | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/ledger.ts` | - | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | produces | `src/utils/runlog-types.ts` | - | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | produces | `src/utils/output.ts` | - | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | produces | `src/utils/runlog.ts` | - | - |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | produces | `src/commands/commit-wt.ts` | - | - |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | produces | `src/commands/finalize/run.ts` | - | - |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | produces | `src/utils/output.ts` | - | - |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | produces | `src/cli-usage.ts` | - | - |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | produces | `src/commands/plan/check-links.ts` | - | - |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | produces | `src/plan/check-links.ts` | - | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/db/schema-core.ts` | - | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/code-map.ts` | - | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/index-projection.ts` | - | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/interconnect.ts` | - | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/plan/src-refs.ts` | - | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/routes/v1/actors-surface.ts` | - | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | produces | `src/tickets/sync-parse.ts` | - | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/cli-usage.ts` | - | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/commands/plan.ts` | - | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/index.ts` | - | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/plan/status-vocab.ts` | - | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | produces | `src/tickets/sync-normalize.ts` | - | - |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | produces | `src/plan/status-vocab` | - | - |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | produces | `src/plan` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | produces | `src/backup/annex-status.ts` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | produces | `src/backup/orchestrate.ts` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | produces | `src/backup/state.ts` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | produces | `src/git/policy.ts` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | produces | `src/index.test.ts` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | produces | `src/index.ts` | - | - |
| `FEAT-record-per-step-durationms-in-run-events` | produces | `src/utils/runlog.ts` | - | - |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | produces | `src/plan/validate/content-gates.ts` | - | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/commands/matrix.ts` | - | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/commands/ticket/create.ts` | - | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/plan/feature-matrix.ts` | - | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/utils/reuse-toml.test.ts` | - | - |
| `FEAT-reuse-toml-precedence-override-semantics-decision` | produces | `src/utils/reuse-toml.ts` | - | - |
| `FEAT-rtk-minimal-context-output-for-giwt-git` | produces | `src/commands/git.ts` | - | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | produces | `src/commands/runs.test.ts` | - | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | produces | `src/commands/runs.ts` | - | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | produces | `src/index.ts` | - | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | produces | `src/commands/finalize.ts` | - | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | produces | `src/doctor/check.ts` | - | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | produces | `src/utils/check-slots.ts` | - | - |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | produces | `src/tickets/sync-index-write.ts` | - | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/chat/service/branches.ts` | - | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/frontend/ui.ts` | - | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/plan/reconcile-conflicts.ts` | - | - |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | produces | `src/test-utils/isolate-only.ts` | - | - |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | produces | `src/commands/finalize.ts` | - | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | produces | `src/commands/ticket.test.ts` | - | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | produces | `src/finalize-signal-safety.test.ts` | - | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | produces | `src/utils/worktree-root.test.ts` | - | - |
| `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | produces | `src/utils/errors.test.ts` | - | - |
| `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | produces | `src/utils/worktree-root.test.ts` | - | - |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | produces | `src/commands/finalize.ts` | - | - |
| `FIX-finalize-does-not-surface-gate-results-on-failure` | produces | `src/commands/finalize.ts` | - | - |
| `FIX-giwt-issues-silently-drops-state-so-closed-issues-are-unreac` | produces | `src/commands/issues.ts` | - | - |
| `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | produces | `src/commands/remove.ts` | - | - |
| `FIX-json-output-polluted-by-run-record-announcement` | produces | `src/utils/output.ts` | - | - |
| `FIX-json-output-polluted-by-run-record-announcement` | produces | `src/utils/runlog.ts` | - | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/commands/runs.ts` | - | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/utils/ledger-core.ts` | - | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/utils/runlog-read.ts` | - | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | produces | `src/utils/runlog-types.ts` | - | - |
| `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | produces | `src/tickets/sync-parse.ts` | - | - |
| `INFRA-dispose-two-stale-loop-lore-worktrees` | produces | `src/assets/service/create.ts` | - | - |
| `TASK-add-author-identity-guard-to-commit-merge-paths` | produces | `src/utils/author-guard.ts` | - | - |
| `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | produces | `src/commands/backlog.ts` | - | - |
| `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | produces | `src/plan/validate/content-gates.ts` | - | - |
| `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | produces | `src/plan/validate/gates-run.ts` | - | - |
| `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | produces | `src/tickets/sync-index.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/finalize-lock-queue.test.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/finalize/checks.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/gpg-unlock.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/gripe.test.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/commands/report.test.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/finalize-args.test.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/finalize-lock-fixture.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/gpg-unlock.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/gripe.test.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/index.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/report.test.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/resolve-diff-base.test.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/testkit/capture.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/testkit/finalize-lock-fixture.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/testkit` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/utils/gpg.ts` | - | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | produces | `src/utils/worktree-root.test.ts` | - | - |
| `TASK-commit-wt-on-protected-branch-direct-commit-scenario` | produces | `src/commands/commit-protected.test.ts` | - | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/commands/task/args.ts` | - | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/commands/worktree-bootstrap.ts` | - | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/tickets/sync-` | - | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/utils/args-scan.ts` | - | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/utils/config-writes.ts` | - | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | produces | `src/utils/ledger-read.ts` | - | - |
| `TASK-expose-file-size-check-via-public-api` | produces | `src/index.ts` | - | - |
| `TASK-expose-file-size-check-via-public-api` | produces | `src/utils/check-file-size.ts` | - | - |
| `TASK-giwt-clean-age-size-capped-tmp-pruning` | produces | `src/commands/clean.ts` | - | - |
| `TASK-giwt-clean-age-size-capped-tmp-pruning` | produces | `src/utils/scratch.ts` | - | - |
| `TASK-giwt-doctor-scratchpad-check` | produces | `src/doctor/check.ts` | - | - |
| `TASK-giwt-doctor-scratchpad-check` | produces | `src/utils/scratch.ts` | - | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | produces | `src/plan/status-vocab.ts` | - | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | produces | `src/plan/validate.ts` | - | - |
| `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | produces | `src/tickets/sync-index.ts` | - | - |
| `TASK-migrate-plan-backlog-sync-to-a-top-level-backlog-command` | produces | `src/commands/backlog.ts` | - | - |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | produces | `src/plan/validate.ts` | - | - |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | produces | `src/commands/finalize.ts` | - | - |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | produces | `src/plan/validate.ts` | - | - |
| `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | produces | `src/commands/finalize.ts` | - | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/cli.ts` | - | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/commands/rebase.test.ts` | - | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/commands/rebase.ts` | - | - |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | produces | `src/utils/git.ts` | - | - |
| `TASK-show-state-resolve-plan-tickets-filename-slugs` | produces | `src/commands/show.ts` | - | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/index.ts` | - | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/plan/validate.ts` | - | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/tickets/sync-reconcile.ts` | - | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/tickets/sync-ticket-index.test.ts` | - | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | produces | `src/tickets/sync-ticket.ts` | - | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/commands/ticket.ts` | - | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/plan/gen-docs.ts` | - | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/plan/validate.ts` | - | - |
| `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | produces | `src/tickets/sync-ticket.ts` | - | - |
| `epic-backup-annex-and-api` | produces | `src/index.ts` | - | - |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | related | `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | - | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | related | `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | - | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | related | `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | - | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | related | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | related | `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | related | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | - | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | related | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | - | - |
| `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | related | `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | - | - |
| `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | related | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | - | - |
| `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | related | `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | - | - |
| `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | related | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | - | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | related | `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | - | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | related | `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | related | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | related | `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | - | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | related | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | - | - |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | `src/commands/abort.test.ts; src/commands/abort.ts` | - |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-delete-stash-dance-after-staging-merge-lands` | `tag:stash` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `tag:git; tag:history-safety` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | `tag:git; tag:history-safety` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `BUG-abort-hard-resets-dev-when-a-stash-pop-conflicts-destroying-` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:history-safety` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `BUG-delete-stash-dance-after-staging-merge-lands` | `tag:stash` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `tag:git; tag:history-safety` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | `tag:git; tag:history-safety` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `BUG-abort-pops-stashes-by-positional-ref-destroying-user-authore` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:history-safety` | matrix |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `src/commands/backup.ts` | - |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | sibling | `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | `tag:backup` | matrix |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | sibling | `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | `tag:backup` | matrix |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | sibling | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | `tag:annex` | matrix |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | sibling | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | `epic:epic-backup-annex-and-api; tag:annex; tag:backup` | matrix |
| `BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees` | sibling | `epic-backup-annex-and-api` | `tag:annex; tag:backup` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | `tag:config` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `BUG-bad-config-toml-crashes-every-command-including-readers` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli` | matrix |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | `src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | `src/cli.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `src/cli.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | `src/cli.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `src/cli.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-advisory-giwt-lock-status-command` | `src/cli-registry.ts; src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/utils/reuse-toml.ts` | - |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:parser` | matrix |
| `BUG-checkheader-does-not-strip-the-comment-suffix-so-every-html-` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` | - |
| `BUG-commit-msg-hook-drift-between-giwt-and-omp-plugins` | sibling | `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | `tag:hooks` | matrix |
| `BUG-commit-msg-hook-drift-between-giwt-and-omp-plugins` | sibling | `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | `tag:hooks` | matrix |
| `BUG-commit-msg-hook-drift-between-giwt-and-omp-plugins` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `tag:drift` | matrix |
| `BUG-commit-msg-hook-drift-between-giwt-and-omp-plugins` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `tag:drift` | matrix |
| `BUG-commit-msg-hook-drift-between-giwt-and-omp-plugins` | sibling | `TASK-pre-commit-hook-s-2s-rationale-for-the-unconditional-full-ga` | `tag:hooks` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | `src/git/predicates.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | `src/git/predicates.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | `src/git/predicates.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | `src/utils/git.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/cli-usage.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `src/commands/commit-wt.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-advisory-giwt-lock-status-command` | `src/cli-usage.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `src/cli-usage.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | `src/utils/git.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/commit-wt.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` | - |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `TASK-pre-commit-hook-s-2s-rationale-for-the-unconditional-full-ga` | `tag:hooks` | matrix |
| `BUG-commit-wt-hardcodes-no-verify-bypassing-the-consuming-repo-p` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/utils/git.ts` | - |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-alreadymerged-check-is-incomplete` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-branchtopath-is-lossy` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-check-failure-report-never-names-failed-gates-check` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-direct-merge-allows-fast-forward` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-findworktree-only-checks-tree-dir` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-leaves-dev-worktree-stale-after-merging` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-delete-stash-dance-after-staging-merge-lands` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | sibling | `BUG-finalize-check-failure-report-never-names-failed-gates-check` | `tag:reporting` | matrix |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | sibling | `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | `tag:doctor` | matrix |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:reporting` | matrix |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | sibling | `FEAT-runs-failure-triage-extract-fail-blocks-and-diff-two-runs` | `tag:reporting` | matrix |
| `BUG-doctor-check-caps-findings-at-20-with-no-truncation-notice-s` | sibling | `TASK-giwt-doctor-scratchpad-check` | `tag:doctor` | matrix |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:data-loss` | matrix |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:data-loss` | matrix |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `src/commands/backup.ts` | - |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | sibling | `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | `tag:backup` | matrix |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | sibling | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | `tag:annex` | matrix |
| `BUG-dump-on-annex-repos-is-a-silent-partial-backup` | sibling | `epic-backup-annex-and-api` | `tag:annex; tag:backup` | matrix |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | sibling | `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | `tag:policy` | matrix |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | sibling | `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | `src/git/predicates.ts` | - |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | sibling | `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | `src/git/predicates.ts` | - |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | sibling | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | `tag:policy` | matrix |
| `BUG-exec-identity-patterns-author-equals-form-only-misses-space-` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:policy` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-branchtopath-is-lossy` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-check-failure-report-never-names-failed-gates-check` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-direct-merge-allows-fast-forward` | `tag:finalize; tag:merge` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-findworktree-only-checks-tree-dir` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-leaves-dev-worktree-stale-after-merging` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-alreadymerged-check-is-incomplete` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-check-failure-report-never-names-failed-gates-check` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-direct-merge-allows-fast-forward` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-findworktree-only-checks-tree-dir` | `src/utils/config.ts` | - |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-leaves-dev-worktree-stale-after-merging` | `tag:finalize; tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:finalize; tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | `src/utils/config.ts` | - |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `tag:naming` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-finalize-branchtopath-is-lossy` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-direct-merge-allows-fast-forward` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-findworktree-only-checks-tree-dir` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | `src/commands/finalize.ts` | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-leaves-dev-worktree-stale-after-merging` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:reporting` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-runs-failure-triage-extract-fail-blocks-and-diff-two-runs` | `tag:reporting` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/commands/finalize.ts` | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `src/commands/finalize.ts` | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` | - |
| `BUG-finalize-check-failure-report-never-names-failed-gates-check` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` | - |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-findworktree-only-checks-tree-dir` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-leaves-dev-worktree-stale-after-merging` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `src/commands/finalize/merge-exec.ts` | - |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-direct-merge-allows-fast-forward` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-finalize-leaves-dev-worktree-stale-after-merging` | `tag:finalize; tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:finalize; tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | `tag:discovery` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | `src/utils/config.ts` | - |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-finalize-findworktree-only-checks-tree-dir` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `src/cli.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | `src/cli.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `src/cli.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `src/commands/finalize.test.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize.test.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize.test.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/commands/finalize.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `src/commands/finalize.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` | - |
| `BUG-finalize-leaks-worktree-and-branch-when-the-target-already-c` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` | - |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:finalize; tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-finalize-leaves-dev-worktree-stale-after-merging` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `src/commands/finalize/merge.ts; src/commands/finalize/run.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | `src/cli.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `tag:cli` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `src/cli.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `src/commands/finalize/merge.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:cli` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:cli; tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | `tag:cli` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:cli` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` | - |
| `BUG-finalize-lock-queue-test-flakes-marker-queued-never-appeared` | sibling | `BUG-giwt-new-default-base-dev-does-not-exist-in-this-repo` | `epic:quality` | matrix |
| `BUG-finalize-lock-queue-test-flakes-marker-queued-never-appeared` | sibling | `BUG-reconcile-gpg-amend-test-flakes-under-parallel-gate-load` | `tag:tests` | matrix |
| `BUG-finalize-lock-queue-test-flakes-marker-queued-never-appeared` | sibling | `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | `epic:quality` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-finalize-step1-doesnt-check-untracked-files` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | `src/commands/scoped-reconcile.ts; src/commands/sync.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/plan/validate.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `BUG-sync-fix-stamps-ticket-done-without-provenance` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `src/plan/validate.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `src/plan/code-map.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize; tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/validate.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` | - |
| `BUG-finalize-step-5-5-rebuilds-code-map-from-2-sources-stripping` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | `tag:data-loss; tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `src/commands/finalize/merge.ts` | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` | - |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-finalize-step1-doesnt-check-untracked-files` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-finalize-teardown-doesnt-verify-worktree-exists` | `src/commands/finalize/teardown.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `src/commands/finalize/teardown.ts; src/commands/remove.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `src/commands/remove.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize/teardown.ts; src/commands/remove.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` | - |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-branch-deletion-fallback-is-silent` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | `src/commands/finalize/teardown.ts` | - |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize/teardown.ts` | - |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-doesnt-verify-worktree-exists` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | `src/commands/remove.ts` | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize/teardown.ts; src/commands/remove.ts` | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` | - |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-finalize-teardown-worktree-removal-failure-is-non-fatal` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | sibling | `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | `src/plan/feature-matrix.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `src/plan/feature-matrix.ts` | - |
| `BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/plan/feature-matrix.ts` | - |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `src/cli.ts` | - |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:bug` | matrix |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` | - |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `tag:spdx` | matrix |
| `BUG-gettrackedfiles-default-git-runner-throws-on-every-invocatio` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` | - |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | sibling | `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | `tag:policy` | matrix |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | sibling | `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | `tag:policy` | matrix |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | sibling | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | `tag:policy` | matrix |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:policy` | matrix |
| `BUG-giwt-lifecycle-config-writes-invisible-to-omp-guard` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `src/utils/config-writes.ts` | - |
| `BUG-giwt-new-default-base-dev-does-not-exist-in-this-repo` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:dx` | matrix |
| `BUG-giwt-new-default-base-dev-does-not-exist-in-this-repo` | sibling | `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | `epic:quality` | matrix |
| `BUG-giwt-new-default-base-dev-does-not-exist-in-this-repo` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:dx` | matrix |
| `BUG-giwt-new-default-base-dev-does-not-exist-in-this-repo` | sibling | `TASK-show-state-resolve-plan-tickets-filename-slugs` | `tag:dx` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | `tag:worktree` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:worktree` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:worktree` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/remove.ts` | - |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` | - |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:cli` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:cli` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | `tag:cli` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `tag:cli` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:cli` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` | - |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli; tag:worktree` | matrix |
| `BUG-giwt-ticket-extid-double-prefix-resolved` | sibling | `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | `src/commands/ticket.test.ts` | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | `tag:status-vocab` | matrix |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | `src/plan/status-vocab.ts` | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/plan/status-vocab.ts` | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | `tag:status-vocab` | matrix |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/plan/status-vocab.ts` | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `FEAT-ticket-close-writes-md-status-plus-issue-state` | `tag:ticket` | matrix |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts` | - |
| `BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/commands/ticket.ts` | - |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | sibling | `FEAT-ledger-core-canonical-module` | `tag:ledger` | matrix |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/utils/ledger.ts` | - |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | sibling | `FEAT-ledger-schema-v2-writer` | `tag:ledger` | matrix |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `tag:concurrency` | matrix |
| `BUG-ledger-append-race-drops-records-under-concurrent-agents` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:concurrency` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | `src/tickets/sync-index.ts` | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:worktree` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:worktree` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `tag:worktree` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:worktree` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/tickets/sync-index.ts` | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-sync-fix-stamps-ticket-done-without-provenance` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | `src/tickets/sync-index.ts` | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `src/tickets/sync-index-write.ts` | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | `src/tickets/sync-index.ts` | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` | - |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `BUG-linked-worktree-sync-defers-canonical-index-write-but-sync-a` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:index` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | `src/tickets/sync-ticket-index.test.ts` | - |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | `tag:status-vocab` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `tag:status-vocab` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `BUG-sync-fix-stamps-ticket-done-without-provenance` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | `tag:status-vocab` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `src/plan/feature-matrix.ts` | - |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/tickets/sync-normalize.ts` | - |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/plan/feature-matrix.ts` | - |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `BUG-normalizestatus-leaves-not-started-entries-in-other-bucket-u` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/tickets/sync-ticket-index.test.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/tickets/sync-index.ts; src/tickets/sync-issues-ops.test.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | `src/tickets/sync-index.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | `src/tickets/sync-index.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` | - |
| `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/tickets/sync-ticket-index.test.ts` | - |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | `tag:git; tag:rebase` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | `tag:git; tag:rebase` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `tag:rebase` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git; tag:rebase` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git; tag:rebase` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | `tag:rebase` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `tag:rebase` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `BUG-patch-id-duplicate-detection-is-defeated-by-a-rename-between` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:rebase` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `BUG-sync-fix-stamps-ticket-done-without-provenance` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `BUG-plan-gen-docs-tasks-column-counts-unchecked-checkboxes-not-r` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/gen-docs.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | `src/commands/rebase.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `src/commands/rebase.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/commands/rebase.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `src/utils/settings.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | `tag:git` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `tag:git` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git; tag:rebase` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/cli.ts` | - |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git; tag:rebase` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | `tag:rebase` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `tag:rebase` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:history-safety` | matrix |
| `BUG-rebase-default-target-is-the-root-branch-which-is-also-prote` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts; src/commands/rebase.ts` | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | `src/git/predicates.ts` | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | `src/commands/git.ts` | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:policy` | matrix |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `src/commands/git.ts` | - |
| `BUG-rebase-exec-identity-guard-bypassed-by-ix-short-flag-cluster` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `src/commands/git.ts` | - |
| `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | sibling | `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | `tag:policy` | matrix |
| `BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:policy` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | `src/commands/rebase.test.ts; src/commands/rebase.ts` | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/commands/rebase.test.ts; src/commands/rebase.ts` | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | `tag:git` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `tag:git` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git; tag:rebase` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | `src/utils/git.ts` | - |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git; tag:rebase` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | `tag:rebase` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `tag:rebase` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:history-safety` | matrix |
| `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/commands/rebase.test.ts; src/commands/rebase.ts; src/utils/git.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | `src/commands/rebase.test.ts; src/commands/rebase.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `src/commands/finalize.test.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:worktree` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize.test.ts; src/resolve-diff-base.test.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `src/plan/reconcile-conflicts.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/resolve-diff-base.test.ts` | - |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-rebase-lacks-already-contained-guard-compounding-an-empty-di` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/commands/rebase.test.ts; src/commands/rebase.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | `tag:worktree` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `tag:worktree` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-advisory-giwt-lock-status-command` | `src/cli-usage.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `src/cli-usage.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:rebase` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:rebase` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | `tag:rebase` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `tag:rebase` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/commands/rebase.test.ts; src/commands/rebase.ts` | - |
| `BUG-rebase-refuses-a-dirty-worktree-with-no-escape-hatch` | sibling | `TASK-show-state-resolve-plan-tickets-filename-slugs` | `tag:dx` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `BUG-reconcile-gpg-amend-test-flakes-under-parallel-gate-load` | `tag:gpg` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | `tag:gpg` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/commit-wt.ts` | - |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-reconcile-conflicts-commit-path-does-not-pin-gpg-signing-fla` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-reconcile-gpg-amend-test-flakes-under-parallel-gate-load` | sibling | `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | `tag:gpg` | matrix |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | `src/commands/remove.ts` | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | `src/commands/finalize.test.ts` | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` | - |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-remove-branch-only-force-deletes-the-reflog-it-advertises-as` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | `tag:worktree` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:cli` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:cli` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | `tag:cli` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `tag:cli` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:cli` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` | `src/commands/remove.ts` | - |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-remove-path-auto-detection-matches-main-worktree-registratio` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli; tag:worktree` | matrix |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `BUG-squash-commit-failure-strands-staged-changes-in-dev` | `src/commands/finalize/gates.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/commands/finalize/run.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/commands/finalize/checks.ts; src/resolve-diff-base.test.ts` | - |
| `BUG-resolvediffbase-returns-merge-base-instead-of-the-requested-` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:worktree` | matrix |
| `BUG-scoped-marker-path-is-cwd-relative-so-worktree-scope-writes-` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `FEAT-advisory-giwt-lock-status-command` | `tag:finalize` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `tag:finalize` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `BUG-squash-commit-failure-strands-staged-changes-in-dev` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | `src/plan/status-vocab.ts` | - |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | `tag:status-vocab` | matrix |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/plan/status-vocab.ts` | - |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan-validate` | matrix |
| `BUG-status-vocab-annotation-regex-rejects-nested-parentheses` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts` | - |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `BUG-sync-fix-stamps-ticket-done-without-provenance` | `tag:sync` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | `tag:sync` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic` | `tag:tickets` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `tag:sync` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:sync; tag:tickets` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:tickets` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:sync; tag:tickets` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:sync; tag:tickets` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync; tag:tickets` | matrix |
| `BUG-sync-fix-leaves-feature-matrix-and-code-map-stale` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync; tag:tickets` | matrix |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | `tag:status-vocab` | matrix |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | `src/tickets/sync-index.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `src/plan/validate.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/plan/status-vocab.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | `src/tickets/sync-index.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts; src/plan/validate.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` | - |
| `BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` | - |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | `tag:sync` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `tag:sync` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-feature-matrix-generation-from-ticket-index` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:plan; tag:sync` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan; tag:sync` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan; tag:sync` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `BUG-sync-fix-stamps-ticket-done-without-provenance` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `tag:sync` | matrix |
| `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:sync` | matrix |
| `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:sync` | matrix |
| `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:sync` | matrix |
| `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync` | matrix |
| `BUG-sync-fix-statusmismatches-branch-writes-raw-git-state-into-m` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync` | matrix |
| `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | sibling | `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | `src/tickets/sync-index.ts` | - |
| `BUG-sync-index-shadows-imported-raw-oxlint-no-shadow` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` | - |
| `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `src/tickets/sync-parse.ts` | - |
| `BUG-tag-parser-keeps-bracket-quote-backtick-adornments-producing` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `src/tickets/sync-parse.ts` | - |
| `BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:tickets` | matrix |
| `BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:tickets` | matrix |
| `BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:tickets` | matrix |
| `BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:tickets` | matrix |
| `BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:tickets` | matrix |
| `BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:tickets` | matrix |
| `BUG-ticket-template-emits-empty-context-acceptance-placeholders-` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/commands/ticket/create.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | `src/cli-usage.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `tag:agents` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | `tag:cli` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `tag:agents; tag:cli` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:agents; tag:cli` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/utils/check-slots.ts` | - |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `FEAT-advisory-giwt-lock-status-command` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli` | matrix |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | `tag:backup` | matrix |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | `src/cli-usage.ts` | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:sync` | matrix |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` | - |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:sync` | matrix |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:sync` | matrix |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync` | matrix |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync` | matrix |
| `FEAT-annex-sync-orchestration-lane-in-giwt-backup` | sibling | `epic-backup-annex-and-api` | `tag:annex; tag:backup` | matrix |
| `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | sibling | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | `tag:backup` | matrix |
| `FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen` | sibling | `epic-backup-annex-and-api` | `tag:backup` | matrix |
| `FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s` | sibling | `epic-backup-annex-and-api` | `tag:backup` | matrix |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | sibling | `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | `src/doctor/check.ts` | - |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/doctor/check.ts` | - |
| `FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/doctor/check.ts` | - |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-commit-co-author-trailer-policy-strip-llm-keep-real-aggregat` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-detect-resurrected-files-identical-content-living-under-two-` | `tag:git` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-ticket-template-requires-possible-caveats-and-issues-to-avoi` | `tag:safety` | matrix |
| `FEAT-destructive-gpg-bypass-git-guard-cc-safety-net-seeded` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-detect-resurrected-files-identical-content-living-under-two-` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `tag:git` | matrix |
| `FEAT-detect-resurrected-files-identical-content-living-under-two-` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `tag:git` | matrix |
| `FEAT-detect-resurrected-files-identical-content-living-under-two-` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `FEAT-detect-resurrected-files-identical-content-living-under-two-` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `FEAT-detect-resurrected-files-identical-content-living-under-two-` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `FEAT-detect-resurrected-files-identical-content-living-under-two-` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `FEAT-docs-list-show-search-toml-and-emoji-output-parity` | sibling | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | `tag:output` | matrix |
| `FEAT-docs-list-show-search-toml-and-emoji-output-parity` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `tag:output` | matrix |
| `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | sibling | `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | `src/doctor/check.ts` | - |
| `FEAT-doctor-check-concurrency-run-the-five-checks-in-parallel` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/doctor/check.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `tag:migration` | matrix |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/index.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | `src/index.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:migration` | matrix |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `src/index.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/gpg-unlock.ts; src/index.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:migration` | matrix |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` | - |
| `FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st` | sibling | `epic-backup-annex-and-api` | `src/index.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/commands/plan.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `src/plan/feature-matrix.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/validate.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` | - |
| `FEAT-feature-matrix-generation-from-ticket-index` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | `tag:cli` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-merge-in-staging-worktree-with-ref-move` | `tag:finalize` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/commands/finalize/run.ts` | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | `src/cli-usage.ts` | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` | - |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-reuse-toml-precedence-override-semantics-decision` | `tag:decision` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:cli` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `FEAT-finalize-dry-run-scope-decision-true-dry-run-or-rename` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli` | matrix |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | sibling | `FEAT-git-invocation-allowlist-policy-configurable-lists` | `src/git/policy.ts` | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `src/commands/git.ts; src/git/policy.ts` | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `src/commands/git.ts` | - |
| `FEAT-git-annex-passthrough-second-level-classifier-policy-for-des` | sibling | `epic-backup-annex-and-api` | `tag:annex` | matrix |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | sibling | `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | `src/git/policy.ts` | - |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | sibling | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | `src/git/policy.ts` | - |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-git-invocation-allowlist-policy-configurable-lists` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | sibling | `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | `tag:git` | matrix |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | sibling | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | `src/git/policy.ts` | - |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git` | matrix |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `src/commands/git.ts` | - |
| `FEAT-giwt-git-passthrough-command-for-harness-rerouting` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | sibling | `FEAT-rebase-auto-resolve-superset-side-conflicts` | `tag:git; tag:rebase` | matrix |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | sibling | `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | `tag:rebase` | matrix |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `tag:rebase` | matrix |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `FEAT-giwt-history-audit-classify-history-shape-and-flag-suspiciou` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:rebase` | matrix |
| `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | sibling | `TASK-pre-commit-hook-s-2s-rationale-for-the-unconditional-full-ga` | `tag:hooks` | matrix |
| `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:isolation` | matrix |
| `FEAT-isolatedgitenv-also-strips-agent-harness-session-vars` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/utils/git.ts` | - |
| `FEAT-ledger-core-canonical-module` | sibling | `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | `src/utils/ledger-core.ts` | - |
| `FEAT-ledger-core-canonical-module` | sibling | `FEAT-ledger-schema-v2-writer` | `epic:ledger-redesign; tag:ledger` | matrix |
| `FEAT-ledger-core-canonical-module` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `src/utils/ledger-core.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `FEAT-ledger-schema-v2-writer` | `tag:ledger` | matrix |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `tag:agents` | matrix |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `FEAT-record-per-step-durationms-in-run-events` | `tag:observability` | matrix |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:agents` | matrix |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `src/utils/ledger-core.ts; src/utils/runlog-types.ts` | - |
| `FEAT-ledger-lifecycle-truthfulness-dispatcher-finish-and-run-link` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `src/cli.ts` | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `FEAT-one-line-outcome-contract-for-direct-cli-calls` | `src/utils/output.ts` | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `FEAT-record-per-step-durationms-in-run-events` | `src/utils/runlog.ts` | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:cli` | matrix |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `FIX-json-output-polluted-by-run-record-announcement` | `src/utils/output.ts; src/utils/runlog.ts` | - |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `FEAT-logger-internals-run-correlation-fields-warnonce-raw-hygiene` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli` | matrix |
| `FEAT-merge-in-staging-worktree-with-ref-move` | sibling | `FEAT-narrow-finalize-lock-to-merge-steps` | `tag:finalize` | matrix |
| `FEAT-merge-in-staging-worktree-with-ref-move` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `FEAT-merge-in-staging-worktree-with-ref-move` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `FEAT-merge-in-staging-worktree-with-ref-move` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `FEAT-merge-in-staging-worktree-with-ref-move` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `FEAT-narrow-finalize-lock-to-merge-steps` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:finalize` | matrix |
| `FEAT-narrow-finalize-lock-to-merge-steps` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `FEAT-narrow-finalize-lock-to-merge-steps` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `FEAT-narrow-finalize-lock-to-merge-steps` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:agents; tag:cli` | matrix |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | sibling | `FIX-json-output-polluted-by-run-record-announcement` | `src/utils/output.ts` | - |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `FEAT-one-line-outcome-contract-for-direct-cli-calls` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `src/cli-usage.ts` | - |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:migration; tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:migration` | matrix |
| `FEAT-plan-check-links-fix-to-auto-repair-stale-markdown-links-and` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-ticket-template-requires-possible-caveats-and-issues-to-avoi` | `tag:validation` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `src/tickets/sync-parse.ts` | - |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-plan-links-derive-and-validate-producers-consumers-siblings` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | `tag:plan` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan; tag:tickets` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan; tag:sync; tag:tickets` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan; tag:sync; tag:tickets` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync; tag:tickets` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync; tag:tickets` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-plan-metadata-subcommand-promote-frontmatter-wins-projection` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | `src/index.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:migration; tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `src/index.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/index.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `src/plan/status-vocab.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:migration` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` | - |
| `FEAT-plan-normalize-statuses-subcommand-to-normalize-plan-status-` | sibling | `epic-backup-annex-and-api` | `src/index.ts` | - |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | `tag:plan` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `FEAT-runs-failure-triage-extract-fail-blocks-and-diff-two-runs` | `tag:reporting` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-plan-report-subcommand-promote-loop-lore-report-plan-metadat` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | `tag:plan; tag:tickets` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan; tag:tickets` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:tickets` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:tickets` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `TASK-giwt-plan-validate-status-vocab-gate` | `tag:plan-validate` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-plan-validate-tickets-gate-reuses-orphan-tag-and-orphan-bind` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `src/index.ts` | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/index.ts` | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` | - |
| `FEAT-programmatic-api-surface-for-backup-and-annex-seams` | sibling | `epic-backup-annex-and-api` | `src/index.ts` | - |
| `FEAT-rebase-auto-resolve-superset-side-conflicts` | sibling | `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | `tag:rebase` | matrix |
| `FEAT-rebase-auto-resolve-superset-side-conflicts` | sibling | `FEAT-rtk-minimal-context-output-for-giwt-git` | `tag:git` | matrix |
| `FEAT-rebase-auto-resolve-superset-side-conflicts` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `tag:rebase` | matrix |
| `FEAT-rebase-auto-resolve-superset-side-conflicts` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `tag:git` | matrix |
| `FEAT-rebase-auto-resolve-superset-side-conflicts` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:rebase` | matrix |
| `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | sibling | `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | `tag:rebase` | matrix |
| `FEAT-rebase-skip-decisions-are-not-recorded-so-dropped-work-is-un` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:rebase` | matrix |
| `FEAT-record-per-step-durationms-in-run-events` | sibling | `FEAT-runs-failure-triage-extract-fail-blocks-and-diff-two-runs` | `tag:runlog` | matrix |
| `FEAT-record-per-step-durationms-in-run-events` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:runlog` | matrix |
| `FEAT-record-per-step-durationms-in-run-events` | sibling | `FIX-json-output-polluted-by-run-record-announcement` | `src/utils/runlog.ts` | - |
| `FEAT-record-per-step-durationms-in-run-events` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:observability; tag:runlog` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | `tag:plan` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan; tag:sync; tag:tickets` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync; tag:tickets` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync; tag:tickets` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-reject-manual-edits-to-plan-tickets-index-json-with-a-frontm` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | sibling | `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | `tag:plan` | matrix |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | sibling | `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | `src/plan/validate/content-gates.ts` | - |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `tag:migration` | matrix |
| `FEAT-repo-wide-spdx-header-check-covering-every-tracked-file-and-` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-rtk-minimal-context-output-for-giwt-git` | sibling | `FEAT-zero-shot-command-classifier-seam-prepare-only` | `epic:git-rerouting-safety; tag:git` | matrix |
| `FEAT-runs-failure-triage-extract-fail-blocks-and-diff-two-runs` | sibling | `FEAT-runs-json-diet-default-projection-and-query-filters` | `tag:runlog` | matrix |
| `FEAT-runs-failure-triage-extract-fail-blocks-and-diff-two-runs` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:runlog` | matrix |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `src/commands/runs.ts` | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/index.ts` | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:cli` | matrix |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli` | matrix |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` | - |
| `FEAT-runs-json-diet-default-projection-and-query-filters` | sibling | `epic-backup-annex-and-api` | `src/index.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `src/commands/finalize.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/doctor/check.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` | - |
| `FEAT-size-the-gate-fan-out-by-available-memory-not-only-by-core-c` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` | - |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | sibling | `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | `tag:plan` | matrix |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | sibling | `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | `tag:sync; tag:tickets` | matrix |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync; tag:tickets` | matrix |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-sync-re-reads-tags-epic-related-for-entries-already-in-the-i` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | sibling | `FEAT-universal-post-merge-plan-reconciliation` | `tag:plan` | matrix |
| `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:plan` | matrix |
| `FEAT-ticket-header-conflict-resolver-in-rebase-loop` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-universal-post-merge-plan-reconciliation` | sibling | `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | `tag:finalize` | matrix |
| `FEAT-universal-post-merge-plan-reconciliation` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `FEAT-universal-post-merge-plan-reconciliation` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize; tag:plan` | matrix |
| `FEAT-universal-post-merge-plan-reconciliation` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `FEAT-weave-damage-scan-duplicated-and-orphaned-blocks-are-structu` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:rebase` | matrix |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | `src/commands/finalize.ts` | - |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` | - |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `FIX-referenced-artifacts-must-outlive-the-console` | `tag:finalize` | matrix |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` | - |
| `FIX-add-jitter-to-the-finalize-lock-retry-backoff` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | sibling | `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | `src/utils/worktree-root.test.ts` | - |
| `FIX-bun-test-from-the-repo-root-sweeps-100-worktree-test-files-c` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/utils/worktree-root.test.ts` | - |
| `FIX-errors-test-ts-leaks-process-env-repo-root-into-later-test-f` | sibling | `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | `src/utils/worktree-root.test.ts` | - |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | sibling | `FIX-finalize-does-not-surface-gate-results-on-failure` | `src/commands/finalize.ts` | - |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` | - |
| `FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` | - |
| `FIX-finalize-does-not-surface-gate-results-on-failure` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/commands/finalize.ts` | - |
| `FIX-finalize-does-not-surface-gate-results-on-failure` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` | - |
| `FIX-referenced-artifacts-must-outlive-the-console` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `tag:finalize` | matrix |
| `FIX-sync-fix-reports-one-refusal-for-every-registry-failure-clas` | sibling | `FIX-sync-parse-first-bold-colon-match-mis-parses-when-body-prose` | `tag:sync; tag:tickets` | matrix |
| `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | sibling | `TASK-giwt-sync-recalculate-tickets-index-inside-a-worktree` | `src/tickets/sync-index.ts` | - |
| `TASK-backlog-dir-requirement-should-be-optional-given-ticket-epic` | sibling | `TASK-migrate-plan-backlog-sync-to-a-top-level-backlog-command` | `src/commands/backlog.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | sibling | `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | `tag:refactor` | matrix |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | sibling | `TASK-expose-file-size-check-via-public-api` | `src/index.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` | - |
| `TASK-colocation-sweep-stranded-tests-gpg-unlock-split-testkit` | sibling | `epic-backup-annex-and-api` | `src/index.ts` | - |
| `TASK-consolidation-worktree-bootstrap-scanflags-stale-size-allow` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:cli` | matrix |
| `TASK-expose-file-size-check-via-public-api` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/index.ts` | - |
| `TASK-expose-file-size-check-via-public-api` | sibling | `epic-backup-annex-and-api` | `src/index.ts` | - |
| `TASK-giwt-clean-age-size-capped-tmp-pruning` | sibling | `TASK-giwt-doctor-scratchpad-check` | `src/utils/scratch.ts` | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | `src/plan/validate.ts` | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` | - |
| `TASK-giwt-plan-validate-status-vocab-gate` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` | - |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | sibling | `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | `src/plan/validate.ts` | - |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` | - |
| `TASK-plan-validate-reject-case-insensitive-ticket-filename-collis` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` | - |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | sibling | `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | `src/commands/finalize.ts` | - |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | sibling | `TASK-shard-tickets-index-or-stop-per-branch-index-commits` | `tag:plan` | matrix |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | sibling | `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | `src/plan/validate.ts` | - |
| `TASK-plan-validate-scope-ticket-format-link-gates-to-the-diff-bas` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts` | - |
| `TASK-reach-parity-with-the-loop-lore-worktree-fork-so-it-can-be-d` | sibling | `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | `tag:worktree` | matrix |
| `TASK-rebase-must-run-from-the-repo-root-with-no-in-worktree-path-` | sibling | `TASK-show-state-resolve-plan-tickets-filename-slugs` | `tag:dx` | matrix |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | sibling | `TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice` | `src/plan/validate.ts; src/tickets/sync-ticket.ts` | - |
| `TASK-ticket-index-sync-spends-3074-subprocess-spawns-on-a-single-` | sibling | `epic-backup-annex-and-api` | `src/index.ts` | - |
