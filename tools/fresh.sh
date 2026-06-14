#!/usr/bin/env bash
# One command to avoid the stale-version trap entirely:
#   1. kill any old `python -m http.server` still holding a terminal/port,
#   2. pull the latest committed code,
#   3. serve it on a brand-new port the browser has never cached.
# Usage:  ./tools/fresh.sh   (run from anywhere inside the repo)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "1/3  killing any running http.server…"
pkill -f "http.server" 2>/dev/null && echo "     stopped old server(s)" || echo "     none running"

echo "2/3  pulling latest code…"
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin --quiet
git reset --hard "origin/$branch"
echo "     now at $(git log --oneline -1)"
echo "     build: $(grep -oE "const BUILD = '[^']*'" app.js | sed "s/const BUILD = //; s/'//g")"

echo "3/3  starting a fresh server…"
exec "$(git rev-parse --show-toplevel)/tools/serve.sh"
