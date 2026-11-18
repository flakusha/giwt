// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Pure jj change-id parsing and the injectable jj log seam. */

import { describe, expect, test } from "bun:test";
import { CHANGE_ID_TEMPLATE, jjChangeIds, parseChangeIds } from "./jj-history";

const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);

describe("parseChangeIds", () => {
  test("maps commit ids to change ids from stubbed jj output", () => {
    const output = `${SHA1}\x1fchange-one\n${SHA2}\x1fchange-two\n`;
    expect([...parseChangeIds(output)]).toEqual([
      [SHA1, "change-one"],
      [SHA2, "change-two"],
    ]);
  });

  test("ignores blank and malformed lines", () => {
    const output = `\n${SHA1}\x1fchange-one\nnot-a-pair\n${SHA2}\x1f\n`;
    expect([...parseChangeIds(output)]).toEqual([[SHA1, "change-one"]]);
  });
});

describe("jjChangeIds", () => {
  test("calls jj log with the change-id template in the given cwd", () => {
    const calls: Array<{ cmd: string[]; cwd: string; }> = [];
    const map = jjChangeIds({
      root: "/repo",
      spawn: (cmd, cwd) => {
        calls.push({ cmd, cwd });
        return { stdout: `${SHA1}\x1fchange-one\n`, stderr: "", exitCode: 0 };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cwd).toBe("/repo");
    expect(calls[0]!.cmd[0]).toBe("jj");
    expect(calls[0]!.cmd).toContain(CHANGE_ID_TEMPLATE);
    expect(map.get(SHA1)).toBe("change-one");
  });

  test("explicitly mentions requested commit ids so hidden commits resolve", () => {
    const calls: string[][] = [];
    jjChangeIds({
      root: "/repo",
      shas: [SHA1, SHA2],
      spawn: (cmd) => {
        calls.push(cmd);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const revset = calls[0]![3]!;
    expect(revset).toContain(`commit_id(${SHA1})`);
    expect(revset).toContain(`commit_id(${SHA2})`);
  });

  test("throws with jj stderr when the log fails", () => {
    expect(() =>
      jjChangeIds({
        root: "/repo",
        spawn: () => ({ stdout: "", stderr: "no such revset", exitCode: 1 }),
      })
    ).toThrow("no such revset");
  });
});
