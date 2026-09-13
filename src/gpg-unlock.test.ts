// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * gpg-unlock cache-contract tests against a real gpg-agent in a throwaway
 * GNUPGHOME (skipped when gpg tooling is unavailable).
 *
 * Pins the two silent-failure modes this module's history had:
 *   - PRESET_PASSPHRASE phantom entries: the agent answers OK and KEYINFO
 *     claims cached=1, but the cancel-mode probe must still report cold.
 *   - A loopback warm must actually populate the agent cache (the historic
 *     "reported successful warmup, no warmup happened" bug).
 *
 * NOTE: tests run in declaration order — the wrong-passphrase case must be
 * evaluated while the cache is still cold (on a warm cache gpg ignores
 * --passphrase and serves the cached one, so a wrong pw would "succeed").
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveCacheTtl, probeCachedPassphrase, warmCacheViaPassphrase } from "./gpg-unlock";

const gpgBin = Bun.which("gpg");
const gpgConnectAgent = Bun.which("gpg-connect-agent");
const KEY_UID = "gpg-unlock-test@example";

function runEnv(args: string[]) {
  return Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", env: process.env });
}

function primaryGrip(): string {
  const out = runEnv(["gpg", "--list-secret-keys", "--with-keygrip", "--with-colons", KEY_UID])
    .stdout.toString("utf8");
  const row = out.split("\n").find((l) => l.startsWith("grp:"));
  const grip = row?.split(":").find((tok) => /^[0-9A-F]{40}$/.test(tok));
  if (!grip) throw new Error(`no keygrip found for ${KEY_UID}`);
  return grip;
}

describe.skipIf(!gpgBin || !gpgConnectAgent)(
  "gpg-unlock cache contract (real agent, temp GNUPGHOME)",
  () => {
    let home: string;

    beforeAll(() => {
      home = mkdtempSync(join(tmpdir(), "gpg-unlock-test-"));
      // pinentry /bin/false: any accidental prompt dies instantly instead of
      // hanging the suite; ttl 30/90 exercises effectiveCacheTtl's min().
      writeFileSync(
        join(home, "gpg-agent.conf"),
        "allow-preset-passphrase\ndefault-cache-ttl 30\nmax-cache-ttl 90\npinentry-program /bin/false\n",
      );
      process.env.GNUPGHOME = home;
      const gen = runEnv([
        "gpg",
        "--batch",
        "--passphrase",
        "testpass",
        "--pinentry-mode",
        "loopback",
        "--quick-generate-key",
        KEY_UID,
        "ed25519",
        "sign",
        "0",
      ]);
      if (gen.exitCode !== 0) throw new Error(gen.stderr.toString("utf8"));
    });

    afterAll(() => {
      if (!home) return;
      Bun.spawnSync(["gpgconf", "--homedir", home, "--kill", "gpg-agent"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      rmSync(home, { recursive: true, force: true });
      delete process.env.GNUPGHOME;
    });

    test("cold cache probes cold", () => {
      expect(probeCachedPassphrase(KEY_UID).warm).toBe(false);
    });

    test("phantom PRESET_PASSPHRASE entry does not fool the probe", () => {
      const grip = primaryGrip();
      const hexExp = (Math.floor(Date.now() / 1000) + 60).toString(16).toUpperCase();
      const preset = runEnv([
        "gpg-connect-agent",
        `PRESET_PASSPHRASE --preset ${grip} -1 ${hexExp}`,
        "/bye",
      ]);
      expect(preset.stdout.toString("utf8").trim()).toBe("OK"); // agent accepted…
      expect(probeCachedPassphrase(KEY_UID).warm).toBe(false); // …but the cache is still cold
    });

    test("effectiveCacheTtl is min(default-cache-ttl, max-cache-ttl)", () => {
      expect(effectiveCacheTtl()).toBe(30);
    });

    test("wrong passphrase fails cleanly while cold", () => {
      const warmed = warmCacheViaPassphrase(KEY_UID, "definitely-wrong");
      expect(warmed.ok).toBe(false);
      expect(warmed.stderrOut).toContain("Bad passphrase");
    });

    test("loopback warm populates the agent cache (verified by probe)", () => {
      const warmed = warmCacheViaPassphrase(KEY_UID, "testpass");
      expect(warmed.ok).toBe(true);
      expect(probeCachedPassphrase(KEY_UID).warm).toBe(true);
    });

    test("unknown key probes cold without hanging", () => {
      expect(probeCachedPassphrase("nosuchkey@example").warm).toBe(false);
    });
  },
);
