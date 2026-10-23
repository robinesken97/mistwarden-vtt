import type { GridData } from "./entities.ts";

// Einrasten am Grid. Die Hex-Mittelpunkte müssen exakt zum Grid-Shader passen
// (apps/client/src/render/grid.ts): zwei Gitter {k·r} und {r/2 + k·r} mit r = (1, √3)
// in Zellbreiten, bei hexFlat mit vertauschten Achsen.

const SQRT3 = Math.sqrt(3);

export interface Point {
	x: number;
	y: number;
}

/**
 * Nächste Rastposition für ein Token der Größe `size` (in Feldern) mit Mittelpunkt `p`.
 * Quadrate: ungerade Größen in die Feldmitte, gerade auf den Kreuzungspunkt.
 * Hex: immer auf die nächste Feldmitte.
 */
export function snapToGrid(grid: GridData, p: Point, size: number): Point {
	const c = grid.size;
	const local = { x: (p.x - grid.offsetX) / c, y: (p.y - grid.offsetY) / c };
	let snapped: Point;
	if (grid.type === "square") {
		const even = Number.isInteger(size) && size % 2 === 0;
		const snap = (v: number) => (even ? Math.round(v) : Math.floor(v) + 0.5);
		snapped = { x: snap(local.x), y: snap(local.y) };
	} else if (grid.type === "hexPointy") {
		snapped = nearestHexCenter(local);
	} else {
		const swapped = nearestHexCenter({ x: local.y, y: local.x });
		snapped = { x: swapped.y, y: swapped.x };
	}
	return { x: grid.offsetX + snapped.x * c, y: grid.offsetY + snapped.y * c };
}

/** Nächste Hexmitte (Spitze oben, Zellbreite 1). */
function nearestHexCenter(p: Point): Point {
	const a = { x: Math.round(p.x), y: Math.round(p.y / SQRT3) * SQRT3 };
	const b = {
		x: Math.round(p.x - 0.5) + 0.5,
		y: Math.round((p.y - SQRT3 / 2) / SQRT3) * SQRT3 + SQRT3 / 2,
	};
	const da = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
	const db = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
	return da <= db ? a : b;
}

/** Kantenlänge eines Tokens in Kartenpixeln. */
export function tokenPixelSize(grid: GridData, size: number): number {
	return grid.size * size;
}
