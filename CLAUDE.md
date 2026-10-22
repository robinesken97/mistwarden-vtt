# CLAUDE.md

Mistwarden ist ein selbst gehostetes, schlankes Virtual Tabletop (AGPL-3.0). Die vollständige Spezifikation steht in [SPEC.md](SPEC.md) – bei Unklarheiten gilt sie.

## Regeln

- Kein Feature gilt als fertig, bevor es die Definition of Done erfüllt, inklusive Test auf dem iPad 6:
  1. Funktioniert auf dem iPad 6 (iPadOS 17, Safari 17) per Touch.
  2. Funktioniert auf dem Laptop mit Maus (Rechtsklick statt langem Drücken, Mausrad zum Zoomen).
  3. Synchronisiert korrekt zwischen GM und mindestens zwei Spielern.
  4. Übersteht ein Neuladen bzw. Reconnect ohne Datenverlust.
- Fog und Wände ausschließlich als Polygone bzw. Segmente speichern; keine Pixelmasken.
- Renderer ist PixiJS mit WebGL2; keine WebGPU-only-Features.
- Der Server ist autoritativ; Rechte werden serverseitig geprüft; verdeckte Objekte gehen nie an Spieler.
- Keine festen Annahmen über das lokale Netz (Basis-URL konfigurierbar, HTTPS-fähig).
- Abhängigkeiten sparsam; jede neue Abhängigkeit kurz begründen und ihre Lizenz auf AGPL-Kompatibilität prüfen.
- Stufen strikt nacheinander; nichts aus Stufe 3 vor einer echten Session mit Stufe 1.

## Reihenfolge innerhalb von Stufe 1

1. Projektgerüst, Datenbankschema, WebSocket-Server mit Versionsnummern und Reconnect.
2. Raum, GM-Login, Spieler-Link, Szenen.
3. Asset-Upload mit Größenstufen, Karte und Grid im PixiJS-Renderer.
4. Tokens mit Rechten, Ebenen, Touch- und Mausbedienung.
5. Statischer Fog als Polygone.
6. Würfel und Log, Ping, Messwerkzeug, Zeichnen.
7. Versteckte Tokens, GM-Notizen, Handouts.
8. Rückgängig/Wiederholen, PWA, Raum-Export.
9. Bereitstellung als LXC auf Proxmox mit HTTPS im LAN; Testsession am Tisch.

## Tests

- Automatisierte Tests für Rechteprüfung, Synchronisation und Polygon-Operationen.
- Manueller Gerätetest nach jedem Schritt: iPad 6, iPad Air 3, MacBook mit Safari.

### Ausnahme bis zur ersten Session (Entscheidung vom 22.10.2026)

Die iPads stehen erst zur ersten Spielsession zur Verfügung. Bis dahin gilt:

- Stufe 1 wird komplett gebaut; der Test auf echten iPads findet beim ersten Spielen statt. Owlbear Rodeo liegt als Backup für den Spieltag bereit.
- Features gelten bis dahin als „fertig bis auf Gerätetest“. Punkt 1 der Definition of Done wird nachgeholt, nicht gestrichen.
- Ersatzweise nach jedem Schritt prüfen: iPad-Simulator mit iPadOS 17 (Xcode; erreicht `localhost` direkt) für Rendering, Touch und Hintergrund/Reconnect, dazu Safari auf dem Mac.
- Der Simulator bildet den Speicher des iPad 6 nicht ab. Deshalb Speicher konservativ planen: festes Texturbudget, Kartenstufen nach abgefragter maximaler Texturgröße, nie die volle Auflösung als eine Textur.
- HTTPS im LAN (Schritt 9) muss vor dem Spieltag stehen, sonst laufen PWA und Service Worker auf den iPads nicht.

## Veröffentlichung, Lizenz und Repository

- Öffentliches Repository `mistwarden-vtt` auf GitHub. Lizenz: AGPL-3.0, LICENSE-Datei ab dem ersten Commit. Alle Abhängigkeiten müssen AGPL-kompatibel sein (MIT, BSD, Apache-2.0, Boost u. ä.); neue Abhängigkeiten vor Aufnahme auf ihre Lizenz prüfen.
- Keine lizenzierten Inhalte im Repository: keine Patreon-Karten, auch nicht in Screenshots oder Demos. Für Demos nur frei lizenzierte (z. B. CC-BY) oder selbst erstellte Karten und Tokens, mit Quellenangabe.
- Keine geschützten Begriffe von Wizards of the Coast oder Owlbear Rodeo in Name oder Oberfläche. In der Dokumentation nur als sachlicher Verweis (Vergleich, Quellenangabe, Lizenzhinweis). Regelbegriffe nur aus dem SRD.
- Fremder Code (z. B. Wetter-Shader von Owlbear) nur, wenn seine Lizenz mit AGPL-3.0 vereinbar ist; sonst eigene Implementierung. Übernommene Dateien behalten Copyright-Vermerk und Lizenzhinweis, Änderungen werden markiert.

## Sicherheit für fremde Installationen

- GM-Passwörter gehasht (Argon2 oder bcrypt), Ratenbegrenzung beim Login.
- Spieler-Links mit ausreichend langem Zufallstoken, vom GM neu erzeugbar.
- Uploads: Dateityp und Größe serverseitig prüfen, Bilder neu kodieren statt Originale auszuliefern; Upload-Limit pro Installation konfigurierbar.
- Betrieb hinter HTTPS dokumentieren; keine Standardpasswörter.

## Repository-Regeln

- Uploads, Karten, eigene Testkarten für Auto-Fog und die SQLite-Datei stehen in der `.gitignore`.
- Secrets (GM-Passwort, Tunnel-Token) nur über Umgebungsvariablen; eine `.env.example` ohne echte Werte ist eingecheckt.
- README mit Installationsanleitung für LXC/Debian und optional Docker für andere Nutzer; die eigene Installation bleibt plain LXC.
- GitHub Actions für Tests und Build bei jedem Push; Deployment auf den eigenen LXC per Skript, nicht automatisch.
