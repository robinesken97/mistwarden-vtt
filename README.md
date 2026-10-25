# Mistwarden

Ein selbst gehostetes, schlankes Virtual Tabletop für die eigene Runde: Karten, Tokens, Fog und Würfel im Browser, ohne Upload-Limits und ohne Abo. Die Daten bleiben auf dem eigenen Server.

> **Status:** Stufe 1 ist umgesetzt, aber noch nicht auf echten iPads und nicht auf dem echten LXC getestet. Es fehlen die Einrichtung auf Proxmox mit HTTPS im LAN (Skripte in `deploy/`) und die erste Testsession am Tisch.

Ziele, Umfang und Architektur stehen in [SPEC.md](SPEC.md).

## Entwicklung

Voraussetzung: Node.js 24 LTS.

```bash
npm ci
cp .env.example .env  # GM_PASSWORD eintragen (mindestens 10 Zeichen)
npm run dev:server    # App-Server auf 127.0.0.1:3000
npm run dev:client    # Vite-Entwicklungsserver mit Proxy für /api und /ws
```

Dann `http://localhost:5173` öffnen, mit dem GM-Passwort anmelden, einen Raum anlegen und den Spieler-Link in einem zweiten Browser bzw. privaten Fenster öffnen.

Im Betrieb liefert der App-Server auch den gebauten Client aus (`apps/client/dist`, abweichend über `CLIENT_DIST_PATH`); es läuft also nur ein Prozess hinter dem Reverse Proxy:

```bash
npm ci && npm run build
npm start             # Client, API, WebSocket und Bilder auf HOST:PORT
```

### Zugang

- **Spielleitung:** ein Passwort für die ganze Installation (`GM_PASSWORD`). Damit lassen sich Räume anlegen und alle Räume betreten.
- **Spieler:** treten über den Spieler-Link `…/join#<token>` mit ihrem Namen bei, ohne Account. Der Token steht hinter `#` und landet deshalb in keinem Server- oder Proxy-Log. Die Spielleitung kann den Link jederzeit neu erzeugen; wer schon beigetreten ist, bleibt drin.
- Sitzungen liegen im Browser (`localStorage`) und überstehen ein Neuladen.

### Karten

- Die Spielleitung lädt Karten als PNG, JPEG oder WebP hoch (Größe über `UPLOAD_MAX_MB`, höchstens 30 000 px Kantenlänge). Der Server prüft den Dateityp am Inhalt und kodiert das Bild neu: als Pyramide aus WebP-Kacheln (1024 px), jede Stufe halb so groß wie die vorige. Das Original bleibt in `ASSET_STORAGE_PATH` erhalten, wird aber nie ausgeliefert.
- Kacheln sind ohne Anmeldung unter einer zufälligen Asset-ID abrufbar und werden lange zwischengespeichert. Kartenbilder gelten nicht als geheim (siehe unten).
- Der Browser lädt nur die sichtbaren Kacheln in der passenden Stufe und hält ein festes Grafikspeicher-Budget ein (Touch-Geräte 96 MiB, sonst 256 MiB). Die volle Auflösung liegt nie als eine Textur im Speicher.
- Das Grid (Quadrate oder Hexfelder) wird per Shader gezeichnet; Größe und Versatz stellt die Spielleitung in Kartenpixeln ein.

### Tokens

- Die Spielleitung lädt Token-Bilder hoch (auf 512 px verkleinert) und platziert sie als Token oder als Prop (Möbel, Türen, Deko). Größe in Feldern, Drehung, Besitzer und Ebene stellt sie in der Auswahlleiste ein.
- Spieler bewegen und drehen nur ihre eigenen Tokens; alles andere prüft der Server. Props bewegt nur die Spielleitung, und nur wenn „Props sperren“ aus ist.
- Tokens rasten am Grid ein (Quadrate: ungerade Größen in die Feldmitte, gerade auf den Kreuzungspunkt; Hex: Feldmitte). Freies Setzen: Alt-Taste beim Loslassen oder Schalter „Einrasten: aus“.
- Bedienung: antippen bzw. klicken wählt aus, ziehen verschiebt das eigene Token, sonst die Karte; zwei Finger oder Mausrad zoomen; langes Drücken bzw. Rechtsklick öffnet die Auswahl.
- Tokens einer verdeckten Szene sind für Spieler unsichtbar und werden ihnen nicht übertragen. Einzelne Tokens kann die Spielleitung auch ohne Fog verstecken („Verstecken“); Spieler bekommen sie dann gar nicht erst.

### Fog

- Fog-Flächen decken ab; zum Aufdecken schaltet die Spielleitung eine Fläche aus (und kann sie wieder einschalten). Freischneiden aus einer Fläche kommt in Stufe 2.
- Zeichnen mit „Fog: Polygon“ (Ecken antippen, auf den ersten Punkt tippen oder „Fertig“; am Laptop Enter, Escape, Backspace) oder „Fog: Pinsel“ (Größe in Feldern). Beim Zeichnen verschieben und zoomen zwei Finger bzw. das Mausrad.
- Fog wird ausschließlich als Polygone gespeichert, nie als Pixelmaske.
- Für Spieler ist der Fog deckender, langsam ziehender Nebel (Shader), für die Spielleitung halbtransparent. Die Animation lässt sich pro Gerät unter „Darstellung“ abschalten.

