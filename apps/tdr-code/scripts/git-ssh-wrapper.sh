#!/usr/bin/env bash
# git-ssh-wrapper.sh — SSH command wrapper used as core.sshCommand for turns
# where the triggering user has no configured git identity.
#
# Security posture (Decision #6 / #10a):
#   This is a UX + friendly-message mechanism, NOT a containment boundary.
#   The real push block is withholding the SSH private key (no key = SSH auth
#   fails). The wrapper blocks all git-over-SSH verbs for a cooperating agent
#   using the ambient git config; an actively-circumventing agent can bypass it.
#
# Git appends arguments: <host> <git-verb> '<repo-path>'
# We scan argv for the git verb (not SSH_ORIGINAL_COMMAND, which is
# server-side only and empty here).
#
# ALL verbs blocked (Decision #6 read-path gap, closed):
#   git-receive-pack   — push
#   git-upload-pack    — fetch, clone, pull
#   git-upload-archive — git archive over SSH
#
# This script only ever runs for a turn with NO configured identity (the sole
# caller is git-turn-context.ts's unconfigured/decrypt-failed branch — the
# configured path builds its own `ssh -i <key> ... -F /dev/null` string
# inline and never touches this file). Unlike an anonymous HTTPS clone of a
# public repo, SSH auth is all-or-nothing per account: there is no key or
# flag that grants "read-only/public-repo" access — presenting ANY identity
# over SSH grants that identity's full access (public + private). Since this
# process inherits the bot's ambient env (real ~/.ssh/config, default key
# discovery, SSH_AUTH_SOCK if present — see spawnAndConnect in
# session-manager.service.ts), letting git-upload-pack/-archive through via
# plain `ssh "$@"` used to silently authenticate the turn as whatever
# identity the HOST happens to have, not the Discord user's — confirmed
# exploitable: an unconfigured turn could clone a private repo it had no
# business reaching.
#
# Default: block anything not explicitly allowed (default-deny) — still
# applies to unrecognized/future verbs below; there is no allowed set left.

set -euo pipefail

CONSOLE_URL="${TDR_CODE_CONSOLE_URL:-https://tdr-code.lilnas.io}"

# Scan all argv for a git verb. Git's exec format is:
#   ssh-path [ssh-options...] host "git-verb 'path'"
# Git passes the verb and repo path as a single combined argument
# (e.g. "git-receive-pack '/user/repo'"), so we match on prefix.
GIT_VERB=""
for arg in "$@"; do
  case "$arg" in
    "git-receive-pack "*|git-receive-pack)   GIT_VERB="git-receive-pack";   break ;;
    "git-upload-pack "*|git-upload-pack)     GIT_VERB="git-upload-pack";    break ;;
    "git-upload-archive "*|git-upload-archive) GIT_VERB="git-upload-archive"; break ;;
  esac
done

case "$GIT_VERB" in
  git-receive-pack)
    # Block push — user has no configured git identity.
    echo "error: git push is blocked: your git identity is not configured." >&2
    echo "       Configure your identity at: ${CONSOLE_URL}/git" >&2
    echo "       Pushes are blocked until a valid SSH key is on file." >&2
    exit 1
    ;;
  git-upload-pack|git-upload-archive)
    # Block fetch/clone/archive too — no configured identity means no safe
    # identity to authenticate as (see header comment: SSH auth is
    # all-or-nothing, ambient/default keys are the HOST's identity, not the
    # Discord user's).
    echo "error: git operation blocked: your git identity is not configured." >&2
    echo "       Configure your identity at: ${CONSOLE_URL}/git" >&2
    echo "       Git operations are blocked until a valid SSH key is on file." >&2
    exit 1
    ;;
  "")
    # No recognizable git verb found — default-deny.
    echo "error: git operation blocked: unrecognized SSH command." >&2
    echo "       Configure your identity at: ${CONSOLE_URL}/git" >&2
    exit 1
    ;;
  *)
    # Unrecognized verb — default-deny.
    echo "error: git operation blocked: unknown verb '${GIT_VERB}'." >&2
    exit 1
    ;;
esac
