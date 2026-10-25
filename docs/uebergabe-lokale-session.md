# Übergabe: lokale Session ab dem 30.10.2026

Diese Datei ist der Einstieg für die nächste Claude-Code-Session auf dem Mac. Sie kann als erste Nachricht dienen: „Lies `docs/uebergabe-lokale-session.md` und arbeite sie ab.“

## Stand

- Stufe 1 (Schritte 1–9) liegt auf `main` (PR #1). `npm run ci` ist grün (202 Tests), die GitHub-CI ebenfalls.
- **Nichts davon ist auf einem Gerät getestet.** Geprüft wurde nur in der Cloud: automatische Tests mit echtem Server, Rauchtests in Chromium (Playwright) mit GM und zwei Spielern, ein Release-Start nur mit Produktions-Abhängigkeiten.
- Ungetestet: Touch-Bedienung, Safari 17, PWA über HTTPS, `deploy/install.sh` auf einem echten Debian-LXC, Caddy-Download mit DNS-Modul, Docker.
- Regel aus `CLAUDE.md`: nichts aus Stufe 2 oder 3, bevor eine echte Session mit Stufe 1 gelaufen ist.

## Reihenfolge

### 1. Lokal starten (Mac, Node 24, npm 11)

```bash
git pull && npm ci
cp .env.example .env   # GM_PASSWORD setzen (≥ 10 Zeichen)
npm run ci
npm run dev:server & npm run dev:client
```

Im Browser `http://localhost:5173` öffnen, einen Raum anlegen und zwei Spieler in privaten Fenstern beitreten lassen.

### 2. Gerätetest (Safari auf dem Mac, iPad-Simulator mit Xcode)

Gefundene Fehler direkt beheben, mit Test, falls die Logik betroffen ist. Zu prüfen:

- [ ] **Touch:** Langes Drücken auf freie Fläche pingt, auf einem Token öffnet es die Auswahl. Mit zwei Fingern zoomen, ohne dass ein Strich oder eine Messung entsteht.
- [ ] **Zeichnen:** Freihand, Linie, Rechteck und Ellipse. Der Radierer trifft dünne Linien mit dem Finger. „Meine löschen“ und „Alle löschen“ funktionieren.
- [ ] **Messen** auf Quadrat- und Hex-Grid. Die Diagonalregel ist im Menü umstellbar, die Beschriftung bleibt beim Verschieben richtig.
- [ ] **Würfel:** Formeln, Schnellknöpfe, verdeckter GM-Wurf (Spieler sieht nichts). Die Tastatur verdeckt das Formelfeld nicht.
- [ ] **Notizen:** setzen, ziehen, freigeben, bearbeiten.
- [ ] **Handouts:** Text und großes Bild, an einen Spieler, Wechsel der Empfänger. Nach Displaysperre öffnet sich ein inzwischen gezeigtes Handout.
- [ ] **Rückgängig/Wiederholen:** ↶/↷ und ⌘Z für Token, Fog und Zeichnungen.
- [ ] **Export/Import** in Safari: Download und Import einer Datei mit mehreren Karten.
- [ ] **Reconnect:** Displaysperre im Simulator und WLAN aus und an. Log, Handouts und Zeichnungen sind danach vollständig, ein Wurf während der Trennung erscheint genau einmal.
- [ ] **Safari-17-Risiko:** Der Simulator läuft mit iPadOS 27. Neue Web-APIs vor dem Einsatz auf Safari-17-Unterstützung prüfen; das Build-Ziel `safari17` bleibt.

### 3. LXC auf Proxmox mit HTTPS (Schritt 9)

Vorher entscheiden (der Nutzer):

1. **HTTPS-Variante.**
   - A (empfohlen): Let's Encrypt per DNS-Challenge. Braucht eine eigene Domain mit DNS-API, z. B. Cloudflare, und einen API-Token „Zone → DNS → Bearbeiten“.
   - B: `tls internal`. Ohne Domain, aber auf jedem iPad muss ein Root-Zertifikat installiert und als vertrauenswürdig markiert werden.
2. **Hostname** im LAN (z. B. `mistwarden.lan.<domain>`) und lokaler DNS-Eintrag (Router oder Pi-hole) auf die feste IP des LXC.
3. **Bild-Ablage:** Bind-Mount auf das NAS für `ASSET_STORAGE_PATH`, ja oder nein.

Danach:

```bash
# Auf dem Proxmox-Host (Werte anpassen; Template vorher mit `pveam update` laden)
pct create <ID> local:vztmpl/debian-13-standard_*.tar.zst \
  --hostname mistwarden --cores 2 --memory 2048 --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=<IP>/24,gw=<GW> --unprivileged 1 --features nesting=1
# optional NAS: pct set <ID> -mp0 /mnt/nas/mistwarden,mp=/var/lib/mistwarden/assets
pct start <ID>

# Im LXC als root (deploy/ vorher hineinkopieren, z. B. per scp)
MISTWARDEN_DOMAIN=mistwarden.lan.<domain> CADDY_DNS=cloudflare ./deploy/install.sh
# Token eintragen: /etc/caddy/caddy.env → CLOUDFLARE_API_TOKEN=…, dann: systemctl restart caddy

# Vom Mac (sauberes Arbeitsverzeichnis, SSH-Zugang zum LXC)
deploy/deploy.sh root@<IP>
```

Prüfen:

- [ ] `install.sh` läuft auf Debian 13 ohne Fehler durch. Kandidaten für Probleme: Caddy-Download, `caddy list-modules`, Rechte von `/etc/caddy/caddy.env` für den Nutzer `caddy`.
- [ ] `deploy.sh`: `npm ci --omit=dev` im LXC (braucht Internet für die vorgebauten Binärpakete von better-sqlite3 und sharp), Healthcheck, Rollback. Den Rollback einmal absichtlich auslösen, z. B. mit kaputtem `GM_PASSWORD`.
- [ ] `https://<hostname>` hat ein gültiges Zertifikat auf Mac und iPad. WebSocket über `wss://` funktioniert, Uploads großer Karten gehen durch den Proxy.
- [ ] `systemctl start mistwarden-backup` legt eine Sicherung an. Die Wiederherstellung laut README einmal durchspielen.
- [ ] Die Härtung in `deploy/mistwarden.service` blockiert nichts (Kartenverarbeitung mit sharp, Schreiben unter `/var/lib/mistwarden`). Bei Problemen `journalctl -u mistwarden`.

### 4. PWA auf dem echten iPad (erst über HTTPS möglich)

- [ ] In Safari „Teilen → Zum Home-Bildschirm“. Die App startet ohne Browserleiste.
- [ ] Spieler: In der PWA den Spieler-Link in „Als Spieler beitreten“ einfügen. Nach einem Neustart der App landet man direkt im Raum.
- [ ] Große Karte auf dem iPad 6: kein Absturz, Speicher bleibt im Budget.

### 5. Testsession am Tisch

Owlbear Rodeo als Backup bereithalten. Danach Fehler und Wünsche sammeln. Erst dann über Stufe 2 entscheiden.

## Hinweise für die Session

- Oberfläche, Kommentare und Commits auf Deutsch. Biome-Format (Tabs, doppelte Anführungszeichen). Keine neuen Abhängigkeiten ohne Rückfrage und Lizenzprüfung. Keine geschützten Begriffe von Wizards of the Coast oder Owlbear Rodeo in Code oder Oberfläche.
- Client-Bundles liegen unter `/app/`, Bilder und Kacheln unter `/assets/` (Server). Der Node-Server liefert im Betrieb den gebauten Client mit aus.
- Exportdateien können lizenzierte Karten enthalten und gehören nicht ins Repository (`exports/` ist ignoriert).
