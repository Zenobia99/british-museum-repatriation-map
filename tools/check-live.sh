#!/usr/bin/env bash
# Confirm the LIVE GitHub Pages site is serving the version you just pushed,
# instead of a cached old one. Fetches the live app.js with a cache-bypassing
# header and prints its build id next to your local one.
# Usage:  ./tools/check-live.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SITE="https://zenobia99.github.io/british-museum-repatriation-map"

local_build=$(grep -oE "const BUILD = '[^']*'" app.js | sed "s/const BUILD = //; s/'//g")
# ?nocache + no-cache header defeats both the browser and the Fastly CDN edge.
live_build=$(curl -fsS -H 'Cache-Control: no-cache' "$SITE/app.js?nocache=$RANDOM" \
              | grep -oE "const BUILD = '[^']*'" | sed "s/const BUILD = //; s/'//g" || echo "(could not fetch)")

echo "local : $local_build"
echo "live  : $live_build"
if [ "$local_build" = "$live_build" ]; then
  echo "MATCH — the live site is current."
else
  echo "DIFFERENT — give Pages a minute to deploy, then load $SITE/?v=$RANDOM"
fi
