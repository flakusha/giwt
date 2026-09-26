# Generated plan conflict handling

`giwt rebase` and the rebase/squash paths of `giwt finalize` reconcile generated plan artifacts when a rebase stops on conflicts in the configured ticket index, code map, epics index, or feature matrix. With the default settings, these are `.plan/tickets/index.json`, `.plan/code-map.json`, `.plan/epics-index.md`, and `.plan/feature-matrix.md`.

The ticket index is merged by record key and field: records and tags are unioned, and competing scalar fields keep the rebase-side value with a warning. The other generated files are regenerated from the reconciled plan sources. Generated-only conflicts are staged automatically; the helper continues through successive rebase stops until the rebase completes or a non-generated conflict remains. If source files are also conflicted, the command stops without staging generated files and leaves the full conflict for manual resolution.

This is intentionally limited to generated plan artifacts; ordinary source conflicts remain manual.
