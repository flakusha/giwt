<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: ticket index sync spends 3074 subprocess spawns on a single batched git cat-file --batch-check

**Status:** Not Started
**Priority:** medium
**Effort:** Medium

**Summary:**

`giwt sync`'s hash-provenance pass spawns one `git cat-file` process per index
entry. On loop-lore's ticket index that is **3074 subprocess spawns** to learn
that only **19** of them are real commits. A single `git cat-file --batch-check`
over the same refs does the whole job in **77ms** — an **89x** speedup.

## Current code

`src/tickets/sync-ticket.ts:186-194`:

```ts
export function gitObjectExists(ref: string): boolean {
  if (!/^[0-9a-f]{7,40}$/.test(ref)) return false;
  try {
    execSync(`git cat-file -e ${ref}^{commit} 2>/dev/null`, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
```

One `execSync` per call, and it does not pin `cwd` — the lookup silently
depends on the process working directory, which is itself a latent bug for any
caller that resolves a `root` different from `process.cwd()`.

Two call sites, both inside the per-entry loop at
`src/tickets/sync-ticket.ts:281-299`:

- `:285` — `if (entry.commitHash && gitObjectExists(entry.commitHash)) continue;`
- `:292` — `if (gitObjectExists(entry.hash)) continue;`

The loop head is `for (const [extid, entry] of Object.entries(index))`, i.e. one
iteration per index entry.

## Measured (loop-lore, re-measured 2026-10-02)

`.plan/tickets/index.json`: **3127 entries, 3074 distinct hex refs**
(every `entry.commitHash` plus every `entry.hash !== "pending"`).

| path | wall time | real commits found |
| --- | --- | --- |
| per-call `execSync` (current) | **6908ms** | 19 |
| one `execFileSync("git", ["cat-file","--batch-check"])` over stdin | **77ms** | 19 |

**89x**. Same answer, same 19.

## Semantics verified equivalent, not assumed

Probing both paths with the same three refs against loop-lore:

| ref | per-call (`git cat-file -e <ref>^{commit}`) | `--batch-check` stdout |
| --- | --- | --- |
| `4b963ed39` (HEAD, a commit) | exit 0 → EXISTS | `4b963ed39aaa49662e6fa5d9621ada5c263611b0 commit 627` |
| `eb5c1129c` (a blob) | exit 128 → absent | `eb5c1129c^{commit} missing` |
| `deadbee` (nonexistent) | exit 128 → absent | `deadbee^{commit} missing` |

A `missing` line on stdout is exactly equivalent to today's non-zero exit, and
the `^{commit}` peel is preserved (a blob peels to `missing`, matching the
current per-call behaviour). Note `--batch-check` also writes an
`error: ... expected commit type` line to **stderr** for the blob case — the
stdout verdict is still `missing`, so read stdout only.

## The cost is paid twice

Both loop-lore gates invoke the same `runSync`:

- `scripts/check-parallel.mjs:311` — `"plan - ticket index (sync)": "bun run plan:sync"`
- `scripts/check-parallel.mjs:315` — `"plan - validate": "bun run plan:validate"`, whose
  `tickets` gate is `checkTicketIndex` at `giwt/src/plan/validate.ts:494-504`,
  calling `runSync(worktreeRoot, { fix: false, verbose: false, ticketsPath })`.

So per `giwt finalize` that is roughly **~6100 spawns ≈ 14s** of pure local
process-spawn latency inside the plan machinery.

**Network is not the bottleneck** — `git issue` is not installed on this host,
so that whole path is inert. The cost is entirely local `fork`/`exec` +
`cat-file` per ref.

## Proposed fix

1. Leave `gitObjectExists` exactly as-is. It is exported
   (`src/index.ts` public surface) and unit-tested at
   `src/tickets/sync-ticket-index.test.ts:56-71`; keeping it as the single-ref
   fallback means those tests keep passing untouched and the public export is
   not broken.
2. Before the hash-provenance loop, collect the **distinct** set of candidate
   refs and issue **one**:

   ```ts
   execFileSync("git", ["cat-file", "--batch-check"], {
     input: refs.map((r) => `${r}^{commit}`).join("\n") + "\n",
     cwd: root,
   })
   ```

   `root` is already a parameter of `reconcile` (`sync-ticket.ts:198-204`) and is
   currently unused by the hash lookup — so this needs **no signature change**
   and simultaneously fixes the cwd-coupling defect above.
3. Build `Map<ref, boolean>` keyed on the **input token** (the bare hash, not the
   `^{commit}`-suffixed token that `--batch-check` echoes back on the `missing`
   line), and swap both call sites to a local `resolver(ref)` that reads the map
   and falls back to `gitObjectExists(ref)` for any ref not in it. The
   `/^[0-9a-f]{7,40}$/` prefilter must be preserved either as a pre-pass filter
   or inside the resolver, so junk never reaches the batch input.
4. Match stdout lines positionally to the input array (one line out per line
   in) rather than parsing the trailing token.

## Alternatives considered and rejected

- `git cat-file --batch-all-objects` — inventories the whole ODB; wrong shape,
  unbounded output, and still needs per-ref filtering.
- `git rev-parse --verify` per hash — same one-spawn-per-hash problem.
- Reading `.git/objects` directly — reimplements loose **and** packed lookup,
  packfile index parsing included. Strictly worse than asking git.

## Acceptance

- `reconcile()` produces an identical `SyncReport` (compare
  `placeholderHashes` / `hashMismatches` / `missingHashes` field-for-field)
  before and after.
- `gitObjectExists` remains exported and its existing tests are unmodified.
- The `tickets` gate timing on loop-lore drops by ~7s per invocation.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
