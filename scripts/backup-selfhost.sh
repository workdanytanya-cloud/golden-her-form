#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SELFHOST_MEDIA_ROOT:?SELFHOST_MEDIA_ROOT is required}"
: "${BACKUP_ROOT:?BACKUP_ROOT is required}"

case "$SELFHOST_MEDIA_ROOT" in /var/lib/panovapro/*) ;; *) echo "Refusing unexpected media root" >&2; exit 2;; esac
case "$BACKUP_ROOT" in /*) ;; *) echo "BACKUP_ROOT must be absolute" >&2; exit 2;; esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_ROOT/$stamp"
install -d -m 0700 "$target"
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$target/postgres.dump"
tar --create --gzip --file "$target/uploads.tar.gz" --directory "$SELFHOST_MEDIA_ROOT" .
sha256sum "$target/postgres.dump" "$target/uploads.tar.gz" > "$target/SHA256SUMS"
echo "$target"
