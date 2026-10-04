// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * `giwt task` arg parsing. One left-to-right scan in the ticket/args.ts
 * style: known flags are consumed wherever they appear, `--flag=value`
 * is split locally, `--` ends flag parsing, and the remaining tokens are
 * the positional directive (joined with spaces).
 */

export type SkillsMode = "min" | "max" | "reasonable";
export type TaskDepth = "shallow" | "deep";

export interface TaskFlags {
  /** Directive text from positionals or -m/-d/--message/--directive. */
  directive: string;
  /** -F/--file path; "-" reads stdin. Mutually exclusive with directive. */
  file?: string;
  /** Finalize gate fanout; 0 = do not finalize. Undefined = CLI default. */
  jobs?: number;
  /** Preferred subagent count: 0 none, -1 unbounded, N cap. Undefined = omit. */
  agents?: number;
  good?: number;
  fast?: number;
  /** -g value: "all", "none", a gate csv, or freeform prose. */
  gates?: string;
  /** Run the full gate suite (conflicts with -g). */
  strict: boolean;
  depth?: TaskDepth;
  skills?: SkillsMode;
  /** true = derive branch slug from the directive; string = explicit name. */
  worktree?: string | true;
  base?: string;
  tickets: string[];
  follow: string[];
  careful: string[];
  docs: string[];
  /** --roster: print the open-work roster as JSON instead of rendering. */
  roster: boolean;
}

export class TaskArgError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Flag tokens `task` accepts. Static table per repo convention. */
const FLAG_TOKENS: Record<string, true> = {
  "-m": true,
  "-d": true,
  "--message": true,
  "--directive": true,
  "-F": true,
  "--file": true,
  "-j": true,
  "--jobs": true,
  "-a": true,
  "--agents": true,
  "--good": true,
  "--fast": true,
  "-g": true,
  "--gates": true,
  "--strict": true,
  "--shallow": true,
  "--deep": true,
  "-s": true,
  "--skills": true,
  "-w": true,
  "--worktree": true,
  "--base": true,
  "--tickets": true,
  "--follow": true,
  "--careful": true,
  "--docs": true,
  "--roster": true,
};

/** Required value for a value-taking flag; missing value is a parse
 * error naming the flag (unlike --tickets/--follow/--careful/--docs,
 * which keep the ticket/args.ts ignore-missing parity). */
function requireValue(token: string, value: string | undefined): string {
  if (value === undefined) throw new TaskArgError(`missing value for ${token}`);
  return value;
}

function parseCount(token: string, value: string | undefined, min: number): number {
  const n = value === undefined ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new TaskArgError(
      `invalid count for ${token}: ${value ?? "<missing>"} (integer >= ${min})`,
    );
  }
  return n;
}

function parseSkills(value: string | undefined): SkillsMode {
  if (value === "min" || value === "max" || value === "reasonable") return value;
  throw new TaskArgError(`invalid -s/--skills value: ${value ?? "<missing>"} (min|max|reasonable)`);
}

/** A csv like "lint,format" selects finalize --skip-gates; anything with
 * prose spacing is forwarded as a verbatim gates directive. */
export function isGateCsv(value: string): boolean {
  return /^[\w.*-]+(,[\w.*-]+)*$/.test(value);
}

