#!/bin/sh
set -e

nginx

exec pnpm start