### Würfel, Ping, Messen, Zeichnen

- **Würfel:** „Würfel“ öffnet das Log des Raums. Formeln wie `1d20+5`, `4d6kh3` (die drei höchsten behalten), `2d20kl1` (den niedrigsten behalten) oder `d%`; dazu Schnellknöpfe d4 bis d100. Der Server würfelt mit kryptografischem Zufall, Clients schicken nur die Formel. Das Log behält die letzten 200 Würfe. Würfe der Spielleitung sind standardmäßig verdeckt (Schalter im Log) und gehen nie an Spieler.
- **Ping:** langes Drücken (Touch) bzw. Rechtsklick (Maus) auf eine freie Stelle zeigt allen, die die Szene sehen, einen Ping in der eigenen Farbe. Pings werden nicht gespeichert.
- **Messen:** „Messen“ wählen und ziehen; gemessen wird von Feldmitte zu Feldmitte in Feldern und in der Einheit der Szene (Standard 5 ft pro Feld). Einheit, Wert pro Feld und Diagonalregel (jede Diagonale 1 Feld, abwechselnd 1-2-1, Luftlinie) stellt die Spielleitung pro Szene im Menü unter „Messen“ ein; auf Hex-Grids zählt die Hex-Distanz. Die Messung sieht nur, wer misst.
- **Zeichnen:** Freihand, Linie, Rechteck oder Ellipse in drei Strichstärken. Spieler zeichnen in ihrer Farbe und löschen nur eigene Zeichnungen (Radierer antippen bzw. darüberziehen, oder „Meine löschen“); die Spielleitung wählt die Farbe und löscht alle. Zeichnungen gehören zur Szene und folgen ihrer Sichtbarkeit.

### Notizen und Handouts

- **Notizen:** Die Spielleitung setzt sie im Menü unter „Notizen“ (in der Bildmitte), verschiebt sie per Ziehen und öffnet sie per Antippen. Neue Notizen sind nur für die Spielleitung sichtbar; mit „Für Spieler sichtbar“ sehen sie alle, die die Szene sehen. Verdeckte Notizen werden Spielern nicht übertragen.
- **Handouts:** Text und/oder Bild, im Menü unter „Handouts“. Empfänger: Entwurf (nur Spielleitung), alle oder ausgewählte Spieler. „Zeigen“ öffnet das Handout bei den Empfängern sofort, auch wenn ein Gerät gerade getrennt war; später finden sie es unter „Handouts“. Andere Spieler erhalten es nicht. Handout-Bilder erscheinen auch in der Bildliste für Karten.

### Rückgängig, PWA, Raum-Export

- **Rückgängig/Wiederholen:** Knöpfe ↶ und ↷ oben bzw. Strg/⌘+Z und Strg/⌘+Umschalt+Z (oder Strg+Y). Gilt für eigene Änderungen an Tokens, Fog, Zeichnungen und Notizen auf diesem Gerät, bis zu 50 Schritte. Hat jemand anderes das Objekt inzwischen geändert, wird nichts überschrieben.
- **PWA:** Auf dem iPad in Safari „Teilen → Zum Home-Bildschirm“; Mistwarden startet dann ohne Browserleiste. Das geht nur über HTTPS (Schritt 9). Eine Web-App vom Home-Bildschirm hat auf dem iPad eigenen Speicher: Spieler fügen dort beim ersten Start ihren Spieler-Link in das Feld „Als Spieler beitreten“ ein; danach öffnet sie direkt den Raum. Der Service Worker hält nur die App selbst vor, nie Spielstand oder Kartenkacheln.
- **Raum-Export/-Import:** In der Raumliste „Exportieren“ speichert einen Raum als JSON-Datei (Szenen, Tokens, Fog, Zeichnungen, Notizen, Handouts und die verwendeten Bilder als Original). „Raum importieren“ legt daraus einen neuen Raum an; Bilder werden dabei neu kodiert. Spieler und Würfel-Log gehören nicht dazu: Spieler treten im neuen Raum neu bei, ihre Tokens und Zeichnungen gehören danach der Spielleitung, Szenen und Handouts für einzelne Spieler sind verdeckt. Größte Importdatei: `IMPORT_MAX_MB`. Exportdateien können lizenzierte Karten enthalten – nicht ins Repository legen (`exports/` ist ignoriert).

Weitere Befehle: `npm test`, `npm run typecheck`, `npm run check` (Lint und Format), `npm run build`.

### Aufbau

| Pfad | Inhalt |
| --- | --- |
| `packages/protocol` | gemeinsame Nachrichtentypen und Schemas für Client und Server |
| `apps/server` | autoritativer App-Server: HTTP, WebSocket, SQLite |
| `apps/client` | Browser-Client (TypeScript, Vite, PixiJS mit WebGL) |

