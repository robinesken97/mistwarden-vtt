// Reine Logik für Stufenwahl, sichtbare Kacheln und Speicherbudget – ohne PixiJS,
// damit sie ohne Gerät automatisch testbar ist.
import {
	type AssetMeta,
	levelSize,
	tileGrid,
	tileUrl,
} from "@mistwarden/protocol";

/** Sichtbarer Ausschnitt in Weltkoordinaten (= Kartenpixel auf Stufe 0). */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TileRef {
	key: string;
	url: string;
	level: number;
	x: number;
	y: number;
	/** Lage und Größe in Weltkoordinaten. */
	world: Rect;
	/** Grafikspeicher als RGBA-Textur. */
	bytes: number;
}

/** Bytes pro Pixel einer unkomprimierten RGBA-Textur. */
const BYTES_PER_PIXEL = 4;

/**
 * Stufe, bei der ein Kartenpixel etwa einem Bildschirmpixel entspricht.
 * `screenPxPerWorld` = Kamerazoom × Renderauflösung.
 */
export function idealLevel(meta: AssetMeta, screenPxPerWorld: number): number {
	if (!(screenPxPerWorld > 0)) return meta.levels - 1;
	const level = Math.floor(Math.log2(1 / screenPxPerWorld));
	return Math.min(meta.levels - 1, Math.max(0, level));
}

/** Kacheln einer Stufe, die den Ausschnitt schneiden. */
export function tilesInView(
	meta: AssetMeta,
	level: number,
	view: Rect,
): TileRef[] {
	const { cols, rows } = tileGrid(meta, level);
	const size = levelSize(meta, level);
	// Tatsächlicher Maßstab der Stufe je Achse (nicht genau 2^level, weil beim
	// Halbieren aufgerundet wird) – so deckt jede Stufe die Karte exakt ab.
	const sx = meta.width / size.width;
	const sy = meta.height / size.height;
	const spanX = meta.tileSize * sx;
	const spanY = meta.tileSize * sy;
	const x0 = Math.max(0, Math.floor(view.x / spanX));
	const y0 = Math.max(0, Math.floor(view.y / spanY));
	const x1 = Math.min(cols - 1, Math.floor((view.x + view.width) / spanX));
	const y1 = Math.min(rows - 1, Math.floor((view.y + view.height) / spanY));
	const tiles: TileRef[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const w = Math.min(meta.tileSize, size.width - x * meta.tileSize);
			const h = Math.min(meta.tileSize, size.height - y * meta.tileSize);
			tiles.push({
				key: `${meta.id}/${level}/${x}_${y}`,
				url: tileUrl(meta.id, level, x, y),
				level,
				x,
				y,
				world: {
					x: x * spanX,
					y: y * spanY,
					width: w * sx,
					height: h * sy,
				},
				bytes: w * h * BYTES_PER_PIXEL,
			});
		}
	}
	return tiles;
}

/** Die gröbste Stufe: genau eine Kachel, dient als Hintergrund, solange feinere laden. */
export function overviewTile(meta: AssetMeta): TileRef {
	const level = meta.levels - 1;
	const tiles = tilesInView(meta, level, {
		x: 0,
		y: 0,
		width: meta.width,
		height: meta.height,
	});
	return tiles[0] as TileRef;
}

/**
 * Wählt Stufe und Kacheln für den Ausschnitt so, dass Übersichtskachel plus
 * sichtbare Kacheln ins Budget passen. Reicht das Budget nicht, wird gröber geladen.
 */
export function planTiles(
	meta: AssetMeta,
	screenPxPerWorld: number,
	view: Rect,
	budgetBytes: number,
): { level: number; tiles: TileRef[] } {
	const overview = overviewTile(meta);
	let level = idealLevel(meta, screenPxPerWorld);
	for (;;) {
		const tiles = tilesInView(meta, level, view);
		const bytes = tiles.reduce((sum, t) => sum + t.bytes, 0);
		const needsOverview = level !== overview.level;
		const total = bytes + (needsOverview ? overview.bytes : 0);
		if (total <= budgetBytes || level >= meta.levels - 1) {
			return { level, tiles };
		}
		level++;
	}
}

/** Grafikspeicher-Budget für Kartenkacheln: niedrig auf Touch-Geräten (iPad), höher am Laptop. */
export function defaultBudgetBytes(coarsePointer: boolean): number {
	return (coarsePointer ? 96 : 256) * 1024 * 1024;
}
