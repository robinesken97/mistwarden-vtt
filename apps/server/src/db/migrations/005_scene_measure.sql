-- Szenen bekommen Messeinstellungen (Schritt 6). Bestehende Szenen und ihre Einträge im
-- Änderungslog erhalten die Standardwerte, damit Clients nie ein unvollständiges Objekt sehen.
-- Muss zu DEFAULT_MEASURE in packages/protocol/src/entities.ts passen.

UPDATE entities
SET data = json_set(
	data,
	'$.measure', json('{"perCell":5,"unit":"ft","diagonal":"equal"}')
)
WHERE kind = 'scene' AND json_type(data, '$.measure') IS NULL;

UPDATE changes
SET data = json_set(
	data,
	'$.measure', json('{"perCell":5,"unit":"ft","diagonal":"equal"}')
)
WHERE kind = 'scene' AND data IS NOT NULL AND json_type(data, '$.measure') IS NULL;
