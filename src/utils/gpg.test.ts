// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the GPG pre-flight gate (`utils/gpg.ts`).
 *
 * The gate has three ordered checks — fingerprint shape, keyring presence
 * (public then secret), and a cancel-mode trial sign — each with its own
 * `hint:` taxonomy. These tests drive every reachable branch against a real
 * gpg-agent in a throwaway GNUPGHOME (skipped when gpg is unavailable):
 * a generated key covers the cold-cache and warm-cache paths, and a key
 * whose secret half was deleted covers the public-only case.
 *
 * Resource contract: one mkdtemp'd GNUPGHOME per file, killed and removed in
 * afterAll; `process.env.GNUPGHOME` and the shared `credentials` object are
 * saved and restored. No fixed paths, no shared globals left behind.
 *
 * Unreachable with this harness: the `gpgAvailable()`-false branch
 * (`gpg binary not found on PATH`) — Bun.spawnSync resolves executables from
 * the process-startup PATH, so a runtime PATH mutation cannot hide gpg.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeCachedPassphrase, warmCacheViaPassphrase } from "../gpg-unlock";
import { credentials } from "./credentials";
import { assertAgentGpgUnlocked, assertGpgUnlocked } from "./gpg";

const gpgBin = Bun.which("gpg");
const gpgConf = Bun.which("gpgconf");
const KEY_UID = "gpg-assert-test@example";
const PUB_ONLY_UID = "gpg-assert-pubonly@example";
const PASS = "assertpass";

