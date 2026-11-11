// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pijul dogfood event backend (`[intercom] backend = "pijul"`).
 *
 * A dedicated pijul repo lives at `<store>/pijul/` (init at init time).
 * One event = one file `pijul/events/<seq>.json` recorded as one change:
 * append = `pijul add` + `pijul record -m "intercom: <seq> …"` (the printed
 * `Hash:` line is the change id, kept in `<store>/events-map.json`).
 * list = `pijul log --output-format json` (messages carry the seq; content
 * comes from the event files). Retire = `pijul unrecord` of the mapped
 * change ids (explicit ids only, never the interactive picker), then the
 * survivors are re-recorded — unrecord requires dependents in the same
 * operation, so a keep-the-tail compaction must unrecord the whole event
 * chain and re-record the newest `keep` events (working copy survives).
 *
 * Guards: `pijul --version` must parse >= 1.0.0-beta.24 (refuse with the
 * floor named); a failed record prints ONE remedy line
 * (`ssh-add <key>` + `pijul identity new` once) — `-m` everywhere, no
 * editor is ever opened. The default jsonl flow never touches this module.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventRead, IntercomBackendImpl, IntercomEvent, IntercomEventDraft } from "./types";

export const PIJUL_VERSION_FLOOR = "1.0.0-beta.24";
/** Store layout constants for the pijul dogfood backend. */
export const PIJUL_DIR = "pijul";
export const EVENTS_MAP = "events-map.json";
const INTERCOM_MSG = "intercom:";

