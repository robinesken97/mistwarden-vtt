# Mistwarden

Ein selbst gehostetes, schlankes Virtual Tabletop für die eigene Runde: Karten, Tokens, Fog und Würfel im Browser, ohne Upload-Limits und ohne Abo. Die Daten bleiben auf dem eigenen Server.

> **Status:** frühe Entwicklung (Stufe 1, Schritt 3: Karten mit Grid). Noch nicht spielbar – Tokens, Fog und Würfel folgen.

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

### Zugang

- **Spielleitung:** ein Passwort für die ganze Installation (`GM_PASSWORD`). Damit lassen sich Räume anlegen und alle Räume betreten.
- **Spieler:** treten über den Spieler-Link `…/join#<token>` mit ihrem Namen bei, ohne Account. Der Token steht hinter `#` und landet deshalb in keinem Server- oder Proxy-Log. Die Spielleitung kann den Link jederzeit neu erzeugen; wer schon beigetreten ist, bleibt drin.
- Sitzungen liegen im Browser (`localStorage`) und überstehen ein Neuladen.

### Karten

- Die Spielleitung lädt Karten als PNG, JPEG oder WebP hoch (Größe über `UPLOAD_MAX_MB`, höchstens 30 000 px Kantenlänge). Der Server prüft den Dateityp am Inhalt und kodiert das Bild neu: als Pyramide aus WebP-Kacheln (1024 px), jede Stufe halb so groß wie die vorige. Das Original bleibt in `ASSET_STORAGE_PATH` erhalten, wird aber nie ausgeliefert.
- Kacheln sind ohne Anmeldung unter einer zufälligen Asset-ID abrufbar und werden lange zwischengespeichert. Kartenbilder gelten nicht als geheim (siehe unten).
- Der Browser lädt nur die sichtbaren Kacheln in der passenden Stufe und hält ein festes Grafikspeicher-Budget ein (Touch-Geräte 96 MiB, sonst 256 MiB). Die volle Auflösung liegt nie als eine Textur im Speicher.
- Das Grid (Quadrate oder Hexfelder) wird per Shader gezeichnet; Größe und Versatz stellt die Spielleitung in Kartenpixeln ein.

Weitere Befehle: `npm test`, `npm run typecheck`, `npm run check` (Lint und Format), `npm run build`.

### Aufbau

| Pfad | Inhalt |
| --- | --- |
| `packages/protocol` | gemeinsame Nachrichtentypen und Schemas für Client und Server |
| `apps/server` | autoritativer App-Server: HTTP, WebSocket, SQLite |
| `apps/client` | Browser-Client (TypeScript, Vite; PixiJS folgt) |

## Bekannte Einschränkungen

Kartenbilder und Wanddaten liegen vollständig im Client, auch unter dem Fog. Wer die Entwicklertools des Browsers nutzt, kann sie sehen. Das ist bewusst so entschieden.

## Lizenz

[AGPL-3.0](LICENSE). Wer Mistwarden verändert und als Dienst anbietet, muss den geänderten Quellcode offenlegen.
