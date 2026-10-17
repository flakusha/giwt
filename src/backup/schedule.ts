// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup schedule --dry-run`: deterministic systemd timer+service and
 * cron snippets pinned to THIS giwt checkout (bun + src/cli.ts resolved from
 * this module). Generation is pure — no timestamps, no environment reads —
 * so repeated dry-runs are byte-identical (ticket idempotency caveat).
 *
 * Security: units reference env var NAMES (and an EnvironmentFile) only;
 * secret VALUES never enter generated output.
 */

import { join } from "node:path";

/** Path of the giwt CLI entry this module was loaded from (pinned binary). */
export function giwtEntry(): string {
  return join(import.meta.dir, "..", "cli.ts");
}

/** Env var NAMES a remote kind needs at runtime (names only, never values). */
export function remoteEnvNames(kind: string): readonly string[] {
  if (kind === "rclone") return ["RCLONE_CONFIG"];
  if (kind === "rsync") return ["RSYNC_PASSWORD"];
  if (kind === "ssh") return ["GIWT_SSH_HOST", "GIWT_SSH_USER"];
  return [];
}

export interface ScheduleInput {
  /** Remote kind the schedule should push after dump ("" = none). */
  remoteKind: string;
  /** Staleness budget as a CLI-ready duration string (e.g. "24h"). */
  staleness: string;
  /** systemd OnCalendar / cron schedule expression. */
  calendar: string;
}

function systemdTemplate(
  bin: string,
  entry: string,
  staleness: string,
  calendar: string,
  envNames: readonly string[],
): string {
  const envLine = envNames.length > 0
    ? [`# env names required at runtime: ${envNames.join(", ")} (values in /etc/giwt-backup.env)`]
    : [];
  return [
    "# giwt backup — systemd units (giwt backup schedule --dry-run)",
    `# pin: ${bin} ${entry}`,
    `# install check: ${entry} backup status --staleness ${staleness} --strict must exit 0`,
    "# secrets: define values in /etc/giwt-backup.env; units reference names only",
    ...envLine,
    "",
    "[Unit]",
    "Description=giwt backup dump + verify",
    "",
    "[Service]",
    "Type=oneshot",
    "EnvironmentFile=-/etc/giwt-backup.env",
    "WorkingDirectory=%h",
    `ExecStart=${bin} ${entry} backup dump`,
    `ExecStartPost=${bin} ${entry} backup verify`,
    `ExecStartPost=${bin} ${entry} backup status --staleness ${staleness} --strict`,
    "",
    "[Timer]",
    `OnCalendar=${calendar}`,
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

function cronTemplate(
  bin: string,
  entry: string,
  staleness: string,
  calendar: string,
): string {
  return [
    "# giwt backup — cron (giwt backup schedule --dry-run)",
    "# env names required at runtime: see systemd EnvironmentFile /etc/giwt-backup.env",
    `${calendar} ${bin} ${entry} backup dump && ${bin} ${entry} backup verify && ${bin} ${entry} backup status --staleness ${staleness} --strict`,
    "",
  ].join("\n");
}

export interface RenderedSchedule {
  systemd: string;
  cron: string;
  envNames: readonly string[];
}

/** Render both units; same input → same bytes, always. */
export function renderSchedule(input: ScheduleInput): RenderedSchedule {
  const bin = process.execPath;
  const entry = giwtEntry();
  const envNames = remoteEnvNames(input.remoteKind);
  return {
    systemd: systemdTemplate(bin, entry, input.staleness, input.calendar, envNames),
    cron: cronTemplate(bin, entry, input.staleness, input.calendar),
    envNames,
  };
}
