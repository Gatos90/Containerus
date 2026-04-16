#!/usr/bin/env bash
# PostgreSQL backup script for containerus-server
#
# Usage:
#   ./deploy/db/backup.sh [--output-dir /path/to/backups] [--keep-days 30]
#
# Environment variables:
#   DATABASE_URL   — postgres connection URL (required)
#   BACKUP_DIR     — where to write backup files (default: ./backups)
#   KEEP_DAYS      — days of backups to retain (default: 30)
#   GPG_RECIPIENT  — GPG key ID to encrypt backup (optional)
#
# Docker Compose usage:
#   docker compose -f deploy/docker-compose.prod.yml exec db \
#     bash -c "pg_dump -U containerus containerus | gzip" > backup-$(date +%Y%m%d).sql.gz

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ── Parse arguments ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) BACKUP_DIR="$2"; shift 2 ;;
    --keep-days)  KEEP_DAYS="$2";  shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Validate ───────────────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL is not set." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── Parse DATABASE_URL → pg_dump env vars ─────────────────────────────────
# Expected format: postgres://user:pass@host:port/dbname
export PGPASSWORD
PGPASSWORD=$(echo "$DATABASE_URL" | sed -E 's|postgres://[^:]+:([^@]+)@.*|\1|')
PGHOST=$(echo "$DATABASE_URL" | sed -E 's|postgres://[^@]+@([^:/]+).*|\1|')
PGPORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
PGUSER=$(echo "$DATABASE_URL" | sed -E 's|postgres://([^:]+):.*|\1|')
PGDATABASE=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

export PGHOST PGPORT PGUSER PGDATABASE

BACKUP_FILE="$BACKUP_DIR/containerus_${PGDATABASE}_${TIMESTAMP}.sql.gz"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup of '$PGDATABASE' → $BACKUP_FILE"

# ── Dump ──────────────────────────────────────────────────────────────────
pg_dump \
  --format=custom \
  --compress=9 \
  --no-password \
  --verbose \
  "$PGDATABASE" \
  | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# ── Optional GPG encryption ────────────────────────────────────────────────
if [[ -n "${GPG_RECIPIENT:-}" ]]; then
  gpg --recipient "$GPG_RECIPIENT" --encrypt "$BACKUP_FILE"
  rm "$BACKUP_FILE"
  BACKUP_FILE="${BACKUP_FILE}.gpg"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Encrypted: $BACKUP_FILE"
fi

# ── Verify backup is readable ─────────────────────────────────────────────
if [[ -z "${GPG_RECIPIENT:-}" ]]; then
  OBJECT_COUNT=$(zcat "$BACKUP_FILE" | head -c 1M | wc -l)
  if [[ $OBJECT_COUNT -lt 10 ]]; then
    echo "Warning: backup appears very small ($OBJECT_COUNT lines in first 1MB)" >&2
  fi
fi

# ── Rotate old backups ────────────────────────────────────────────────────
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Removing backups older than ${KEEP_DAYS} days..."
find "$BACKUP_DIR" -name "containerus_${PGDATABASE}_*.sql.gz*" \
  -mtime +"$KEEP_DAYS" -type f -delete -print

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup job finished."
echo "Latest backup: $BACKUP_FILE"
