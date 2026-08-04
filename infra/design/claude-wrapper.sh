#!/bin/sh
# Runs the host-mounted, glibc-linked Claude Code binary inside this
# musl/Alpine container by invoking it through the real glibc dynamic
# loader (mounted read-only from the host at /mnt/host-glibc), instead
# of letting the kernel try to resolve it via Alpine's own musl loader.
exec /mnt/host-glibc/lib64/ld-linux-x86-64.so.2 \
  --library-path /mnt/host-glibc/lib:/mnt/host-glibc/lib64 \
  /home/open-design/.claude/local/node_modules/@anthropic-ai/claude-code/bin/claude.exe "$@"
