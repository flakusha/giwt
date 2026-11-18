// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * giwt identity → jj `[signing]` config. jj ignores git config, so the git
 * `commit.gpgsign`/`user.signingkey` funnel cannot reach it. Config is written
 * through `jj config set --repo` (not a `--config` override, which policy blocks).
 */

import type { WorktreeConfig } from "../utils/config";
import { log } from "../utils/output";
import { defaultJjSpawn, type JjSpawn } from "../vcs/jj";

export interface JjSigningIdentity {
  keyId?: string;
  name?: string;
  email?: string;
}

/** Config entries in `jj config set --repo <key> <toml-value>` order. */
export function jjSigningEntries(
  { keyId, name, email }: JjSigningIdentity,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (keyId !== undefined && keyId !== "") {
    // JSON.stringify emits a TOML-compatible basic string (incl. escaping).
    entries.push(
      ["signing.behavior", "\"own\""],
      ["signing.backend", "\"gpg\""],
      ["signing.key", JSON.stringify(keyId)],
    );
  }
  if (name !== undefined && name !== "") entries.push(["user.name", JSON.stringify(name)]);
  if (email !== undefined && email !== "") entries.push(["user.email", JSON.stringify(email)]);
  return entries;
}

export function configureJjSigning({
  config,
  spawn = defaultJjSpawn,
}: {
  config: WorktreeConfig;
  spawn?: JjSpawn;
}): void {
  if (
    config.agentGpgKeyId === undefined && config.agentGpgName === undefined
    && config.agentGpgEmail === undefined
  ) {
    log("warn", "no agent identity configured — skipping jj signing config");
    return;
  }
  setJjSigningIdentity({
    root: config.repoRoot,
    identity: {
      ...(config.agentGpgKeyId !== undefined ? { keyId: config.agentGpgKeyId } : {}),
      ...(config.agentGpgName !== undefined ? { name: config.agentGpgName } : {}),
      ...(config.agentGpgEmail !== undefined ? { email: config.agentGpgEmail } : {}),
    },
    spawn,
  });
  log("success", "jj signing identity configured from agent credentials");
}

export function setJjSigningIdentity({
  root,
  identity,
  spawn = defaultJjSpawn,
}: {
  root: string;
  identity: JjSigningIdentity;
  spawn?: JjSpawn;
}): void {
  for (const [key, value] of jjSigningEntries(identity)) {
    const result = spawn(["jj", "config", "set", "--repo", key, value], root);
    if (result.exitCode !== 0) {
      throw new Error(
        `jj config set ${key} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
      );
    }
  }
}
