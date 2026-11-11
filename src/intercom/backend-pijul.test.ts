// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pijul dogfood backend tests. Guard/parsing tests always run against a
 * stubbed spawn seam; the end-to-end integration block runs only when a
 * real `pijul` binary (>= floor) is on PATH.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import {
  backendPijul,
  meetsVersionFloor,
  parsePijulVersion,
  PIJUL_VERSION_FLOOR,
  type PijulSpawn,
} from "./backend-pijul";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(scratchRoot(), "giwt-intercom-pijul-"));
});

function stub(outputs: Record<string, string>, failOn: string[] = []): PijulSpawn {
  return (cmd) => {
    const key = cmd.join(" ");
    if (failOn.some((f) => key.includes(f))) {
      return { stdout: "", stderr: `stub failure: ${key}`, exitCode: 1 };
    }
    const hit = Object.entries(outputs).find(([prefix]) => key.includes(prefix));
    return { stdout: hit?.[1] ?? "", stderr: "", exitCode: 0 };
  };
}

describe("pijul version parsing", () => {
  it("parses stable and beta versions", () => {
    expect(parsePijulVersion("pijul 1.0.0-beta.24")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      beta: 24,
    });
    expect(parsePijulVersion("pijul 2.3.4 (2026-01-01)")).toEqual({
      major: 2,
      minor: 3,
      patch: 4,
      beta: null,
    });
    expect(parsePijulVersion("command not found")).toBe(null);
  });

  it("floor comparison: beta by N, stable beats beta", () => {
    const floor = parsePijulVersion(`pijul ${PIJUL_VERSION_FLOOR}`)!;
    expect(meetsVersionFloor(parsePijulVersion("pijul 1.0.0-beta.24")!, floor)).toBe(true);
    expect(meetsVersionFloor(parsePijulVersion("pijul 1.0.0-beta.23")!, floor)).toBe(false);
    expect(meetsVersionFloor(parsePijulVersion("pijul 1.0.0")!, floor)).toBe(true);
    expect(meetsVersionFloor(parsePijulVersion("pijul 0.9.9")!, floor)).toBe(false);
    expect(meetsVersionFloor(parsePijulVersion("pijul 1.1.0-beta.1")!, floor)).toBe(true);
  });

  it("unparseable or missing binary refuses with a parse remedy", () => {
    const backend = backendPijul({ spawn: stub({}) });
    expect(() => backend.initStore(join(root, "s"))).toThrow(/cannot parse.*--version/);
  });

  it("version below the floor refuses naming the floor", () => {
    const backend = backendPijul({
      spawn: stub({ "--version": "pijul 1.0.0-beta.9\n" }),
    });
    expect(() => backend.initStore(join(root, "s"))).toThrow(/need >= 1.0.0-beta.24/);
  });

  it("identity failure on record surfaces the ssh-add remedy", () => {
    const backend = backendPijul({
      spawn: stub(
        {
          "--version": "pijul 1.0.0-beta.24\n",
          init: "Repository created\n",
          add: "Tracking events/1.json\n",
        },
        ["record"],
      ),
    });
    const store = join(root, "s");
    mkdirSync(store, { recursive: true });
    backend.initStore(store);
    expect(() =>
      backend.appendEvent(store, {
        actor: "t",
        type: "claim",
        lane: "a",
        refs: [],
        body: "",
      })
    ).toThrow(/ssh-add <key>.*pijul identity new/);
  });

  it("record without a Hash line is a hard error, not a silent map miss", () => {
    const backend = backendPijul({
      spawn: stub({
        "--version": "pijul 1.0.0-beta.24\n",
        init: "ok\n",
        add: "ok\n",
        record: "Recorded change XYZ\n",
      }),
    });
    const store = join(root, "s");
    mkdirSync(store, { recursive: true });
    backend.initStore(store);
    expect(() =>
      backend.appendEvent(store, {
        actor: "t",
        type: "claim",
        lane: "a",
        refs: [],
        body: "",
      })
    ).toThrow(/no Hash line/);
  });

  it("initStore is idempotent over an existing pijul repo", () => {
    const calls: string[] = [];
    const backend = backendPijul({
      spawn: (cmd, cwd) => {
        calls.push(cmd.join(" "));
        void cwd;
        return { stdout: "pijul 1.0.0-beta.24\n", stderr: "", exitCode: 0 };
      },
    });
    const store = join(root, "s");
    mkdirSync(join(store, "pijul", ".pijul"), { recursive: true });
    backend.initStore(store);
    expect(calls).toEqual(["pijul --version"]);
  });

  it("append/record happy path maps seq to the printed change hash", () => {
    const backend = backendPijul({
      spawn: stub({
        "--version": "pijul 1.0.0-beta.24\n",
        init: "ok\n",
        add: "ok\n",
        record: "Hash: ABCDEF1234\nDescription:\n\n",
      }),
    });
    const store = join(root, "s");
    mkdirSync(store, { recursive: true });
    backend.initStore(store);
    const event = backend.appendEvent(store, {
      actor: "t",
      type: "claim",
      lane: "lane-a",
      refs: [],
      body: "hello",
    });
    expect(event.seq).toBe(1);
    expect(event.v).toBe(1);
    const log = JSON.stringify([{ hash: "OLD", message: "x" }, {
      hash: "ABCDEF1234",
      message: "intercom: 1 claim lane-a",
    }]);
    const backend2 = backendPijul({
      spawn: stub({
        "--version": "pijul 1.0.0-beta.24\n",
        "log": log,
      }),
    });
    const read = backend2.readEvents(store);
    expect(read.malformed).toBe(0);
    expect(read.events.map((e) => e.seq)).toEqual([1]);
  });

  it("readEvents tolerates an unparseable log and missing event files", () => {
    const store = join(root, "s");
    mkdirSync(join(store, "pijul", "events"), { recursive: true });
    const backend = backendPijul({
      spawn: stub({
        "--version": "pijul 1.0.0-beta.24\n",
        "log": "not json at all\n",
      }),
    });
    expect(backend.readEvents(store)).toEqual({ events: [], malformed: 1 });
    const backend2 = backendPijul({
      spawn: stub({
        "--version": "pijul 1.0.0-beta.24\n",
        "log": JSON.stringify([
          { hash: "H1", message: "intercom: 1 claim gone" },
        ]),
      }),
    });
    const read = backend2.readEvents(store);
    expect(read.events).toEqual([]);
    expect(read.malformed).toBe(1);
  });

  it("non-record pijul command failures name the phase", () => {
    const backend = backendPijul({
      spawn: stub(
        { "--version": "pijul 1.0.0-beta.24\n" },
        ["init"],
      ),
    });
    expect(() => backend.initStore(join(root, "s"))).toThrow(/pijul init failed/);
  });
});

