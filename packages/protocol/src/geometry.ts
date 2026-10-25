import type { GridData, MeasureData } from "./entities.ts";

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

/**
 * Abstand zweier Punkte in Feldern, gemessen von Feldmitte zu Feldmitte.
 * Quadrate nach der Diagonalregel der Szene, Hex-Grids immer nach Hex-Distanz.
 */
export function measureCells(
	grid: GridData,
	diagonal: MeasureData["diagonal"],
	a: Point,
	b: Point,
): number {
	const c = grid.size;
	const local = (p: Point) => ({
		x: (p.x - grid.offsetX) / c,
		y: (p.y - grid.offsetY) / c,
	});
	const la = local(a);
	const lb = local(b);
	if (grid.type === "square") {
		const dx = Math.abs(Math.floor(lb.x) - Math.floor(la.x));
		const dy = Math.abs(Math.floor(lb.y) - Math.floor(la.y));
		const long = Math.max(dx, dy);
		const short = Math.min(dx, dy);
		switch (diagonal) {
			case "equal":
				return long;
			case "alternating":
				return long + Math.floor(short / 2);
			case "euclidean":
				return Math.hypot(dx, dy);
		}
	}
	const swap = grid.type === "hexFlat";
	const ha = hexAxial(swap ? { x: la.y, y: la.x } : la);
	const hb = hexAxial(swap ? { x: lb.y, y: lb.x } : lb);
	const dq = hb.q - ha.q;
	const dr = hb.r - ha.r;
	return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Axiale Koordinaten des Hexfelds (Spitze oben, Zellbreite 1) unter `p`. */
function hexAxial(p: Point): { q: number; r: number } {
	const center = nearestHexCenter(p);
	const r = Math.round(center.y / (SQRT3 / 2));
	return { q: Math.round(center.x - r / 2), r };
}

/** Messung in Feldern und in der Einheit der Szene. */
export function measureDistance(
	grid: GridData,
	measure: MeasureData,
	a: Point,
	b: Point,
): { cells: number; distance: number } {
	const cells = measureCells(grid, measure.diagonal, a, b);
	return { cells, distance: cells * measure.perCell };
}
