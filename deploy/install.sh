#!/usr/bin/env bash
# Richtet einen frischen Debian-13-LXC für Mistwarden ein (einmalig, als root im LXC).
#
#   MISTWARDEN_DOMAIN=mistwarden.lan.example.org CADDY_DNS=cloudflare ./install.sh
#
# - Node.js 24 von nodejs.org (Prüfsumme geprüft) nach /opt/node
# - Dienstnutzer „mistwarden“, Daten in /var/lib/mistwarden, Code in /opt/mistwarden
# - Konfiguration in /etc/mistwarden/mistwarden.env (GM-Passwort wird abgefragt, kein Standard)
# - systemd-Dienst und tägliches Backup der Datenbank
# - Caddy als Reverse Proxy mit HTTPS: CADDY_DNS=cloudflare lädt Caddy mit DNS-Modul
#   (Let's Encrypt per DNS-Challenge), ohne CADDY_DNS das Debian-Paket (tls internal)
#
# Der Code selbst kommt danach per deploy/deploy.sh vom Entwicklungsrechner.
set -euo pipefail

NODE_MAJOR=24
APP_USER=mistwarden
APP_DIR=/opt/mistwarden
DATA_DIR=/var/lib/mistwarden
CONF_DIR=/etc/mistwarden
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "bitte als root ausführen"
[[ -r /etc/debian_version ]] || die "nur für Debian gedacht"
: "${MISTWARDEN_DOMAIN:?MISTWARDEN_DOMAIN setzen, z. B. mistwarden.lan.example.org}"

log "Pakete"
apt-get update -q
apt-get install -y -q ca-certificates curl xz-utils sqlite3 rsync

log "Node.js ${NODE_MAJOR}"
case "$(uname -m)" in
	x86_64) NODE_ARCH=x64 ;;
	aarch64) NODE_ARCH=arm64 ;;
	*) die "Architektur $(uname -m) nicht unterstützt" ;;
esac
NODE_BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$NODE_BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
NODE_FILE="$(grep -oE "node-v[0-9.]+-linux-${NODE_ARCH}\.tar\.xz" "$TMP/SHASUMS256.txt" | head -n1)"
[[ -n $NODE_FILE ]] || die "Node-Archiv nicht gefunden"
NODE_DIR="/opt/${NODE_FILE%.tar.xz}"
if [[ ! -x "$NODE_DIR/bin/node" ]]; then
	curl -fsSL "$NODE_BASE/$NODE_FILE" -o "$TMP/$NODE_FILE"
	(cd "$TMP" && grep " ${NODE_FILE}\$" SHASUMS256.txt | sha256sum -c -)
	tar -xJf "$TMP/$NODE_FILE" -C /opt
fi
ln -sfn "$NODE_DIR" /opt/node
/opt/node/bin/node --version

log "Dienstnutzer und Verzeichnisse"
if ! id "$APP_USER" >/dev/null 2>&1; then
	useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -o root -g root -m 0755 "$APP_DIR" "$APP_DIR/releases"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/assets" "$DATA_DIR/backups"
install -d -o root -g "$APP_USER" -m 0750 "$CONF_DIR"

