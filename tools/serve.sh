#!/usr/bin/env bash
# Preview the site locally on a FRESH random port every time, so the browser
# has no cached files for that origin and is forced to load the current code.
# Usage:  ./tools/serve.sh
set -euo pipefail
cd "$(dirname "$0")/.."

port=$(( (RANDOM % 2000) + 8100 ))
url="http://localhost:$port/"
echo "Serving $(pwd) at $url"
echo "Build: $(grep -oE "const BUILD = '[^']*'" app.js | sed "s/const BUILD = //; s/'//g")"
echo "(new port each run = no stale cache; Ctrl+C to stop)"

# Open the browser on macOS / Linux if possible.
( sleep 1; (command -v open >/dev/null && open "$url") || (command -v xdg-open >/dev/null && xdg-open "$url") || true ) &

exec python3 -m http.server "$port"
