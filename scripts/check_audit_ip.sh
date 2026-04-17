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

# CON-83: Permission-gating coverage is now enforced at compile/test time by
# the `rbac_macro_coverage::every_api_handler_is_permission_gated` integration
# test in `containerus-server`. That scan is syntactically accurate (uses
# `syn`) and catches the regression this block used to approximate via grep.
# Run `cargo test -p containerus-server --test rbac_macro_coverage` to invoke
# it, or rely on the standard test job.

if [ "$fail" -ne 0 ]; then
    echo "Audit/permission guard failed." >&2
    exit 1
fi

echo "OK: audit IP and WS audit coverage look good."
