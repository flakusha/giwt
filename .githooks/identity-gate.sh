#!/bin/sh
# Commit-identity gate lib — sourced by .githooks/pre-commit and
# .githooks/commit-msg. POSIX sh; single definition of the repo-canonical
# identity policy (mirrors gate-env.sh's single-definition rule).
#
# IDENTITY POLICY: repo-configured identity only.
#   The repo's `user.name`/`user.email` is the canonical commit identity.
#   Agent attribution lives in the receipt/ledger, never in git metadata —
#   no "(Agent)" name variants (none exist in repo history: every commit is
#   the plain repo identity). `git config --get` uses git's normal scoping
#   (repo-local wins over global); no --global policy reads and NEVER any
#   git config write — persistent config changes remain a user-only action.
#
# gate-env.sh strips only the GIT_DIR family and harness session vars, so
# GIT_AUTHOR_*/EMAIL/GIT_CONFIG_* overrides that leaked past the tool guard
# are still visible in the hook env — this file is the last-line check, at
# the object boundary the guard cannot see.
#
# Verdict matrix:
#   fabrication pattern in the resolved identity -> FAIL (canonical or not)
#   canonical configured + resolved matches      -> pass
#   canonical configured + mismatch              -> FAIL (names env sources)
#   canonical absent (any scope)                 -> WARN (never fail: CI and
#                                                   identity-less contributors
#                                                   must not break)
#   Co-authored-by trailer                       -> ALLOWED_TRAILERS consent
#                                                   outranks the placeholder
#                                                   heuristic (trailers ONLY —
#                                                   commit identity fabrication
#                                                   is never consentable); else
#                                                   email must match the
#                                                   canonical identity;
#                                                   fabrication FAIL; no
#                                                   canonical WARN

# Fabricated/placeholder identities are always agent fabrications
# (loop-lore incident: 26 commits landed as `gate <gate@example.com>`).
identity_is_fabrication() {
  printf '%s' "$1" | grep -iqE \
    '@(example|test)\.(com|org|net|io)$|@invalid$|@localhost$|@users\.noreply\.|^(test|dev|agent|noreply|foo|bar|user|gate)@'
}

# Names of identity-override variables currently set in the environment, one
# per line (empty output = clean). git honours every one of these at commit
# time; gate-env.sh deliberately does not strip them, so they are detectable.
identity_overrides() {
  env | grep -E \
    '^(GIT_AUTHOR_NAME|GIT_AUTHOR_EMAIL|GIT_AUTHOR_DATE|GIT_COMMITTER_NAME|GIT_COMMITTER_EMAIL|GIT_COMMITTER_DATE|EMAIL|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_[0-9]+|GIT_CONFIG_VALUE_[0-9]+|GIT_CONFIG_PARAMETERS|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM)=' |
    cut -d= -f1
}

# Offenders that DIRECTLY rewrite author/committer — what the mismatch
# diagnostic names first. Config-path redirection suspects
# (GIT_CONFIG_GLOBAL/GIT_CONFIG_PARAMETERS) are reported separately: they
# change the resolved identity only via a redirected config source.
identity_ident_overrides() {
  identity_overrides | grep -vE '^GIT_CONFIG_(GLOBAL|PARAMETERS)$'
}

# Split a `Name <email> ts tz` ident line (git var GIT_AUTHOR_IDENT shape).
identity_ident_email() {
  printf '%s' "$1" | sed -n 's/.*<\([^>]*\)>.*/\1/p'
}
identity_ident_name() {
  printf '%s' "$1" | sed -n 's/^\([^<]*\)<.*/\1/p' | sed 's/[[:space:]]*$//'
}

# Whether a trailer line carries any ALLOWED_TRAILERS fragment (comma-
# separated substrings, case-insensitive) — the user's consent mechanism for
# intentionally attributed accounts.
identity_trailer_allowlisted() {
  _line=$1
  _allow=$2
  [ -n "$_allow" ] || return 1
  _old_ifs=$IFS
  IFS=','
  for _frag in $_allow; do
    _frag=$(printf '%s' "$_frag" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -n "$_frag" ] || continue
    if printf '%s' "$_line" | grep -qiF -- "$_frag"; then
      IFS=$_old_ifs
      return 0
    fi
  done
  IFS=$_old_ifs
  return 1
}

