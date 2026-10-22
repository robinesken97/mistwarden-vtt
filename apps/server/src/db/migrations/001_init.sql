-- Grundschema: Räume, Spieler, Sitzungen, synchronisierte Objekte und Änderungslog.

CREATE TABLE rooms (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	-- Wird in Schritt 2 (GM-Login, Spieler-Link) befüllt.
	gm_password_hash TEXT,
	player_link_token_hash TEXT UNIQUE,
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
CREATE TABLE sessions (
	token_hash TEXT PRIMARY KEY,
	room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('gm', 'player')),
	player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER,
	CHECK ((role = 'gm') = (player_id IS NULL))
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