/** kebab slug from directive text, for bare -w/--worktree branch naming. */
export function directiveSlug(directive: string): string {
  return directive
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function parseTaskArgs(args: string[]): TaskFlags {
  const flags: TaskFlags = {
    directive: "",
    strict: false,
    tickets: [],
    follow: [],
    careful: [],
    docs: [],
    roster: false,
  };
  let sawDirectiveFlag = false;
  let sawFile = false;
  let sawRoster = false;
  let sawShallow = false;
  let sawDeep = false;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    if (raw === undefined) break;
    if (raw === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    let token = raw;
    let inline: string | undefined;
    const eq = raw.indexOf("=");
    if (eq > 0 && FLAG_TOKENS[raw.slice(0, eq)] === true) {
      token = raw.slice(0, eq);
      inline = raw.slice(eq + 1);
    }
    if (FLAG_TOKENS[token] !== true) {
      // gi convention: an unknown dash token is a flag-parse error, not a
      // positional (a directive containing dashes goes after --).
      if (raw.startsWith("-") && raw !== "-") {
        throw new TaskArgError(`unknown flag '${raw}'`);
      }
      positionals.push(raw);
      continue;
    }
    // Value of the current flag: the `=` form, else the next argv token.
    // Required-value flags error on a missing value (requireValue);
    // repeatable text flags keep the ticket/args.ts ignore-missing parity.
    const nextValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      const v = args[i + 1];
      if (v !== undefined) i++;
      return v;
    };
    switch (token) {
      case "-m":
      case "-d":
      case "--message":
      case "--directive": {
        sawDirectiveFlag = true;
        flags.directive = requireValue(token, nextValue());
        break;
      }
      case "-F":
      case "--file": {
        sawFile = true;
        flags.file = requireValue(token, nextValue());
        break;
      }
      case "-j":
      case "--jobs":
        flags.jobs = parseCount(token, nextValue(), 0);
        break;
      case "-a":
      case "--agents":
        flags.agents = parseCount(token, nextValue(), -1);
        break;
      case "--good":
        flags.good = parseCount(token, nextValue(), 0);
        break;
      case "--fast":
        flags.fast = parseCount(token, nextValue(), 0);
        break;
      case "-g":
      case "--gates":
        flags.gates = requireValue(token, nextValue());
        break;
      case "--strict":
        flags.strict = true;
        break;
      case "--shallow":
        sawShallow = true;
        flags.depth = "shallow";
        break;
      case "--deep":
        sawDeep = true;
        flags.depth = "deep";
        break;
      case "-s":
      case "--skills":
        flags.skills = parseSkills(nextValue());
        break;
      case "-w":
      case "--worktree": {
        const v = nextValue();
        if (v === undefined || v === "" || (v.startsWith("-") && inline === undefined)) {
          flags.worktree = true;
          if (v !== undefined && v !== "") i--; // dash token belongs to the next flag
        } else {
          flags.worktree = v;
        }
        break;
      }
      case "--base":
        flags.base = requireValue(token, nextValue());
        break;
      case "--tickets": {
        const v = nextValue();
        if (v !== undefined) {
          flags.tickets.push(...v.split(",").map((t) => t.trim()).filter((t) => t.length > 0));
        }
        break;
      }
      case "--follow": {
        const v = nextValue();
        if (v !== undefined) flags.follow.push(v);
        break;
      }
      case "--careful": {
        const v = nextValue();
        if (v !== undefined) flags.careful.push(v);
        break;
      }
      case "--docs": {
        const v = nextValue();
        if (v !== undefined) flags.docs.push(v);
        break;
      }
      case "--roster":
        sawRoster = true;
        flags.roster = true;
        break;
    }
  }
  if (positionals.length > 0 && (sawDirectiveFlag || sawFile)) {
    throw new TaskArgError(
      "positional task text is mutually exclusive with -m/--message and -F/--file",
    );
  }
  if (sawDirectiveFlag && sawFile) {
    throw new TaskArgError("-m/--message and -F/--file are mutually exclusive");
  }
  if (sawRoster && (positionals.length > 0 || sawDirectiveFlag || sawFile)) {
    throw new TaskArgError(
      "--roster takes no directive; it is mutually exclusive with task text (positional, -m/--message, -F/--file)",
    );
  }
  if (positionals.length > 0) flags.directive = positionals.join(" ");
  if (flags.strict && flags.gates !== undefined) {
    throw new TaskArgError("--strict and -g/--gates are mutually exclusive");
  }
  if (sawShallow && sawDeep) {
    throw new TaskArgError("--shallow and --deep are mutually exclusive");
  }
  if ((flags.good !== undefined || flags.fast !== undefined) && flags.agents === 0) {
    throw new TaskArgError("--good/--fast conflict with -a 0 (no subagents)");
  }
  return flags;
}
