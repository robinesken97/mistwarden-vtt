#!/usr/bin/env bash
# Sichert die SQLite-Datenbank konsistent im laufenden Betrieb (WAL-sicher über .backup)
# und behält die letzten 14 Sicherungen. Bilder liegen im ASSET_STORAGE_PATH (z. B. NAS)
# und werden dort gesichert, nicht hier.
set -euo pipefail

DB="${DATABASE_PATH:-/var/lib/mistwarden/mistwarden.sqlite}"
DIR="${BACKUP_DIR:-/var/lib/mistwarden/backups}"
KEEP="${BACKUP_KEEP:-14}"
NAME="${1:-mistwarden-$(date +%Y-%m-%d_%H%M%S).sqlite}"

[[ -f $DB ]] || { echo "Keine Datenbank unter $DB – nichts zu sichern."; exit 0; }
mkdir -p "$DIR"
sqlite3 "$DB" ".backup '$DIR/$NAME'"
sqlite3 "$DIR/$NAME" "PRAGMA integrity_check;" | grep -qx ok
echo "Gesichert: $DIR/$NAME"

# Ausdünnen: tägliche Sicherungen bis KEEP, Sicherungen vor einem Deploy die letzten 5.
# Dateinamen sind selbst erzeugt (ohne Leerzeichen); ls -t sortiert nach Alter.
prune() {
	local pattern="$1" keep="$2" f
	# Glob soll sich hier entfalten.
	# shellcheck disable=SC2012,SC2086
	ls -1t "$DIR"/$pattern 2>/dev/null | tail -n +"$((keep + 1))" | while read -r f; do
		rm -f -- "$f"
	done
}
prune 'mistwarden-*.sqlite' "$KEEP"
prune 'vor-deploy-*.sqlite' 5
