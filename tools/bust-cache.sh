#!/usr/bin/env bash
# Rewrite the ?v=... cache-busting token on app.js / app.css in index.html to
# a hash of each file's CURRENT contents. Run automatically by the pre-commit
# hook, or by hand any time. When a file's bytes change its URL changes, so a
# browser or CDN can never serve a stale copy; when nothing changes the token
# is stable and caching still works.
set -euo pipefail
cd "$(dirname "$0")/.."

hash_of() {
  # First 10 hex chars of the file's sha — works on macOS and Linux.
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -c1-10
  else
    sha256sum "$1" | cut -c1-10
  fi
}

changed=0
for asset in app.js app.css; do
  [ -f "$asset" ] || continue
  h=$(hash_of "$asset")
  # Replace e.g. app.js?v=ANYTHING with app.js?v=<hash>
  if grep -q "$asset?v=$h" index.html; then
    continue   # already up to date
  fi
  # macOS/BSD sed and GNU sed both accept -i with an explicit backup suffix ''.
  sed -i.bak -E "s|$asset\?v=[^\"\']*|$asset?v=$h|g" index.html
  rm -f index.html.bak
  echo "bust-cache: $asset -> ?v=$h"
  changed=1
done

[ "$changed" = 0 ] && echo "bust-cache: already current"
exit 0
