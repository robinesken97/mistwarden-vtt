-- Szenen bekommen Karte und Grid (Schritt 3). Bestehende Szenen und ihre Einträge im
-- Änderungslog erhalten die Standardwerte, damit Clients nie ein unvollständiges Objekt sehen.
-- Muss zu DEFAULT_GRID in packages/protocol/src/entities.ts passen.

UPDATE entities
SET data = json_set(
	data,
	'$.map', json('null'),
	'$.grid', json('{"type":"square","size":100,"offsetX":0,"offsetY":0,"visible":true}')
)
WHERE kind = 'scene' AND json_type(data, '$.grid') IS NULL;

UPDATE changes
SET data = json_set(
	data,
	'$.map', json('null'),
	'$.grid', json('{"type":"square","size":100,"offsetX":0,"offsetY":0,"visible":true}')
)
WHERE kind = 'scene' AND data IS NOT NULL AND json_type(data, '$.grid') IS NULL;