ENV_FILE="$CONF_DIR/mistwarden.env"
if [[ ! -f $ENV_FILE ]]; then
	log "Konfiguration $ENV_FILE"
	GM_PASSWORD="${GM_PASSWORD:-}"
	if [[ -z $GM_PASSWORD && -t 0 ]]; then
		while :; do
			read -r -s -p "GM-Passwort (mindestens 10 Zeichen): " GM_PASSWORD; echo
			[[ ${#GM_PASSWORD} -ge 10 ]] && break
			echo "Zu kurz."
		done
	fi
	umask 027
	cat >"$ENV_FILE" <<EOF_ENV
# Mistwarden – Konfiguration (siehe .env.example im Repository)
PUBLIC_BASE_URL=https://${MISTWARDEN_DOMAIN}
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=${DATA_DIR}/mistwarden.sqlite
# Für Bilder z. B. einen Bind-Mount auf das NAS hier einhängen.
ASSET_STORAGE_PATH=${DATA_DIR}/assets
UPLOAD_MAX_MB=200
IMPORT_MAX_MB=500
TRUST_PROXY=true
GM_PASSWORD=${GM_PASSWORD}
EOF_ENV
	chown root:"$APP_USER" "$ENV_FILE"
	chmod 0640 "$ENV_FILE"
	[[ -n $GM_PASSWORD ]] || echo "Achtung: GM_PASSWORD in $ENV_FILE eintragen, sonst startet der Dienst nicht."
else
	log "Konfiguration $ENV_FILE existiert, bleibt unverändert"
fi

log "systemd-Dienst und Backup"
install -m 0644 "$HERE/mistwarden.service" /etc/systemd/system/mistwarden.service
install -m 0755 "$HERE/backup.sh" /usr/local/sbin/mistwarden-backup
cat >/etc/systemd/system/mistwarden-backup.service <<'EOF_UNIT'
[Unit]
Description=Mistwarden: Datenbank sichern

[Service]
Type=oneshot
User=mistwarden
ExecStart=/usr/local/sbin/mistwarden-backup
EOF_UNIT
cat >/etc/systemd/system/mistwarden-backup.timer <<'EOF_UNIT'
[Unit]
Description=Mistwarden: tägliche Sicherung der Datenbank

[Timer]
OnCalendar=*-*-* 04:20
Persistent=true

[Install]
WantedBy=timers.target
EOF_UNIT
systemctl daemon-reload
systemctl enable mistwarden.service mistwarden-backup.timer
systemctl start mistwarden-backup.timer

log "Caddy (HTTPS)"
if [[ -n ${CADDY_DNS:-} ]]; then
	[[ $CADDY_DNS =~ ^[a-z0-9-]+$ ]] || die "CADDY_DNS ungültig"
	CADDY_ARCH=$([[ $NODE_ARCH == x64 ]] && echo amd64 || echo arm64)
	curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}&p=github.com/caddy-dns/${CADDY_DNS}" -o "$TMP/caddy"
	install -m 0755 "$TMP/caddy" /usr/local/bin/caddy
	/usr/local/bin/caddy list-modules | grep -q "dns.providers.${CADDY_DNS}" || die "DNS-Modul fehlt im Caddy-Download"
	id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
	cat >/etc/systemd/system/caddy.service <<'EOF_UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
EnvironmentFile=/etc/caddy/caddy.env
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=yes
ProtectSystem=full
PrivateTmp=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF_UNIT
	CADDYFILE_SRC="$HERE/Caddyfile.example"
else
	apt-get install -y -q caddy
	# Debian-Paket ohne DNS-Module: eigene Zertifizierungsstelle (Variante B).
	CADDYFILE_SRC="$TMP/Caddyfile"
	cat >"$CADDYFILE_SRC" <<'EOF_CADDY'
{$MISTWARDEN_DOMAIN} {
	tls internal
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF_CADDY
	mkdir -p /etc/systemd/system/caddy.service.d
	cat >/etc/systemd/system/caddy.service.d/mistwarden.conf <<'EOF_UNIT'
[Service]
EnvironmentFile=/etc/caddy/caddy.env
EOF_UNIT
fi
install -d -m 0755 /etc/caddy
[[ -f /etc/caddy/Caddyfile.mistwarden ]] || install -m 0644 "$CADDYFILE_SRC" /etc/caddy/Caddyfile.mistwarden
install -m 0644 /etc/caddy/Caddyfile.mistwarden /etc/caddy/Caddyfile
if [[ ! -f /etc/caddy/caddy.env ]]; then
	umask 077
	{
		echo "MISTWARDEN_DOMAIN=${MISTWARDEN_DOMAIN}"
		[[ -n ${CADDY_DNS:-} ]] && echo "CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-}"
	} >/etc/caddy/caddy.env
	chown root:caddy /etc/caddy/caddy.env
	chmod 0640 /etc/caddy/caddy.env
fi
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy || echo "Caddy startet noch nicht – Token in /etc/caddy/caddy.env prüfen."

log "Fertig"
cat <<EOF_DONE
Nächste Schritte:
  1. Im lokalen DNS ${MISTWARDEN_DOMAIN} auf die feste IP dieses LXC zeigen lassen.
  2. Vom Entwicklungsrechner: deploy/deploy.sh root@<LXC>
  3. https://${MISTWARDEN_DOMAIN} öffnen.
EOF_DONE
