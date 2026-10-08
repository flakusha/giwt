// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Central funnel for giwt's own lifecycle `git config` WRITES.
 *
 * Every runtime config write giwt performs (GPG signing setup, hooksPath
 * installs, pull.ff/branch.*.rebase in doctor apply) MUST go through
 * `gitConfigSet` so that:
 *   - each write is logged with key, value, and its lifecycle reason;
 *   - the write lands in the active run record (events.jsonl) when one is
 *     open — giwt child processes are invisible to the harness's raw
 *     `git config` guard, so giwt gates itself;
 *   - refusal mode (below) blocks the write with a remedy naming the switch.
 *
 * Refusal switch (first match wins):
 *   1. env `GIWT_FORBID_CONFIG_WRITES=1` — forces refusal (wins over files)
 *   2. `[git] config_writes = "refuse"` in giwt.toml (settings layer)
 *   3. default: "allow"
 *
 * Exemption: the generated `.install.sh` (src/doctor/generators/hooks.ts)
 * keeps its raw `git config core.hooksPath` line — bootstrap scripts are
 * user-run setup, sanctioned by the governing policy, not agent actions.
 */

import { gitSync } from "./git";
import { log, raw } from "./output";
import { activeRun } from "./runlog";
import { type ConfigWritesMode, DEFAULT_SETTINGS, loadSettings } from "./settings";

/** Env override that forces refusal regardless of the settings layer. */
export const CONFIG_WRITES_ENV = "GIWT_FORBID_CONFIG_WRITES";

const CONFIG_WRITES_MODES: Record<ConfigWritesMode, true> = { "allow": true, "refuse": true };

/**
 * Resolve the effective config-write mode from a settings snapshot. The env
 * override wins over files; a value outside the enum falls back to the
 * default (loadSettings already hard-errors on it — belt and braces).
 */
export function resolveConfigWritesMode(settings = DEFAULT_SETTINGS): ConfigWritesMode {
  if (process.env[CONFIG_WRITES_ENV] === "1") return "refuse";
  const mode = settings.git.configWrites;
  return mode in CONFIG_WRITES_MODES ? mode : DEFAULT_SETTINGS.git.configWrites;
}

export interface GitConfigSetEntry {
  key: string;
  value: string;
}

interface GitConfigSetOptions {
  /** Repo/worktree root the config write applies to. */
  root: string;
  /** Key/value pairs to write (one `git config` invocation each). */
  entries: readonly GitConfigSetEntry[];
  /** Lifecycle reason logged with the write (e.g. "gpg signing setup"). */
  reason: string;
  /** Pre-resolved mode; omit to resolve env + settings at call time. */
  mode?: ConfigWritesMode;
}

/**
 * Write git config entries through the lifecycle funnel. Refuses (exit 1)
 * when config writes are forbidden; the refusal message names both the
 * setting and the env override.
 */
export function gitConfigSet({ root, entries, reason, mode }: GitConfigSetOptions): void {
  const effective = mode ?? resolveConfigWritesMode(loadSettings(root));
  if (effective === "refuse") {
    const keys = entries.map((e) => e.key).join(", ");
    log("error", `git config write refused (${reason}): ${keys}`);
    raw(
      `  Lifecycle config writes are forbidden — set [git] config_writes = "allow"`
        + ` in giwt.toml or unset ${CONFIG_WRITES_ENV}.`,
    );
    process.exit(1);
  }
  for (const { key, value } of entries) {
    gitSync(root, "config", key, value);
    log("info", `git config: ${key} = ${value} (${reason})`);
  }
  activeRun()?.event(
    "git-config",
    "ok",
    `${reason}: ${entries.map((e) => `${e.key}=${e.value}`).join("; ")}`,
  );
}