export interface PijulVersion {
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

/** Parse `pijul 1.0.0-beta.24`; null when the output is unrecognized. */
export function parsePijulVersion(output: string): PijulVersion | null {
  const m = /pijul\s+(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(output);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    beta: m[4] === undefined ? null : Number(m[4]),
  };
}

/** True when `v` is at least the parsed floor (stable > beta; beta N by N). */
export function meetsVersionFloor(v: PijulVersion, floor: PijulVersion): boolean {
  const base = [v.major, v.minor, v.patch];
  const floorBase = [floor.major, floor.minor, floor.patch];
  for (let i = 0; i < 3; i++) {
    if (base[i]! !== floorBase[i]!) return base[i]! > floorBase[i]!;
  }
  if (v.beta === null) return true; // stable beats any prerelease
  if (floor.beta === null) return false;
  return v.beta >= floor.beta;
}

/** Spawn seam (tests stub without subprocesses). */
export type PijulSpawn = (
  cmd: string[],
  cwd: string,
) => { stdout: string; stderr: string; exitCode: number; };

const defaultSpawn: PijulSpawn = (cmd, cwd) => {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
};

export interface PijulBackendOpts {
  spawn?: PijulSpawn;
  /** Binary name/path override (tests point it at a stub). */
  bin?: string;
}

function checkVersion(spawn: PijulSpawn, bin: string): void {
  const probe = spawn([bin, "--version"], ".");
  const parsed = parsePijulVersion(probe.stdout);
  if (probe.exitCode !== 0 || parsed === null) {
    throw new Error(
      `[intercom] backend pijul: cannot parse '${bin} --version' output — is pijul installed?`,
    );
  }
  if (!meetsVersionFloor(parsed, parsePijulVersion(`pijul ${PIJUL_VERSION_FLOOR}`)!)) {
    throw new Error(
      `[intercom] backend pijul: found ${parsed.major}.${parsed.minor}.${parsed.patch}`
        + `${
          parsed.beta === null ? "" : `-beta.${parsed.beta}`
        }, need >= ${PIJUL_VERSION_FLOOR} — upgrade pijul`,
    );
  }
}

function remedy(error: string): Error {
  return new Error(
    `[intercom] pijul record failed: ${error} — load a key once: 'ssh-add <key>' and 'pijul identity new'`,
  );
}

function pijulDir(storeDir: string): string {
  return join(storeDir, PIJUL_DIR);
}

function eventsDir(storeDir: string): string {
  return join(pijulDir(storeDir), "events");
}

function mapPath(storeDir: string): string {
  return join(storeDir, EVENTS_MAP);
}

/** event seq -> pijul change hash. */
function readMap(storeDir: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(mapPath(storeDir), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMap(storeDir: string, map: Record<string, string>): void {
  writeFileSync(mapPath(storeDir), `${JSON.stringify(map, null, 2)}\n`);
}

function eventFile(storeDir: string, seq: number): string {
  return join(eventsDir(storeDir), `${seq}.json`);
}

/** Backend factory; each instance carries its own spawn seam. */
export function backendPijul(opts: PijulBackendOpts = {}): IntercomBackendImpl {
  const spawn = opts.spawn ?? defaultSpawn;
  const bin = opts.bin ?? "pijul";

  function run(cmd: string[], cwd: string, what: string): string {
    const out = spawn([bin, ...cmd], cwd);
    if (out.exitCode !== 0) {
      const detail = (out.stderr || out.stdout).trim().slice(0, 200);
      if (what === "record") throw remedy(detail);
      throw new Error(`[intercom] pijul ${what} failed: ${detail}`);
    }
    return out.stdout;
  }

  return {
    name: "pijul",

    initStore(storeDir: string): void {
      checkVersion(spawn, bin);
      if (existsSync(join(pijulDir(storeDir), ".pijul"))) return; // idempotent
      mkdirSync(pijulDir(storeDir), { recursive: true });
      run(["init"], pijulDir(storeDir), "init");
    },

    appendEvent(storeDir: string, draft: IntercomEventDraft): IntercomEvent {
      const map = readMap(storeDir);
      const seq = Object.keys(map).length + 1;
      const event: IntercomEvent = {
        ...draft,
        v: 1,
        ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        seq,
      };
      mkdirSync(eventsDir(storeDir), { recursive: true });
      const rel = join("events", `${seq}.json`);
      writeFileSync(join(pijulDir(storeDir), rel), `${JSON.stringify(event)}\n`);
      run(["add", rel], pijulDir(storeDir), "add");
      const subject = `${INTERCOM_MSG} ${seq} ${draft.type} ${draft.lane}`;
      const out = run(["record", "-m", subject], pijulDir(storeDir), "record");
      const hash = /Hash:\s*([A-Z0-9]+)/.exec(out)?.[1];
      if (hash === undefined) {
        throw new Error(`[intercom] pijul record printed no Hash line — cannot map event ${seq}`);
      }
      map[String(seq)] = hash;
      writeMap(storeDir, map);
      return event;
    },

    readEvents(storeDir: string): EventRead {
      // List = pijul log (identity + order); content = the event files.
      if (!existsSync(pijulDir(storeDir))) return { events: [], malformed: 0 };
      const log = run(["log", "--output-format", "json"], pijulDir(storeDir), "log");
      let parsed: Array<{ hash: string; message: string; }>;
      try {
        parsed = JSON.parse(log) as typeof parsed;
      } catch {
        return { events: [], malformed: 1 };
      }
      const events: IntercomEvent[] = [];
      let malformed = 0;
      // Log is newest-first; the stream reads oldest-first.
      for (const change of [...parsed].reverse()) {
        const seq = Number(new RegExp(`${INTERCOM_MSG} (\\d+)`).exec(change.message)?.[1]);
        if (!Number.isInteger(seq) || seq < 1) continue; // init/foreign changes
        try {
          events.push(JSON.parse(readFileSync(eventFile(storeDir, seq), "utf8")) as IntercomEvent);
        } catch {
          malformed++;
        }
      }
      return { events, malformed };
    },

    retireEvents(storeDir: string, keep: number): number {
      const map = readMap(storeDir);
      const seqs = Object.keys(map).map(Number).sort((a, b) => a - b);
      const droppable = Math.max(0, seqs.length - Math.max(0, keep));
      if (droppable === 0) return 0;
      // Dependents must ride in the SAME unrecord operation, so retire the
      // whole event chain. Unrecord can drop the tracked file from the
      // working copy, so survivors are rewritten from memory afterwards.
      const survivors = seqs.slice(droppable).map((seq) => ({
        seq,
        rel: join("events", `${seq}.json`),
        body: readFileSync(eventFile(storeDir, seq), "utf8"),
      }));
      // Newest first: unrecording the tip leaves no dependents, so every
      // event change is removed cleanly (no empty placeholder changes).
      run(
        ["unrecord", ...seqs.slice().reverse().map((s) => map[String(s)]!)],
        pijulDir(storeDir),
        "unrecord",
      );
      const fresh: Record<string, string> = {};
      for (const { seq, rel, body } of survivors) {
        writeFileSync(join(pijulDir(storeDir), rel), body);
        run(["add", rel], pijulDir(storeDir), "add");
        // Record THE FILE, not the channel: without a path argument pijul
        // captures every pending change in one shot, silently swallowing
        // the remaining survivors into the first record.
        const out = run(
          ["record", rel, "-m", `${INTERCOM_MSG} ${seq} retained`],
          pijulDir(storeDir),
          "record",
        );
        const hash = /Hash:\s*([A-Z0-9]+)/.exec(out)?.[1];
        if (hash !== undefined) fresh[String(seq)] = hash;
      }
      writeMap(storeDir, fresh);
      return droppable;
    },
  };
}
