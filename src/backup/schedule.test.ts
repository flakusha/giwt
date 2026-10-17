// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { giwtEntry, remoteEnvNames, renderSchedule } from "./schedule";

const INPUT = { remoteKind: "rclone", staleness: "24h", calendar: "daily" };

describe("backup schedule units", () => {
  test("repeated dry-runs are byte-identical (idempotency caveat)", () => {
    const first = renderSchedule(INPUT);
    const second = renderSchedule(INPUT);
    expect(first.systemd).toBe(second.systemd);
    expect(first.cron).toBe(second.cron);
    expect(first.systemd.length).toBeGreaterThan(200);
  });

  test("units pin this giwt binary + cli entry, systemd AND cron forms", () => {
    const out = renderSchedule(INPUT);
    const entry = giwtEntry();
    expect(out.systemd).toContain(`ExecStart=${process.execPath} ${entry} backup dump`);
    expect(out.systemd).toContain("[Timer]");
    expect(out.systemd).toContain("OnCalendar=daily");
    expect(out.systemd).toContain("EnvironmentFile=-/etc/giwt-backup.env");
    expect(out.cron).toContain(`${process.execPath} ${entry} backup dump &&`);
    expect(out.cron).toContain("backup status --staleness 24h --strict");
  });

  test("units reference env var NAMES only — never values", () => {
    process.env.RCLONE_CONFIG = "/home/flak/.config/rclone/SECRET-content";
    try {
      const out = renderSchedule(INPUT);
      expect(out.systemd).toContain("RCLONE_CONFIG");
      expect(out.systemd).not.toContain("SECRET-content");
      expect(out.cron).not.toContain("SECRET-content");
      expect(out.envNames).toEqual(["RCLONE_CONFIG"]);
    } finally {
      delete process.env.RCLONE_CONFIG;
    }
  });

  test("env names per remote kind", () => {
    expect(remoteEnvNames("rsync")).toEqual(["RSYNC_PASSWORD"]);
    expect(remoteEnvNames("ssh")).toEqual(["GIWT_SSH_HOST", "GIWT_SSH_USER"]);
    expect(remoteEnvNames("carrier-pigeon")).toEqual([]);
  });
});
