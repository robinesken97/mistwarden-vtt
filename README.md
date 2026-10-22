# Mistwarden

Ein selbst gehostetes, schlankes Virtual Tabletop für die eigene Runde: Karten, Tokens, Fog und Würfel im Browser, ohne Upload-Limits und ohne Abo. Die Daten bleiben auf dem eigenen Server.

> **Status:** frühe Entwicklung (Stufe 1, Schritt 1: Projektgerüst, Datenbank und Synchronisation). Noch nicht spielbar.

Ziele, Umfang und Architektur stehen in [SPEC.md](SPEC.md).

## Entwicklung

Voraussetzung: Node.js 24 LTS.

```bash
npm ci
cp .env.example .env
npm run dev:seed      # legt einen Testraum an und gibt Sitzungs-Tokens aus
npm run dev:server    # App-Server auf 127.0.0.1:3000
npm run dev:client    # Vite-Entwicklungsserver mit Proxy für /ws
```

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
