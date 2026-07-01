#!/usr/bin/env bash
# git-ssh-wrapper.sh — SSH command wrapper used as core.sshCommand for turns
# where the triggering user has no configured git identity.
#
# Security posture (Decision #6 / #10a):
#   This is a UX + friendly-message mechanism, NOT a containment boundary.
#   The real push block is withholding the SSH private key (no key = SSH auth
#   fails). The wrapper blocks push only for a cooperating agent using the
#   ambient git config; an actively-circumventing agent can bypass it.
#
# Git appends arguments: <host> <git-verb> '<repo-path>'
# We scan argv for the git verb (not SSH_ORIGINAL_COMMAND, which is
# server-side only and empty here).
#
# Allowed verbs (read-only):
#   git-upload-pack    — fetch, clone, pull
#   git-upload-archive — git archive over SSH
#
# Blocked verb (write):
#   git-receive-pack   — push
#
# Default: block anything not explicitly allowed (default-deny).

set -euo pipefail

CONSOLE_URL="${TDR_CODE_CONSOLE_URL:-https://tdr-code.lilnas.io}"

# Scan all argv for a git verb. Git's exec format is:
#   ssh-path [ssh-options...] host git-verb 'path'
# The verb is not at a fixed position, so we scan all arguments.
GIT_VERB=""
for arg in "$@"; do
  case "$arg" in
    git-receive-pack|git-upload-pack|git-upload-archive)
      GIT_VERB="$arg"
      break
      ;;
  esac
done

case "$GIT_VERB" in
  git-receive-pack)
    # Block push — user has no configured git identity.
    echo "error: git push is blocked: your git identity is not configured." >&2
    echo "       Configure your identity at: ${CONSOLE_URL}/git-identity" >&2
    echo "       Pushes are blocked until a valid SSH key is on file." >&2
    exit 1
    ;;
  git-upload-pack|git-upload-archive)
    # Allow read-only operations — exec real SSH with all original arguments.
    exec ssh "$@"
    ;;
  "")
    # No recognizable git verb found — default-deny.
    echo "error: git operation blocked: unrecognized SSH command." >&2
    echo "       Configure your identity at: ${CONSOLE_URL}/git-identity" >&2
    exit 1
    ;;
  *)
    # Unrecognized verb — default-deny.
    echo "error: git operation blocked: unknown verb '${GIT_VERB}'." >&2
    exit 1
    ;;
esac
