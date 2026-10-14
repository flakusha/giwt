<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: checkHeader does not strip the comment suffix, so every HTML/CSS SPDX header reads as a bogus license id

**Status:** Done
**Priority:** high
**Effort:** Small
**Epic:** spdx-compliance
**Tags:** spdx, reuse, parser

**Summary:**

checkHeader() in src/utils/reuse-toml.ts:90-91 splits the header line on the tag name and trims it, but never removes the comment delimiter that closes the line. For an HTML file the license line ends in the html comment terminator, so the parsed license is 'AGPL-3.0-or-later-->' and can never equal the rule's expected 'AGPL-3.0-or-later'. The copyright token has the same defect.

This was a latent parser bug until commit 4dfba88 ('route generated .plan/ headers through consumer REUSE.toml') added a REUSE.toml to giwt's own tree, which switched enforcement on for the first time. Before that, spdx-check bailed early with 'no rules to check' and exited 0.

Reproduced directly, bypassing whole-tree discovery:

    $ bun src/cli.ts spdx-check .plan/epics-index.md
      .plan/epics-index.md: license=AGPL-3.0-or-later--> (expected AGPL-3.0-or-later) copyright=2026 giwt Contributors--> (expected 2026 giwt Contributors)
    warn: 1 file(s) with SPDX header violations

Whole-tree impact, measured by running the shipped checkHeader/parseReuseToml/filterCheckableFiles over 'git ls-files' (420 checkable files, 415 matching a rule): 151 files fail — 149 .md from this defect, plus 2 .ts.

The 2 .ts failures are a SEPARATE, genuine header gap and NOT this bug: src/cli-registry.ts and src/cli-usage.ts carry the license token but no copyright token at all (verified with grep -L). Fix those two files' headers rather than the parser.

Note: whole-tree 'spdx-check' cannot currently demonstrate these numbers through the CLI, because an independent defect in getTrackedFiles' default git runner throws before any header is checked. That is tracked separately; this ticket is scoped to the parser only.

Resolution: fix landed as `655422d` (checkHeader strips the comment terminator only when present).

**Acceptance Criteria:**

- [ ] checkHeader strips the trailing comment delimiter per the extension's commentStyleFor() (html terminator for html/md/mdx, css terminator for css) before comparing against the rule, for both the license and the copyright token
- [ ] The delimiter is only stripped when it is actually the file's closing delimiter, so an id that legitimately ends in a dash is not mangled
- [ ] The .md failure count over giwt's own tree drops from 149 to 0
- [ ] src/cli-registry.ts and src/cli-usage.ts gain the missing copyright header token (or are otherwise brought into compliance)
- [ ] Tests covering a slash comment, a hash comment, an html comment and a css comment
- [ ] Documentation updated

**Context:**

The defect is narrower than "every header is broken": only comment styles with a closing delimiter (html, css) produce a bogus id. The default '//' and '#' styles have no suffix and parse correctly, which is why `src/**` never surfaced it and only `.plan/**` markdown did.

Measured 2026-10-14 on giwt master. All numbers obtained by invoking the shipped functions directly over 'git ls-files', not by reimplementing them.
