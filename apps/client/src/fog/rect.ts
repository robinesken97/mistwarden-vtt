// Fog-Rechteck: aus zwei aufgezogenen Punkten werden vier Ecken (gespeichert als Polygon).
export interface RectPoint {
	x: number;
	y: number;
}

export interface RectGrid {
	size: number;
	offsetX: number;
	offsetY: number;
}

/**
 * Ecken des Rechtecks zwischen `a` und `b`, im Uhrzeigersinn ab oben links. Mit `grid`
 * rasten die Kanten an den Gitterlinien ein. Leer, wenn keine Fläche übrig bleibt.
 */
export function rectCorners(
	a: RectPoint,
	b: RectPoint,
	grid: RectGrid | null,
): RectPoint[] {
	const snap = (v: number, offset: number) =>
		grid ? offset + Math.round((v - offset) / grid.size) * grid.size : v;
	const x1 = snap(Math.min(a.x, b.x), grid?.offsetX ?? 0);
	const x2 = snap(Math.max(a.x, b.x), grid?.offsetX ?? 0);
	const y1 = snap(Math.min(a.y, b.y), grid?.offsetY ?? 0);
	const y2 = snap(Math.max(a.y, b.y), grid?.offsetY ?? 0);
	if (x2 - x1 < 1 || y2 - y1 < 1) return [];
	return [
		{ x: x1, y: y1 },
		{ x: x2, y: y1 },
		{ x: x2, y: y2 },
		{ x: x1, y: y2 },
	];
}