function gpg(args: string[]): { code: number; out: string; err: string; } {
  const r = Bun.spawnSync(["gpg", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  return {
    code: r.exitCode ?? -1,
    out: r.stdout.toString("utf8"),
    err: r.stderr.toString("utf8"),
  };
}

function fingerprint(uid: string): string {
  const out = gpg(["--list-keys", "--with-colons", uid]).out;
  for (const line of out.split("\n")) {
    if (!line.startsWith("fpr:")) continue;
    const token = line.split(":").find((t) => /^[0-9A-F]{40}$/.test(t));
    if (token) return token;
  }
  throw new Error(`no fingerprint found for ${uid}`);
}

function capture(): { text: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const out = spyOn(process.stdout, "write").mockImplementation(push as never);
  const err = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    text: () => chunks.join(""),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

/** Run `fn` with process.exit mocked; capture output even when it exits. */
function runExpectExit(fn: () => void): { code: number | null; out: string; } {
  const cap = capture();
  const originalExit = process.exit;
  let code: number | null = null;
  process.exit = ((c: number) => {
    code = c;
    throw new Error(`__exit:${c}`);
  }) as never;
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("__exit:")) throw error;
  } finally {
    process.exit = originalExit;
  }
  const out = cap.text();
  cap.restore();
  if (code === null) throw new Error("expected process.exit, none happened");
  return { code, out };
}

describe.skipIf(!gpgBin || !gpgConf)("assertGpgUnlocked (real gpg, temp GNUPGHOME)", () => {
  let home: string;
  let fpr: string;
  let fprPubOnly: string;
  let prevGnupg: string | undefined;
  let prevFound: boolean;
  let prevKeyId: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "giwt-gpg-assert-"));
    writeFileSync(
      join(home, "gpg-agent.conf"),
      "default-cache-ttl 30\nmax-cache-ttl 90\npinentry-program /bin/false\n",
    );
    prevGnupg = process.env.GNUPGHOME;
    process.env.GNUPGHOME = home;
    prevFound = credentials.found;
    prevKeyId = credentials.keyId;

    for (const uid of [KEY_UID, PUB_ONLY_UID]) {
      const gen = gpg([
        "--batch",
        "--passphrase",
        PASS,
        "--pinentry-mode",
        "loopback",
        "--quick-generate-key",
        uid,
        "ed25519",
        "sign",
        "0",
      ]);
      if (gen.code !== 0) throw new Error(gen.err);
    }
    fpr = fingerprint(KEY_UID);
    fprPubOnly = fingerprint(PUB_ONLY_UID);
    // Drop the secret half of the second key so the public/secret checks
    // disagree — the case that must report key-not-in-keyring.
    const del = gpg(["--batch", "--yes", "--delete-secret-keys", fprPubOnly]);
    if (del.code !== 0) throw new Error(del.err);
  });

  afterAll(() => {
    if (!home) return;
    Bun.spawnSync(["gpgconf", "--homedir", home, "--kill", "gpg-agent"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    rmSync(home, { recursive: true, force: true });
    if (prevGnupg === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = prevGnupg;
    credentials.found = prevFound;
    credentials.keyId = prevKeyId;
  });

  test("rejects a missing key id as invalid-key", () => {
    const r = runExpectExit(() => assertGpgUnlocked(undefined));
    expect(r.code).toBe(1);
    expect(r.out).toContain("hint: invalid-key");
    expect(r.out).toContain("Expected a 40-char (or 16/8-short) hex fingerprint");
  });

  test("rejects a non-hex key id as invalid-key", () => {
    const r = runExpectExit(() => assertGpgUnlocked("ZZZZZZZZ"));
    expect(r.out).toContain("hint: invalid-key");
  });

  test("rejects ids shorter than 8 or longer than 40 hex chars", () => {
    expect(runExpectExit(() => assertGpgUnlocked("ABC123")).out).toContain("hint: invalid-key");
    expect(runExpectExit(() => assertGpgUnlocked("A".repeat(41))).out).toContain(
      "hint: invalid-key",
    );
  });

  test("reports key-not-in-keyring for a well-formed key that is absent", () => {
    const r = runExpectExit(() => assertGpgUnlocked("DEADBEEFDEADBEEF"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("hint: key-not-in-keyring");
    expect(r.out).toContain("DEADBEEFDEADBEEF is not in the keyring");
  });

  test("reports key-not-unlocked while the passphrase cache is cold", () => {
    expect(probeCachedPassphrase(KEY_UID).warm).toBe(false);
    const r = runExpectExit(() => assertGpgUnlocked(fpr));
    expect(r.code).toBe(1);
    expect(r.out).toContain("hint: key-not-unlocked");
    expect(r.out).toContain("Warm it first: giwt gpg-unlock");
  });

  test("passes without prompting once the cache is warm", () => {
    expect(warmCacheViaPassphrase(KEY_UID, PASS).ok).toBe(true);
    const cap = capture();
    try {
      assertGpgUnlocked(fpr); // must not exit
    } finally {
      cap.restore();
    }
    expect(cap.text()).toBe("");
  });

  test("reports key-not-in-keyring when only the public half is installed", () => {
    const r = runExpectExit(() => assertGpgUnlocked(fprPubOnly));
    expect(r.code).toBe(1);
    expect(r.out).toContain("hint: key-not-in-keyring");
    expect(r.out).toContain(`Secret key for ${fprPubOnly} is not in the keyring`);
  });

  test("assertAgentGpgUnlocked fails when no credentials are loaded", () => {
    credentials.found = false;
    try {
      const r = runExpectExit(() => assertAgentGpgUnlocked());
      expect(r.code).toBe(1);
      expect(r.out).toContain("hint: key-not-in-keyring");
      expect(r.out).toContain("No agent GPG credentials loaded");
    } finally {
      credentials.found = prevFound;
    }
  });

  test("assertAgentGpgUnlocked delegates to the configured warm key", () => {
    credentials.found = true;
    credentials.keyId = fpr;
    const cap = capture();
    try {
      assertAgentGpgUnlocked(); // must not exit
    } finally {
      cap.restore();
      credentials.found = prevFound;
      credentials.keyId = prevKeyId;
    }
    expect(cap.text()).toBe("");
  });
});
