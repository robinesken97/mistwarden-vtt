// Bilder (Karten, später Tokens) liegen als Kachelpyramide vor:
// Stufe 0 ist die volle Auflösung, jede weitere Stufe halbiert die Kantenlänge,
// bis das ganze Bild in eine Kachel passt. Jede Stufe besteht aus Kacheln von
// höchstens TILE_SIZE × TILE_SIZE Pixeln (Randkacheln sind kleiner).

export const TILE_SIZE = 1024;

/** Token-Bilder werden beim Upload auf diese Kantenlänge verkleinert (≤ 1 MiB Textur). */
export const TOKEN_MAX_EDGE = 512;

export type AssetPurpose = "map" | "token";

export interface AssetMeta {
	id: string;
	name: string;
	/** Größe des Bildes in voller Auflösung (Stufe 0). */
	width: number;
	height: number;
	tileSize: number;
	/** Anzahl der Stufen; die gröbste (levels - 1) besteht aus genau einer Kachel. */
	levels: number;
	purpose: AssetPurpose;
	createdAt: number;
}

/** Anzahl Stufen, bis das Bild in eine Kachel passt. */
export function levelCount(
	width: number,
	height: number,
	tileSize = TILE_SIZE,
): number {
	let levels = 1;
	let size = Math.max(width, height);
	while (size > tileSize) {
		size = Math.ceil(size / 2);
		levels++;
	}
	return levels;
}

/** Bildgröße auf einer Stufe. */
export function levelSize(
	meta: Pick<AssetMeta, "width" | "height">,
	level: number,
): { width: number; height: number } {
	let { width, height } = meta;
	for (let i = 0; i < level; i++) {
		width = Math.ceil(width / 2);
		height = Math.ceil(height / 2);
	}
	return { width, height };
}

/** Anzahl Kacheln je Richtung auf einer Stufe. */
export function tileGrid(
	meta: Pick<AssetMeta, "width" | "height" | "tileSize">,
	level: number,
): { cols: number; rows: number } {
	const { width, height } = levelSize(meta, level);
	return {
		cols: Math.ceil(width / meta.tileSize),
		rows: Math.ceil(height / meta.tileSize),
	};
}

/** Öffentliche Adresse einer Kachel; die zufällige Asset-ID ist der Schutz. */
export function tileUrl(
	id: string,
	level: number,
	x: number,
	y: number,
): string {
	return `/assets/${id}/${level}/${x}_${y}.webp`;
}

export function assetMetaUrl(id: string): string {
	return `/assets/${id}/meta.json`;
}

/** Erlaubte Bildformate beim Upload. */
export const UPLOAD_CONTENT_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
] as const;
