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

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  effectiveCacheTtl,
  probeCachedPassphrase,
  runGpgUnlock,
  warmCacheViaPassphrase,
} from "./gpg-unlock";
import { credentials } from "./utils/credentials";

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

// ── runGpgUnlock CLI ─────────────────────────────────────────────
//
// The CLI entry point owns the decision tree: which warm-up channel is
// chosen (loopback passphrase source vs. pinentry vs. honest refusal),
// what it reports, and the exit code. These cases drive the real command
// against a dedicated throwaway agent so the cache transitions are real.
//
// Resource contract: own mkdtemp'd GNUPGHOME + HOME, own generated key;
// every env var and the shared `credentials` object are saved and restored
// in beforeAll/afterAll. Each cache-sensitive case cools the agent first
// (gpgconf --kill) so it does not depend on declaration order.

describe.skipIf(!gpgBin || !gpgConnectAgent)(
  "runGpgUnlock CLI (real agent, temp GNUPGHOME)",
  () => {
    const CLI_UID = "gpg-unlock-cli@example";
    const CLI_PASS = "clipass";

    let home: string;
    let passHome: string;
    let prevGnupg: string | undefined;
    let prevHome: string | undefined;
    let prevUserProfile: string | undefined;
    let prevGitPass: string | undefined;
    let prevKeyId: string;
    let prevFound: boolean;
    let prevTTY: boolean | undefined;

    function killAgent(): void {
      Bun.spawnSync(["gpgconf", "--homedir", home, "--kill", "gpg-agent"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    }

    /** Run runGpgUnlock with process.exit mocked and output captured. */
    function runCli(): { code: number | null; out: string; } {
      const chunks: string[] = [];
      const push = (chunk: unknown): boolean => {
        chunks.push(String(chunk));
        return true;
      };
      const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
      const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
      const originalExit = process.exit;
      let code: number | null = null;
      process.exit = ((c: number) => {
        code = c;
        throw new Error(`__exit:${c}`);
      }) as never;
      try {
        runGpgUnlock();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith("__exit:")) throw error;
      } finally {
        process.exit = originalExit;
        outSpy.mockRestore();
        errSpy.mockRestore();
      }
      if (code === null) throw new Error("expected process.exit, none happened");
      return { code, out: chunks.join("") };
    }

    beforeAll(() => {
      home = mkdtempSync(join(tmpdir(), "giwt-gpg-unlock-cli-"));
      passHome = mkdtempSync(join(tmpdir(), "giwt-gpg-unlock-home-"));
      writeFileSync(
        join(home, "gpg-agent.conf"),
        "default-cache-ttl 30\nmax-cache-ttl 90\npinentry-program /bin/false\n",
      );
      prevGnupg = process.env.GNUPGHOME;
      prevHome = process.env.HOME;
      prevUserProfile = process.env.USERPROFILE;
      prevGitPass = process.env.GIT_GPG_PASSPHRASE;
      process.env.GNUPGHOME = home;
      // Both a TTY-less context and the loopback path must resolve the same
      // passphrase file; point HOME at an empty dir so the developer's real
      // ~/.gpg-passphrase can never leak into a case.
      process.env.HOME = passHome;
      delete process.env.GIT_GPG_PASSPHRASE;
      prevKeyId = credentials.keyId;
      prevFound = credentials.found;
      credentials.keyId = CLI_UID;
      credentials.found = true;
      prevTTY = process.stdin.isTTY;

      const gen = runEnv([
        "gpg",
        "--batch",
        "--passphrase",
        CLI_PASS,
        "--pinentry-mode",
        "loopback",
        "--quick-generate-key",
        CLI_UID,
        "ed25519",
        "sign",
        "0",
      ]);
      if (gen.exitCode !== 0) throw new Error(gen.stderr.toString("utf8"));
    });

    afterAll(() => {
      if (home) {
        killAgent();
        rmSync(home, { recursive: true, force: true });
      }
      if (passHome) rmSync(passHome, { recursive: true, force: true });
      if (prevGnupg === undefined) delete process.env.GNUPGHOME;
      else process.env.GNUPGHOME = prevGnupg;
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      if (prevGitPass === undefined) delete process.env.GIT_GPG_PASSPHRASE;
      else process.env.GIT_GPG_PASSPHRASE = prevGitPass;
      credentials.keyId = prevKeyId;
      credentials.found = prevFound;
      process.stdin.isTTY = prevTTY as never;
    });

    test("exits 1 when no key id is configured", () => {
      credentials.keyId = "";
      try {
        const r = runCli();
        expect(r.code).toBe(1);
        expect(r.out).toContain("Error: AGENT_GPG_KEY_ID not set in .credentials.env");
        expect(r.out).toContain("Copy .credentials.env.example and fill in your values.");
      } finally {
        credentials.keyId = CLI_UID;
      }
    });

    test("cold cache with no TTY and no passphrase source refuses and exits 1", () => {
      killAgent();
      process.stdin.isTTY = false as never;
      const r = runCli();
      expect(r.code).toBe(1);
      expect(r.out).toContain("GPG key: gpg-unlo...");
      expect(r.out).toContain("no TTY and no passphrase source");
      expect(r.out).toContain("Run `giwt gpg-unlock` in your terminal to warm it.");
    });

    test("a wrong loopback passphrase exits 1 and surfaces gpg stderr", () => {
      killAgent();
      process.env.GIT_GPG_PASSPHRASE = "definitely-wrong";
      try {
        const r = runCli();
        expect(r.code).toBe(1);
        expect(r.out).toContain("warming via loopback passphrase source");
        expect(r.out).toContain("Failed — the passphrase source did not warm the cache");
        expect(r.out).toContain("gpg stderr:");
        expect(r.out).toContain("Bad passphrase");
      } finally {
        delete process.env.GIT_GPG_PASSPHRASE;
      }
    });

    test("warms via GIT_GPG_PASSPHRASE and exits 0", () => {
      killAgent();
      process.env.GIT_GPG_PASSPHRASE = CLI_PASS;
      const r = runCli();
      expect(r.code).toBe(0);
      expect(r.out).toContain("warming via loopback passphrase source");
      expect(r.out).toContain("Passphrase cached (verified).");
    });

    test("re-running on a warm cache re-arms and exits 0", () => {
      const r = runCli();
      expect(r.code).toBe(0);
      expect(r.out).toContain("Cache is warm (verified by silent sign)");
    });

    test("TTY path with a failing pinentry exits 1", () => {
      killAgent();
      delete process.env.GIT_GPG_PASSPHRASE;
      process.stdin.isTTY = true as never;
      try {
        const r = runCli();
        expect(r.code).toBe(1);
        expect(r.out).toContain("enter the key passphrase at the pinentry prompt");
        expect(r.out).toContain("Failed — gpg-agent did not accept a passphrase for this key");
        expect(r.out).toContain("gpg stderr:");
      } finally {
        process.stdin.isTTY = false as never;
      }
    });

    test("reads ~/.gpg-passphrase when GIT_GPG_PASSPHRASE is absent", () => {
      killAgent();
      delete process.env.GIT_GPG_PASSPHRASE;
      writeFileSync(join(passHome, ".gpg-passphrase"), `${CLI_PASS}\n`);
      const r = runCli();
      expect(r.code).toBe(0);
      expect(r.out).toContain("warming via loopback passphrase source");
      expect(r.out).toContain("Passphrase cached (verified).");
    });

    test("unreadable ~/.gpg-passphrase falls back to the no-source refusal", () => {
      killAgent();
      rmSync(join(passHome, ".gpg-passphrase"), { force: true });
      mkdirSync(join(passHome, ".gpg-passphrase"));
      process.stdin.isTTY = false as never;
      const r = runCli();
      expect(r.code).toBe(1);
      expect(r.out).toContain("no TTY and no passphrase source");
    });

    test("no HOME/USERPROFILE: passphrase source is absent and TTL uses the /tmp fallback", () => {
      killAgent();
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      delete process.env.GNUPGHOME;
      process.stdin.isTTY = false as never;
      try {
        const r = runCli();
        expect(r.code).toBe(1);
        expect(r.out).toContain("no TTY and no passphrase source");
        const ttl = effectiveCacheTtl();
        expect(Number.isFinite(ttl)).toBe(true);
        expect(ttl).toBeGreaterThanOrEqual(0);
      } finally {
        process.env.HOME = passHome;
        process.env.GNUPGHOME = home;
      }
    });

    test("TTY path warms via the configured pinentry and exits 0", () => {
      // A scripted pinentry answers GETPIN with the passphrase, so the real
      // default-mode sign succeeds and the agent cache ends up warm.
      const fakePinentry = join(passHome, "fake-pinentry.sh");
      const script = [
        "#!/bin/sh",
        "echo \"OK Pleased to meet you\"",
        "while IFS= read -r line; do",
        "  cmd=$(printf '%s' \"$line\" | cut -d' ' -f1)",
        "  case \"$cmd\" in",
        `    GETPIN) echo "D ${CLI_PASS}"; echo "OK" ;;`,
        "    BYE) echo \"OK\"; exit 0 ;;",
        "    *) echo \"OK\" ;;",
        "  esac",
        "done",
        "",
      ].join("\n");
      writeFileSync(fakePinentry, script);
      chmodSync(fakePinentry, 0o755);
      writeFileSync(
        join(home, "gpg-agent.conf"),
        `default-cache-ttl 30\nmax-cache-ttl 90\npinentry-program ${fakePinentry}\n`,
      );
      killAgent();
      delete process.env.GIT_GPG_PASSPHRASE;
      process.stdin.isTTY = true as never;
      try {
        const r = runCli();
        expect(r.code).toBe(0);
        expect(r.out).toContain("enter the key passphrase at the pinentry prompt");
        expect(r.out).toContain("Passphrase cached (verified).");
      } finally {
        process.stdin.isTTY = false as never;
      }
    });
  },
);

// ── effectiveCacheTtl config parsing ─────────────────────────────

describe("effectiveCacheTtl config parsing (temp GNUPGHOME)", () => {
  test("missing config falls back to default-cache-ttl 600", () => {
    const home = mkdtempSync(join(tmpdir(), "giwt-gpg-ttl-none-"));
    const prev = process.env.GNUPGHOME;
    process.env.GNUPGHOME = home;
    try {
      expect(effectiveCacheTtl()).toBe(600);
    } finally {
      if (prev === undefined) delete process.env.GNUPGHOME;
      else process.env.GNUPGHOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("last occurrence wins and inline comments are ignored", () => {
    const home = mkdtempSync(join(tmpdir(), "giwt-gpg-ttl-conf-"));
    const prev = process.env.GNUPGHOME;
    process.env.GNUPGHOME = home;
    writeFileSync(
      join(home, "gpg-agent.conf"),
      "# tuning\ndefault-cache-ttl 120 # first\ndefault-cache-ttl 77\nmax-cache-ttl 55\n",
    );
    try {
      expect(effectiveCacheTtl()).toBe(55);
    } finally {
      if (prev === undefined) delete process.env.GNUPGHOME;
      else process.env.GNUPGHOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("default-cache-ttl caps below max-cache-ttl", () => {
    const home = mkdtempSync(join(tmpdir(), "giwt-gpg-ttl-min-"));
    const prev = process.env.GNUPGHOME;
    process.env.GNUPGHOME = home;
    writeFileSync(join(home, "gpg-agent.conf"), "default-cache-ttl 40\nmax-cache-ttl 900\n");
    try {
      expect(effectiveCacheTtl()).toBe(40);
    } finally {
      if (prev === undefined) delete process.env.GNUPGHOME;
      else process.env.GNUPGHOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
