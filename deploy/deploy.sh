#!/usr/bin/env bash
# Spielt den aktuellen Stand vom Entwicklungsrechner auf den LXC (bewusst manuell, nicht per CI).
#
#   deploy/deploy.sh root@mistwarden-lxc
#
# Ablauf: lokal prüfen und bauen (npm run ci) → neues Release-Verzeichnis per rsync →
# Datenbank sichern → Produktions-Abhängigkeiten installieren → umschalten → Dienst neu
# starten → Healthcheck. Schlägt der Healthcheck fehl, geht es zurück aufs vorige Release.
set -euo pipefail

TARGET="${1:?Ziel angeben, z. B. root@mistwarden-lxc}"
KEEP_RELEASES=3
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE="$(date +%Y%m%d-%H%M%S)-$(git -C "$ROOT" rev-parse --short HEAD)"

cd "$ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
	echo "Arbeitsverzeichnis nicht sauber – erst committen." >&2
	exit 1
fi

echo "==> Prüfen und bauen (npm run ci)"
npm ci
npm run ci

echo "==> Release $RELEASE übertragen"
DEST="/opt/mistwarden/releases/$RELEASE"
# shellcheck disable=SC2029 # $DEST soll lokal eingesetzt werden.
ssh "$TARGET" "mkdir -p '$DEST'"
rsync -a --delete --filter='merge deploy/release-files.txt' ./ "$TARGET:$DEST/"

echo "==> Auf dem LXC: sichern, installieren, umschalten"
ssh "$TARGET" bash -s -- "$RELEASE" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail
RELEASE="$1"; KEEP="$2"
BASE=/opt/mistwarden
export PATH=/opt/node/bin:$PATH
cd "$BASE/releases/$RELEASE"

runuser -u mistwarden -- /usr/local/sbin/mistwarden-backup "vor-deploy-$RELEASE.sqlite"
npm ci --omit=dev --no-audit --no-fund
chown -R root:root .

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
ln -sfn "$BASE/releases/$RELEASE" "$BASE/current.new"
mv -T "$BASE/current.new" "$BASE/current"
systemctl restart mistwarden

healthy=false
for _ in $(seq 1 30); do
	if curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then healthy=true; break; fi
	sleep 1
done
if [[ $healthy != true ]]; then
	echo "Healthcheck fehlgeschlagen." >&2
	journalctl -u mistwarden -n 30 --no-pager >&2 || true
	if [[ -n $PREVIOUS && -d $PREVIOUS ]]; then
		echo "Zurück auf $PREVIOUS" >&2
		ln -sfn "$PREVIOUS" "$BASE/current.new"
		mv -T "$BASE/current.new" "$BASE/current"
		systemctl restart mistwarden
	fi
	exit 1
fi

# Alte Releases aufräumen (das aktuelle bleibt immer).
cd "$BASE/releases"
ls -1t | tail -n +"$((KEEP + 1))" | while read -r old; do
	[[ "$BASE/releases/$old" == "$(readlink -f "$BASE/current")" ]] || rm -rf -- "$old"
done
echo "Release $RELEASE läuft."
REMOTE
