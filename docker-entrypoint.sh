#!/bin/sh
# Make the mounted data dir writable for PUID:PGID, then drop root privileges.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
mkdir -p "$STONKSFOLIO_DATA_DIR"
chown -R "$PUID:$PGID" "$STONKSFOLIO_DATA_DIR"
exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
