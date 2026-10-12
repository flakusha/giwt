<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: repo-wide SPDX header check covering every tracked file and both SPDX tokens

**Status:** Not Started
**Priority:** high
**Effort:** Medium
**Tags:** plan, migration

**Summary:**

`checkSpdx` (`src/plan/validate/content-gates.ts:112-128`) walks markdown under
`.plan/` only and tests `raw.includes("SPDX-License-Identifier:")` — a substring
anywhere in the file, not a header check, and only one of the two tokens.
`SPDX-FileCopyrightText` is never checked, and no file outside `.plan/` is ever
examined. Add a repo-wide SPDX header gate that scans every git-tracked file,
requires both `SPDX-License-Identifier` and `SPDX-FileCopyrightText` in the
header region, and honours per-path expected values (a `REUSE.toml`-shaped
rules file, or equivalent config) so a repo with mixed licences can use it.

**Context:**

Consumer impact: loop-lore's `scripts-migration-delete` branch deletes
`scripts/check-spdx.ts` and its `spdx:check` / `spdx:fix` scripts with no
replacement. The deleted checker walked the whole tracked tree via
`git ls-files`, matched each file against `REUSE.toml` `[[annotations]]` rules
(so `docs/**` is Apache-2.0 and `src/**` is LGPL-3.0-or-later), and validated
both the license id and that the copyright text matched the rule's
`copyright` value; it also had a `--fix` mode and a `--staged` fast path.
loop-lore's `AGENTS.md` mandates an SPDX header on every file. After the
deletion nothing enforces that outside `.plan/*.md`, and even there only half
the header is checked — so headers silently rot across `src/`, `scripts/`,
`docs/`, native sources and configs, with no way to bulk-repair them.
`.githooks/pre-commit:76-87` is warn-only, staged-TS-files-only, and checks the
same single token, so it is not a substitute.

**Acceptance Criteria:**

- [ ] A gate scans every git-tracked file in the consuming repo, not just
      `.plan/` markdown
- [ ] Both `SPDX-License-Identifier` and `SPDX-FileCopyrightText` are required
      in the header region (first lines, after shebang / frontmatter), not
      merely present somewhere in the file
- [ ] Per-path expected license + copyright are configurable (REUSE.toml
      `[[annotations]]` or an equivalent shape)
- [ ] A `--fix` mode applies/replaces headers in place, preserving shebangs and
      YAML frontmatter
- [ ] The existing `.plan/` `spdx` gate keeps working (either delegated to or
      reconciled with the new one)
- [ ] Tests passing
- [ ] Documentation updated
