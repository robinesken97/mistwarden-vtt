-- Verwendungszweck eines Bildes: Karte (Kachelpyramide) oder Token (auf 512 px verkleinert).
ALTER TABLE assets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'map' CHECK (purpose IN ('map', 'token'));
