// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt gpg-unlock` — warm and verify the gpg-agent passphrase cache.
 *
 * Command body only; the cache primitives it drives live in
 * src/utils/gpg-cache.ts (see that module for the verified gpg semantics).
 *
 * Usage:
 *   giwt gpg-unlock
 */

import { credentials } from "../utils/credentials";
import {
  effectiveCacheTtl,
  probeCachedPassphrase,
  runSign,
  warmAgentCache,
} from "../utils/gpg-cache";
import { log, raw } from "../utils/output";

// ── Credentials ──────────────────────────────────────────────────

function loadCredentials(): string {
  if (!credentials.keyId) {
    log("error", String("Error: AGENT_GPG_KEY_ID not set in .credentials.env").replace(/\n$/, ""));
    log(
      "error",
      String("Copy .credentials.env.example and fill in your values.").replace(/\n$/, ""),
    );
    process.exit(1);
  }
  return credentials.keyId;
}

// ── CLI ──────────────────────────────────────────────────────────

/** Subcommand entry point (registered in src/cli-registry.ts as `giwt gpg-unlock`). */
export function runGpgUnlock(): void {
  const keyId = loadCredentials();
  const ttl = effectiveCacheTtl();
  raw(`GPG key: ${keyId.slice(0, 8)}... (effective cache TTL ${ttl}s)`);

  if (probeCachedPassphrase(keyId).warm) {
    const sign = runSign(keyId, { mode: "default", timeoutMs: 5_000 });
    if (sign.exitCode === 0 && sign.sigCreated) {
      raw("Cache is warm; TTL re-armed via real sign.");
      process.exit(0);
    }
    log("error", "Warm-cache real sign failed; falling back to cold path.");
    if (sign.stderrOut.trim()) {
      log("error", `gpg stderr: ${sign.stderrOut.trim()}`);
    }
  }

  const warmed = warmAgentCache(keyId, {
    announce: (via) =>
      raw(
        via === "passphrase-source"
          ? "Cache is cold — warming via loopback passphrase source..."
          : "Cache is cold — enter the key passphrase at the pinentry prompt...",
      ),
  });
  if (warmed.via === "none") {
    log(
      "error",
      String("Cache is cold, and this context has no TTY and no passphrase source.").replace(
        /\n$/,
        "",
      ),
    );
    log("error", String("Run `giwt gpg-unlock` in your terminal to warm it.").replace(/\n$/, ""));
    process.exit(1);
  }
  if (warmed.warm) {
    raw("Passphrase cached (verified).");
    process.exit(0);
  }
  if (warmed.via === "passphrase-source") {
    log(
      "error",
      String("Failed — the passphrase source did not warm the cache:").replace(/\n$/, ""),
    );
  } else {
    log(
      "error",
      String("Failed — gpg-agent did not accept a passphrase for this key.").replace(/\n$/, ""),
    );
  }
  if (warmed.stderrOut.trim()) {
    log("error", String(`gpg stderr: ${warmed.stderrOut.trim()}`).replace(/\n$/, ""));
  }
  process.exit(1);
}