const hasPijul = existsSync("/usr/bin/pijul") || existsSync("/usr/local/bin/pijul");
const itReal = hasPijul ? it : it.skip;

describe("pijul real-binary integration", () => {
  const oldRoots: string[] = [];

  itReal("init/append/read round-trip in a scratch state root", () => {
    const store = mkdtempSync(join(scratchRoot(), "giwt-pijul-live-"));
    oldRoots.push(store);
    const backend = backendPijul();
    backend.initStore(store);
    expect(existsSync(join(store, "pijul", ".pijul"))).toBe(true);
    backend.appendEvent(store, {
      actor: "live",
      type: "claim",
      lane: "live-lane",
      refs: [],
      body: "probe",
    });
    const read = backend.readEvents(store);
    expect(read.events.map((e) => e.lane)).toContain("live-lane");
  });

  itReal("retire unrecords dropped events and re-records survivors", () => {
    const store = mkdtempSync(join(scratchRoot(), "giwt-pijul-live-"));
    oldRoots.push(store);
    const backend = backendPijul();
    backend.initStore(store);
    for (const lane of ["one", "two", "three"]) {
      backend.appendEvent(store, { actor: "live", type: "claim", lane, refs: [], body: "" });
    }
    const dropped = backend.retireEvents(store, 2);
    expect(dropped).toBe(1);
    const read = backend.readEvents(store);
    expect(read.events.map((e) => e.lane).sort()).toEqual(["three", "two"]);
  });
});
