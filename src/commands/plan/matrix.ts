// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { genMatrix, matrixOutput } from "../../plan/feature-matrix";
import { resolveFromRoot } from "../../plan/validate";
import type { WorktreeConfig } from "../../utils/config";
import { parseOutFlags, renderRecords } from "../../utils/emit";
import { log, raw } from "../../utils/output";

export async function runMatrix(args: string[], config: WorktreeConfig): Promise<void> {
  const isCheck = args.includes("--check");
  const { format } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  const cooccurrence = args.includes("--cooccurrence");
  const unknown = args.filter(
    (a) =>
      a !== "--help" && a !== "-h" && a !== "--check"
      && a !== "--json" && a !== "--toml" && a !== "--emoji"
      && a !== "--cooccurrence",
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan matrix [--check] [--json|--toml|--emoji] [--cooccurrence]");
    raw("  Generate .plan/feature-matrix.md from the ticket index");
    raw("  --check          verify committed matrix matches fresh rebuild (CI gate)");
    raw(
      "  --json           print the matrix as JSON on stdout (no file write; --toml/--emoji also supported)",
    );
    raw("  --cooccurrence   append the tag×tag co-occurrence section");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }
  if (isCheck && format !== "human") {
    log("error", "--check and --json/--toml/--emoji are mutually exclusive");
    process.exit(1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const indexPath = join(planDir, "tickets", "index.json");
  const outPath = join(planDir, "feature-matrix.md");

  if (isCheck) {
    if (!existsSync(outPath)) {
      log("error", "feature-matrix.md missing — run `giwt plan matrix` to generate");
      process.exit(1);
    }
    // matrixOutput throws on a missing/corrupt index — main() catches and
    // reports with the path named, keeping stdout clean for pipelines.
    const fresh = matrixOutput(indexPath, { cooccurrence });
    if (readFileSync(outPath, "utf8") !== fresh.output) {
      log("error", "feature-matrix.md is stale — run `giwt plan matrix` to regenerate");
      process.exit(1);
    }
    log("success", `OK - feature-matrix.md is up to date (${fresh.matrix.total} tickets)`);
    return;
  }

  if (format !== "human") {
    const { matrix } = matrixOutput(indexPath, { cooccurrence });
    raw(renderRecords(matrix, format, {
      emoji: (record) => {
        const m = record as {
          total: number;
          byTag: Array<{ key: string; total: number; }>;
          untagged: number;
          unbound: number;
        };
        return `📊 total: ${m.total} · tags: ${m.byTag.length}`
          + ` · untagged: ${m.untagged} · unbound: ${m.unbound}`;
      },
    }));
    process.exitCode = 0;
    return;
  }

  const { matrix } = genMatrix(indexPath, outPath, { cooccurrence });
  log("success", `wrote ${outPath} (${matrix.total} tickets)`);
}
