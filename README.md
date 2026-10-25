# Mistwarden

Ein selbst gehostetes, schlankes Virtual Tabletop für die eigene Runde: Karten, Tokens, Fog und Würfel im Browser, ohne Upload-Limits und ohne Abo. Die Daten bleiben auf dem eigenen Server.

> **Status:** frühe Entwicklung (Stufe 1, Schritt 5: statischer Fog). Noch nicht spielbar – Würfel, Ping, Messen und Zeichnen folgen.

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
