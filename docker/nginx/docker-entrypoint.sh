#!/bin/sh
set -eu

# Emit a runtime config script so the Angular app can read the API base from
# a single source without rebuilding the image. The default of "/api" makes the
# app call the same origin, which lines up with the CON-106 ingress that routes
# `/api/*` to containerus-server.
API_BASE="${CONTAINERUS_API_BASE:-/api}"

# JSON-escape the value so arbitrary strings (including quotes / backslashes)
# survive the inline JS.
escaped=$(printf '%s' "$API_BASE" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

cat > /usr/share/nginx/html/assets/runtime-config.js <<EOF
window.__CONTAINERUS_API__ = "${escaped}";
EOF

exec "$@"