# pre-commit verdict: resolved author+committer identity vs repo config.
# Returns 1 (FAIL) on fabrication or mismatch; WARNs to stderr when the repo
# has no configured canonical; diagnostics on stderr only.
identity_check_commit() {
  can_email=$(git config --get user.email 2>/dev/null)
  can_name=$(git config --get user.name 2>/dev/null)
  a_ident=$(git var GIT_AUTHOR_IDENT 2>/dev/null)
  c_ident=$(git var GIT_COMMITTER_IDENT 2>/dev/null)
  a_email=$(identity_ident_email "$a_ident")
  c_email=$(identity_ident_email "$c_ident")
  a_name=$(identity_ident_name "$a_ident")
  c_name=$(identity_ident_name "$c_ident")
  leaks=$(identity_ident_overrides || true)
  paths=$(identity_overrides | grep -E '^GIT_CONFIG_(GLOBAL|PARAMETERS)$' || true)

  for email in "$a_email" "$c_email"; do
    [ -n "$email" ] || continue
    if identity_is_fabrication "$email"; then
      printf 'pre-commit: REFUSED: resolved commit identity <%s> is a placeholder — agent fabrications are always rejects, configured canonical or not\n' "$email" >&2
      if [ -n "$leaks" ]; then
        printf 'pre-commit: leaking env (%s)\n' "$(printf '%s' "$leaks" | tr '\n' ' ')" >&2
      fi
      return 1
    fi
  done

  if [ -z "$can_email" ]; then
    printf 'pre-commit: WARN: repo has no configured user.email — cannot verify the commit identity against a canonical (never guessed, never invented; configure user.email to enable the check)\n' >&2
    return 0
  fi

  mismatch=""
  [ "$a_email" != "$can_email" ] && mismatch="$mismatch author-email:<${a_email:-unset}>"
  [ "$c_email" != "$can_email" ] && mismatch="$mismatch committer-email:<${c_email:-unset}>"
  if [ -n "$can_name" ]; then
    [ "$a_name" != "$can_name" ] && mismatch="$mismatch author-name:<${a_name:-unset}>"
    [ "$c_name" != "$can_name" ] && mismatch="$mismatch committer-name:<${c_name:-unset}>"
  fi
  [ -n "$mismatch" ] || return 0

  printf 'pre-commit: REFUSED: resolved identity does not match the repo-canonical config:%s\n' "$mismatch" >&2
  if [ -n "$leaks" ]; then
    printf 'pre-commit: leaking env (%s) — an identity override survived into the hook env\n' \
      "$(printf '%s' "$leaks" | tr '\n' ' ')" >&2
  elif [ -n "$paths" ]; then
    printf 'pre-commit: config-path overrides (%s) set — a redirected config source can change the resolved identity\n' \
      "$(printf '%s' "$paths" | tr '\n' ' ')" >&2
  else
    printf 'pre-commit: no override visible in the hook env — stale config, or a `git -c`/GIT_CONFIG_* leak the hook cannot see\n' >&2
  fi
  printf 'pre-commit: fix: clear the override, then `git commit --amend --reset-author --no-edit` (user-run; agents ask). The repo-local identity is canonical — never write git config from agent flows.\n' >&2
  return 1
}

# commit-msg verdict for one Co-authored-by trailer line. ALLOWED_TRAILERS
# consent is checked FIRST and keeps the line (the user's explicit voice in
# .credentials.env — vendor `noreply@` addresses and GitHub squash
# `users.noreply` co-authors are legitimate there, so fabrication-first
# would make the consent file useless). PRECEDENCE TRADE: consent applies
# to the trailer allowlist ONLY — the commit identity itself is never
# consentable, and identity_check_commit keeps its fabrication check
# unconditional. Returns 1 (FAIL) on fabrication or non-consented mismatch
# with the canonical identity; WARNs (returns 0) when the repo has no
# canonical to check against.
identity_check_trailer() {
  _line=$1
  _allow=$2
  _email=$(printf '%s' "$_line" | sed -n 's/.*<\([^>]*\)>.*/\1/p')
  [ -n "$_email" ] || _email=$_line
  if identity_trailer_allowlisted "$_line" "$_allow"; then
    printf 'commit-msg: kept consented trailer (ALLOWED_TRAILERS): %s\n' "$_email" >&2
    return 0
  fi
  if identity_is_fabrication "$_email"; then
    printf 'commit-msg: REFUSED: Co-authored-by <%s> is a placeholder identity\n' "$_email" >&2
    return 1
  fi
  _can_email=$(git config --get user.email 2>/dev/null)
  if [ -z "$_can_email" ]; then
    printf 'commit-msg: WARN: no configured user.email — cannot verify Co-authored-by <%s> against the repo identity\n' "$_email" >&2
    return 0
  fi
  if [ "$_email" != "$_can_email" ]; then
    printf 'commit-msg: REFUSED: Co-authored-by <%s> does not match the repo-canonical identity <%s> — attribution needs the user (ask); consented accounts go in ALLOWED_TRAILERS\n' "$_email" "$_can_email" >&2
    return 1
  fi
  return 0
}
