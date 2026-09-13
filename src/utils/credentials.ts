// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared credential loader for giwt
 *
 * Reads .credentials.env (found by walking up from the current working
 * directory) and exports the agent identity. Loaded once at import time;
 * every consumer shares the same parsed result.
 */

import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { raw } from "./output";

export interface AgentCredentials {
  keyId: string;
  name: string;
  email: string;
  found: boolean;
  /** Path of the .credentials.env file when found, else absent. */
  path?: string;
}

/**
 * Walk up directory tree to find .credentials.env
 */
function findCredentialsEnv(startDir: string): string | null {
  let dir = startDir;
  while (dir !== "/") {
    const candidate = resolve(dir, ".credentials.env");
    try {
      accessSync(candidate, constants.R_OK);
      return candidate;
    } catch {
      // not found, keep walking
    }
    dir = dirname(dir);
  }
  return null;
}

/**
 * Parse KEY=VALUE lines from .credentials.env
 */
function parseCredentialsEnv(content: string): AgentCredentials {
  const result: AgentCredentials = { keyId: "", name: "", email: "", found: false };
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "AGENT_GPG_KEY_ID") result.keyId = value;
    else if (key === "AGENT_GPG_NAME") result.name = value;
    else if (key === "AGENT_GPG_EMAIL") result.email = value;
  }
  if (result.keyId && result.name && result.email) {
    result.found = true;
  }
  return result;
}

// Load synchronously at import time, anchored on the current working
// directory so the standalone CLI operates on whatever repo it is run in.
const envPath = findCredentialsEnv(process.cwd());

let credentials: AgentCredentials = { keyId: "", name: "", email: "", found: false };

if (envPath) {
  try {
    const content = readFileSync(envPath, "utf-8");
    credentials = parseCredentialsEnv(content);
    credentials.path = envPath;
  } catch {
    // ignore read errors
  }
}

export { credentials };

// When run directly (not imported), output shell-compatible KEY=value lines
if (process.argv[1] && process.argv[1].endsWith("credentials.ts")) {
  if (credentials.found) {
    raw(`AGENT_GPG_KEY_ID='${credentials.keyId}'`);
    raw(`AGENT_GPG_NAME='${credentials.name}'`);
    raw(`AGENT_GPG_EMAIL='${credentials.email}'`);
  }
}
