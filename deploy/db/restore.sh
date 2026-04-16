#!/usr/bin/env bash
# PostgreSQL restore script for containerus-server
#
# Usage:
#   ./deploy/db/restore.sh --backup-file /path/to/backup.sql.gz
#
# Environment variables:
#   DATABASE_URL   — postgres connection URL (required)
#
# WARNING: This will DROP and recreate the target database.
#          Always test on a non-production instance first.

set -euo pipefail

BACKUP_FILE=""
DRY_RUN=false

# ── Parse arguments ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file) BACKUP_FILE="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=true;     shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Validate ───────────────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL is not set." >&2
  exit 1
fi

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Error: --backup-file is required." >&2
  echo "Usage: $0 --backup-file /path/to/backup.sql.gz" >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

# ── Parse DATABASE_URL ─────────────────────────────────────────────────────
export PGPASSWORD
PGPASSWORD=$(echo "$DATABASE_URL" | sed -E 's|postgres://[^:]+:([^@]+)@.*|\1|')
PGHOST=$(echo "$DATABASE_URL" | sed -E 's|postgres://[^@]+@([^:/]+).*|\1|')
PGPORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
PGUSER=$(echo "$DATABASE_URL" | sed -E 's|postgres://([^:]+):.*|\1|')
PGDATABASE=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

export PGHOST PGPORT PGUSER

echo "==================================================="
echo "  Containerus PostgreSQL Restore"
echo "==================================================="
echo "  Host:     $PGHOST:$PGPORT"
echo "  Database: $PGDATABASE"
echo "  Backup:   $BACKUP_FILE"
echo "  Dry run:  $DRY_RUN"
echo "==================================================="
echo ""
echo "WARNING: This will DROP and recreate '$PGDATABASE'."
echo "All existing data will be permanently deleted."
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY RUN] Would restore $BACKUP_FILE to $PGDATABASE. Exiting."
  exit 0
fi

read -r -p "Type the database name to confirm: " CONFIRM
if [[ "$CONFIRM" != "$PGDATABASE" ]]; then
  echo "Aborted — confirmation did not match." >&2
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Stopping application connections..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$PGDATABASE' AND pid <> pg_backend_pid();" \
  > /dev/null || true

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dropping and recreating database..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $PGDATABASE;"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE $PGDATABASE OWNER $PGUSER;"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restoring from backup..."
if [[ "$BACKUP_FILE" == *.gpg ]]; then
  gpg --decrypt "$BACKUP_FILE" | zcat | pg_restore \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$PGDATABASE" --no-password --verbose
else
  zcat "$BACKUP_FILE" | pg_restore \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$PGDATABASE" --no-password --verbose
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restore complete."
echo "Verify by connecting: psql $DATABASE_URL"
