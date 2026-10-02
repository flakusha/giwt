// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { join } from "node:path";
import {
  buildMap,
  findOwners,
  findStale,
  readMap,
  verifyFresh,
  writeMap,
} from "../../plan/code-map";
import { resolveFromRoot } from "../../plan/validate";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";

/** Build map sources using the configured planDir instead of hardcoded .plan */
export function mapSourcesFor(planDir: string): Array<{ dir: string; kind: string; }> {
  return [
    { dir: `${planDir}/tickets`, kind: "ticket" },
    { dir: `${planDir}/epics`, kind: "epic" },
    { dir: "docs/spec", kind: "spec" },
    { dir: "docs/frontend", kind: "frontend" },
  ];
}

export async function runCodeMap(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const isCheck = args.includes("--check");
  const findIdx = args.indexOf("--find");
  const hasFind = findIdx >= 0;
  const staleFlag = args.includes("--stale");
  const isHelp = args.includes("--help") || args.includes("-h");

  const unknown = args.filter(
    (a) =>
      a !== "--check" && a !== "--find" && a !== "--stale"
      && a !== "--help" && a !== "-h",
  );
  if (
    (unknown.length > 0 && !hasFind) || isHelp
    || (hasFind && unknown.length > 1)
  ) {
    raw("Usage: giwt plan code-map [--check] [--find <path>] [--stale]");
    raw("  Build/check/query reverse code→plan index");
    raw("  --check     verify committed index matches fresh rebuild (CI gate)");
    raw("  --find <p>  query owners of a src/ path");
    raw("  --stale     report src refs whose file no longer exists");
    process.exit(isHelp ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const mapPath = join(planDir, "code-map.json");
  const map = buildMap(config.worktreeRoot, mapSourcesFor(config.settings.paths.planDir));

  if (hasFind) {
    const queryPath = args[findIdx + 1];
    if (!queryPath) {
      log("error", "--find requires a path argument");
      process.exit(1);
    }
    const existing = readMap(mapPath);
    const { exact, prefix } = findOwners(existing, queryPath);
    if (exact.length > 0) {
      raw(queryPath);
      for (const e of exact) {
        raw(`  [${e.kind}] ${e.source}`);
      }
    } else if (prefix.length > 0) {
      raw(`${queryPath} (directory - ${prefix.length} nested path(s) referenced)`);
      for (const { path, entries } of prefix) {
        raw(`  ${path}`);
        for (const e of entries) {
          raw(`    [${e.kind}] ${e.source}`);
        }
      }
    } else {
      raw(`${queryPath} - not referenced by any plan/spec`);
    }
    return;
  }

  // --check is a CI gate: must NOT modify the working tree
  if (!isCheck) {
    writeMap(mapPath, map);
    log("info", `wrote ${mapPath} (${Object.keys(map).length} src paths)`);
  }

  if (isCheck) {
    if (!verifyFresh(mapPath, map)) {
      log("error", "code-map.json is stale — run `giwt plan code-map` to regenerate");
      process.exit(1);
    }
    log("success", "OK - code map is up to date");
  } else if (staleFlag) {
    const stale = findStale(config.worktreeRoot, map);
    if (stale.length > 0) {
      for (const s of stale) {
        log("warn", `stale src ref: ${s}`);
      }
      log(
        "warn",
        `${stale.length} stale src reference(s) - advisory (future/renamed files)`,
      );
    } else {
      log("success", "OK - all src references resolve");
    }
  }
}
