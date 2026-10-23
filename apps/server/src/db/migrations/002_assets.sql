-- Hochgeladene Bilder. Dateien liegen unter ASSET_STORAGE_PATH/<id>/ (Original + Kachelpyramide).
-- Raumübergreifend, damit Stufe 2 daraus eine Asset-Bibliothek machen kann.
CREATE TABLE assets (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	width INTEGER NOT NULL,
	height INTEGER NOT NULL,
	tile_size INTEGER NOT NULL,
	levels INTEGER NOT NULL,
	-- Dateiendung des unverändert aufbewahrten Originals (wird nie ausgeliefert).
	original_ext TEXT NOT NULL,
	created_at INTEGER NOT NULL
) STRICT;
