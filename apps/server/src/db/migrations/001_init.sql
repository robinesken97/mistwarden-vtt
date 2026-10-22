-- Grundschema: Einstellungen, Räume, Spieler, Sitzungen, synchronisierte Objekte und Änderungslog.

-- Installationsweite Werte, z. B. der Argon2-Hash des GM-Passworts.
CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) STRICT;

-- Die GM hat Zugang zu allen Räumen der Installation (ein GM-Passwort, siehe GM_PASSWORD).
CREATE TABLE rooms (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	-- Geheimer Teil des Spieler-Links; im Klartext, damit die GM den Link jederzeit wieder anzeigen kann.
	player_link_token TEXT NOT NULL UNIQUE,
	-- Fortlaufende Versionsnummer; jede Änderung im Raum erhöht sie um 1.
	version INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE players (
	id TEXT PRIMARY KEY,
	room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	display_name TEXT NOT NULL,
	color TEXT NOT NULL,
	created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX players_room ON players(room_id);

-- Sitzungs-Token liegen nur als SHA-256-Hash vor.
-- GM-Sitzungen gelten für die ganze Installation, Spieler-Sitzungen für genau einen Raum.
CREATE TABLE sessions (
	token_hash TEXT PRIMARY KEY,
	role TEXT NOT NULL CHECK (role IN ('gm', 'player')),
	room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
	player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER,
	CHECK (
		(role = 'gm' AND room_id IS NULL AND player_id IS NULL)
		OR (role = 'player' AND room_id IS NOT NULL AND player_id IS NOT NULL)
	)
) STRICT;

-- Aktueller Stand aller synchronisierten Objekte (Szenen, später Tokens, Fog-Formen, …).
CREATE TABLE entities (
	room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	data TEXT NOT NULL CHECK (json_valid(data)),
	audience TEXT NOT NULL CHECK (json_valid(audience)),
	version INTEGER NOT NULL,
	PRIMARY KEY (room_id, kind, id)
) STRICT;

-- Änderungslog: Grundlage für Live-Verteilung und das Nachholen nach Reconnect.
-- prev_audience/audience erlauben pro Empfänger zu entscheiden, ob er ein
-- Upsert, ein Löschen (Objekt wurde für ihn verborgen) oder nichts bekommt.
CREATE TABLE changes (
	room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	version INTEGER NOT NULL,
	action_id TEXT,
	op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
	kind TEXT NOT NULL,
	entity_id TEXT NOT NULL,
	data TEXT CHECK (data IS NULL OR json_valid(data)),
	audience TEXT CHECK (audience IS NULL OR json_valid(audience)),
	prev_audience TEXT CHECK (prev_audience IS NULL OR json_valid(prev_audience)),
	created_at INTEGER NOT NULL,
	PRIMARY KEY (room_id, version)
) STRICT;

CREATE INDEX changes_action ON changes(room_id, action_id);
