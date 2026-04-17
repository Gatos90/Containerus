#!/usr/bin/env bash
# CI guard for CON-64: ensure audit call sites never pass `None` for the
# `ip_address` argument and that WebSocket handlers emit audit events.
#
# Exit code 0 = OK, 1 = violation detected.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRV_SRC="$REPO_ROOT/crates/containerus-server/src"

fail=0

echo "==> Checking for log_action call sites that still pass None for IP..."
# log_action has 9 positional args; ip_address is the 8th (second-to-last).
# We match the TRAILING `, None, <env>)` pattern anchored just before `.await`.
# <env> is either `None` or `Some(<simple expr>)` — we use a non-paren-nesting match.
if grep -RnE 'log_action\(.*, None, None\)\.await' "$SRV_SRC" 2>/dev/null; then
    echo "  !! log_action call site passes None for IP address. Use *.client_ip.as_deref() instead." >&2
    fail=1
fi
if grep -RnE 'log_action\(.*, None, Some\([^()]*\)\)\.await' "$SRV_SRC" 2>/dev/null; then
    echo "  !! log_action call site passes None for IP address (before Some(env_id)). Use *.client_ip.as_deref() instead." >&2
    fail=1
fi

echo "==> Checking every WebSocket handler emits audit events..."
for ws_file in "$SRV_SRC/ws/terminal.rs" "$SRV_SRC/ws/tunnel.rs" "$SRV_SRC/ws/k8s_exec.rs" "$SRV_SRC/ws/k8s_watch.rs"; do
    if [ ! -f "$ws_file" ]; then
        echo "  !! Expected WS handler $ws_file not found" >&2
        fail=1
        continue
    fi
    if ! grep -q 'log_event' "$ws_file"; then
        echo "  !! WS handler $(basename "$ws_file") does not call log_event for audit" >&2
        fail=1
    fi
    if ! grep -q 'ConnectInfo<SocketAddr>' "$ws_file"; then
        echo "  !! WS handler $(basename "$ws_file") does not extract ConnectInfo<SocketAddr>" >&2
        fail=1
    fi
done

echo "==> Checking every API route handler is permission-gated..."
# Extractor-based permission enforcement: every handler on a project/system-scoped
# router MUST take ProjectScoped or SystemScoped (company-wide handlers use AuthUser).
# The grep is approximate: each api/*.rs module must reference one of those extractors.
# Whitelist: mod.rs (router wiring), health.rs (public liveness), auth.rs (login/register
# endpoints are unauthenticated by design).
for api_file in "$SRV_SRC/api/"*.rs; do
    name="$(basename "$api_file")"
    case "$name" in
        mod.rs|health.rs|auth.rs) continue ;;
    esac
    if ! grep -qE '(ProjectScoped|SystemScoped|AuthUser|claims\.is_company_admin)' "$api_file"; then
        echo "  !! API module $name has no permission extractor reference" >&2
        fail=1
    fi
done

if [ "$fail" -ne 0 ]; then
    echo "Audit/permission guard failed." >&2
    exit 1
fi

echo "OK: audit IP and WS audit coverage look good."
