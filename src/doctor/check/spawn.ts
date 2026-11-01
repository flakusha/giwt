// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Bounded subprocess spawning for doctor checks: race a spawn against a
 * time budget and kill the child when the budget wins.
 */

import { capFindings, type CheckFinding } from "./types.ts";

/** Per-check subprocess budget in ms. A wedged child must not hold a
 *  worker slot forever; override via `[doctor] timeout_ms` / `--timeout`. */
export const CHECK_TIMEOUT_DEFAULT_MS = 120_000;

/** Grace window (ms) for merging a killed child's captured streams into its
 *  timeout result. In-group streams close on SIGKILL and settle promptly, but
 *  a process that ESCAPED the killed group (e.g. `setsid sleep 30 &`)
 *  inherits stdout/stderr, so the pipes never reach EOF and the child's
 *  result never settles; past this window the merge falls back to the empty
 *  budget result so the report still returns on time. */
const TIMEOUT_DRAIN_GRACE_MS = 500;

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Set when the budget expired before the child finished. */
  timedOut?: string;
}

export interface SpawnFn {
  (
    cmd: string[],
    cwd: string,
    timeoutMs?: number,
  ): SpawnResult | Promise<SpawnResult>;
}

/** What boundedSpawn accepts as its inner spawn: the public SpawnFn shape, or
 *  a killable handle from a real spawn. Only boundedSpawn ever sees the
 *  handle — it unwraps it, so every run* check still sees a plain SpawnFn. */
type InnerSpawn = SpawnFn | ((cmd: string[], cwd: string, timeoutMs?: number) => SpawnHandle);

function timeoutError(cmd: string[], timeoutMs: number): string {
  return `timed out after ${timeoutMs}ms: ${cmd.join(" ")}`;
}

/** A live child plus the promise for its result. The kill handle must be
 *  reachable *while* the child runs — a result-only shape cannot express it,
 *  because that result is precisely what the budget races against. */
interface SpawnHandle {
  result: Promise<SpawnResult>;
  /** SIGKILL the process group. No-op once the child has exited. */
  kill: () => void;
}

export function defaultSpawn(cmd: string[], cwd: string): SpawnHandle {
  // NOTE: `signal: AbortSignal.timeout(...)` does NOT kill the child on Bun
  // 1.4.2 — measured, not assumed: a `sh` script with `trap ... TERM` and an
  // 8s `sleep` ran to full completion and `proc.exited` resolved 0 at 8002ms
  // with a 500ms signal. So the signal cannot be the kill mechanism.
  //
  // `detached: true` makes the child its own process group leader, so kill()
  // signals the whole group at once (negative pid; proc.pid is the pgid) — a
  // shell wrapper's `sleep` grandchild dies with the group instead of being
  // reparented and leaking.
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd, detached: true });
  const kill = () => {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // ESRCH (already-exited group): fall through to the direct-child no-op.
      try {
        proc.kill(9);
      } catch {
        /* already exited */
      }
    }
  };
  const result = (async () => {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  })();
  return { result, kill };
}

/** Race a spawn against the budget, and KILL the child when the budget wins.
 *
 *  Racing alone only stops *waiting*: the child keeps running, holding CPU,
 *  file handles and (for `bun test`) a lockfile long after the report said it
 *  was done. The report returns on time either way, so a passing test cannot
 *  tell a killed child from an abandoned one — the kill must be explicit.
 *
 *  Injected spawns have no real process and no handle; they still resolve into
 *  a report instead of holding a worker slot, which is the seam's job. */
export function boundedSpawn(raw: InnerSpawn, timeoutMs: number): SpawnFn {
  return (cmd, cwd) => {
    const { promise: budget, resolve: settleBudget } = Promise.withResolvers<SpawnResult>();
    const timer = setTimeout(
      () => settleBudget({ exitCode: -1, stdout: "", stderr: "" }),
      timeoutMs,
    );
    // A real spawn yields a killable handle; an injected one yields a bare
    // result promise with nothing to kill.
    const started = raw(cmd, cwd, timeoutMs) as
      | SpawnResult
      | Promise<SpawnResult>
      | SpawnHandle;
    const handle = typeof started === "object" && started !== null && "result" in started
      ? started
      : undefined;
    const inFlight: Promise<SpawnResult> = handle
      ? handle.result
      : Promise.resolve(started as SpawnResult);
    const { promise: grace, resolve: settleGrace } = Promise.withResolvers<SpawnResult>();
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([inFlight, budget])
      .then(async (res) => {
        if (res.exitCode === -1) {
          handle?.kill();
          // The budget result carries no captured output. In-group streams
          // close on SIGKILL and the killed child's result settles promptly,
          // merging its partial output into the report; a group escaper
          // (setsid …) keeps the pipes open forever, so the merge races the
          // grace timer — its win resolves to the budget result itself,
          // i.e. the pre-merge empty-output timeout semantics.
          graceTimer = setTimeout(() => settleGrace(res), TIMEOUT_DRAIN_GRACE_MS);
          const real = handle ? await Promise.race([inFlight, grace]) : res;
          return { ...real, exitCode: -1, timedOut: timeoutError(cmd, timeoutMs) };
        }
        return res;
      })
      .finally(() => {
        clearTimeout(timer);
        clearTimeout(graceTimer);
      });
  };
}

/** Cap an output tail for error fields (keeps JSON reports small). */
export function tail(text: string, max = 500): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `…${clean.slice(-max)}` : clean;
}

export function toFindings(
  items: Array<{ file: string; line: number; rule: string; message: string; error: boolean; }>,
): { findings: CheckFinding[]; findingsTotal?: number; } {
  return capFindings(items.map((f) => ({
    file: f.file,
    line: f.line,
    rule: f.rule,
    message: f.message,
    severity: f.error ? ("error" as const) : ("warning" as const),
    kind: f.error ? ("bug" as const) : ("task" as const),
  })));
}