## Installation (LXC/Debian)

Die eigene Installation läuft als plain LXC auf Proxmox (Debian 13, feste IP). Alles liegt in [`deploy/`](deploy/). Die Skripte richten keine Firewall ein und öffnen nichts nach außen.

1. **LXC anlegen:** Debian 13, unprivilegiert, 2 Kerne, 2 GB RAM, feste IP. Für Bilder optional einen Bind-Mount auf das NAS einhängen und `ASSET_STORAGE_PATH` darauf zeigen lassen.
2. **Einrichten (einmalig, als root im LXC):** Repository oder nur den Ordner `deploy/` in den LXC kopieren, dann:
   ```bash
   MISTWARDEN_DOMAIN=mistwarden.lan.example.org CADDY_DNS=cloudflare ./deploy/install.sh
   ```
   Das installiert Node.js 24 (Prüfsumme geprüft) nach `/opt/node`, legt den Dienstnutzer `mistwarden` an und richtet den systemd-Dienst, die tägliche Datenbanksicherung und Caddy als HTTPS-Proxy ein. Das GM-Passwort wird abgefragt und landet in `/etc/mistwarden/mistwarden.env` (nur für root und den Dienst lesbar); es gibt kein Standardpasswort.
3. **HTTPS im LAN:** Service Worker und PWA brauchen HTTPS, auch im LAN.
   - **Variante A, empfohlen:** echtes Zertifikat von Let's Encrypt per DNS-Challenge, ohne dass von außen etwas erreichbar ist. Voraussetzung ist eine eigene Domain bei einem DNS-Anbieter mit API. Beispiel Cloudflare: einen API-Token mit Recht „Zone → DNS → Bearbeiten“ in `/etc/caddy/caddy.env` als `CLOUDFLARE_API_TOKEN` eintragen. Im lokalen DNS (Router, Pi-hole o. ä.) den Namen auf die IP des LXC zeigen lassen. Andere Anbieter: `CADDY_DNS=<modul>` setzen und den `tls`-Block in `/etc/caddy/Caddyfile` anpassen ([Liste der Module](https://github.com/caddy-dns)).
   - **Variante B, ohne Domain:** `CADDY_DNS` weglassen. Caddy aus dem Debian-Paket erzeugt dann eine eigene Zertifizierungsstelle. Deren Root-Zertifikat (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`) muss auf jedem iPad als Profil installiert und unter *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* aktiviert werden.
4. **Code aufspielen (vom Entwicklungsrechner):**
   ```bash
   deploy/deploy.sh root@<LXC>
   ```
   Das Skript prüft und baut lokal (`npm run ci`) und überträgt nur die Laufzeitdateien in ein neues Release unter `/opt/mistwarden/releases/`. Danach sichert es die Datenbank, installiert die Produktions-Abhängigkeiten, schaltet um und startet neu. Schlägt der Healthcheck fehl, geht es automatisch zurück auf das vorige Release. Die letzten drei Releases bleiben liegen. Deployment ist bewusst manuell, nicht per CI.
5. **Sicherungen:** täglich 04:20 nach `/var/lib/mistwarden/backups/`, die letzten 14 bleiben, zusätzlich je eine vor jedem Deploy (die letzten 5). Bilder liegen in `ASSET_STORAGE_PATH` und werden dort gesichert, z. B. auf dem NAS. Wiederherstellen:
   ```bash
   systemctl stop mistwarden
   cp /var/lib/mistwarden/backups/<datei>.sqlite /var/lib/mistwarden/mistwarden.sqlite
   rm -f /var/lib/mistwarden/mistwarden.sqlite-wal /var/lib/mistwarden/mistwarden.sqlite-shm
   chown mistwarden: /var/lib/mistwarden/mistwarden.sqlite && systemctl start mistwarden
   ```
   Einzelne Räume lassen sich zusätzlich über „Exportieren“ in der Raumliste sichern.

Nützlich: `journalctl -u mistwarden -f` (Log), `systemctl restart mistwarden`, `curl http://127.0.0.1:3000/healthz`.

### Docker (optional, für andere Installationen)

`Dockerfile` und `compose.example.yaml` bauen ein Image mit Server und Client; Daten liegen im Volume `/data`. HTTPS übernimmt ein Reverse Proxy davor. Das Docker-Setup ist bisher nicht getestet.

```bash
cp .env.example .env              # GM_PASSWORD eintragen
cp compose.example.yaml compose.yaml
docker compose up -d --build
```

## Bekannte Einschränkungen

Kartenbilder und Wanddaten liegen vollständig im Client, auch unter dem Fog. Wer die Entwicklertools des Browsers nutzt, kann sie sehen. Das ist bewusst so entschieden.

## Lizenz

[AGPL-3.0](LICENSE). Wer Mistwarden verändert und als Dienst anbietet, muss den geänderten Quellcode offenlegen.
