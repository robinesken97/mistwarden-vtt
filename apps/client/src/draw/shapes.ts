// Geometrie für Zeichnungen: Freihandlinien vereinfachen, Formen in Linienzüge umrechnen
// und Treffer für den Radierer prüfen. Alles in Weltkoordinaten (Kartenpixel).
import { type DrawingData, MAX_DRAWING_COORDS } from "@mistwarden/protocol";

export interface Pt {
	x: number;
	y: number;
}

/** Punkte einer Ellipse als Linienzug; genug für Darstellung und Treffer. */
const ELLIPSE_SEGMENTS = 48;

/**
 * Vereinfacht einen Linienzug (Ramer-Douglas-Peucker, iterativ) und rundet auf ganze Pixel.
 * Reicht die Toleranz nicht für die Punktgrenze, wird sie verdoppelt.
 */
export function simplifyStroke(points: Pt[], tolerance: number): number[] {
	let tol = Math.max(0.5, tolerance);
	const input = thin(points, MAX_DRAWING_COORDS);
	for (;;) {
		const kept = rdp(input, tol);
		const flat = kept.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
		if (flat.length <= MAX_DRAWING_COORDS) return ensureTwoPoints(flat);
		tol *= 2;
	}
}

/** Sehr lange Striche gleichmäßig ausdünnen, damit die Vereinfachung schnell bleibt. */
function thin(points: Pt[], max: number): Pt[] {
	if (points.length <= max) return points;
	const step = (points.length - 1) / (max - 1);
	return Array.from(
		{ length: max },
		(_, i) => points[Math.round(i * step)] as Pt,
	);
}

/** Ein Tipp ergibt einen Punkt; die Zeichnung braucht zwei (gleiche sind erlaubt). */
function ensureTwoPoints(flat: number[]): number[] {
	if (flat.length >= 4) return flat;
	const [x = 0, y = 0] = flat;
	return [x, y, x, y];
}

function rdp(points: Pt[], tol: number): Pt[] {
	if (points.length <= 2) return points.slice();
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [start, end] = stack.pop() as [number, number];
		const a = points[start] as Pt;
		const b = points[end] as Pt;
		let maxDist = -1;
		let index = -1;
		for (let i = start + 1; i < end; i++) {
			const d = distToSegment(points[i] as Pt, a, b);
			if (d > maxDist) {
				maxDist = d;
				index = i;
			}
		}
		if (index >= 0 && maxDist > tol) {
			keep[index] = 1;
			stack.push([start, index], [index, end]);
		}
	}
	return points.filter((_, i) => keep[i] === 1);
}

/** Abstand eines Punkts zur Strecke a–b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t =
		len2 === 0
			? 0
			: Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Umriss einer Zeichnung als Linienzug [x0, y0, …]; `closed` bei Rechteck und Ellipse. */
export function drawingOutline(d: Pick<DrawingData, "shape" | "points">): {
	points: number[];
	closed: boolean;
} {
	const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = d.points;
	switch (d.shape) {
		case "free":
		case "line":
			return { points: d.points, closed: false };
		case "rect":
			return { points: [x0, y0, x1, y0, x1, y1, x0, y1], closed: true };
		case "ellipse": {
			const cx = (x0 + x1) / 2;
			const cy = (y0 + y1) / 2;
			const rx = Math.abs(x1 - x0) / 2;
			const ry = Math.abs(y1 - y0) / 2;
			const points: number[] = [];
			for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
				const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
				points.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
			}
			return { points, closed: true };
		}
	}
}

/** Trifft `p` die Linie der Zeichnung (halbe Strichbreite plus Toleranz)? */
export function hitDrawing(
	d: Pick<DrawingData, "shape" | "points" | "width">,
	p: Pt,
	tolerance: number,
): boolean {
	const { points, closed } = drawingOutline(d);
	const reach = d.width / 2 + tolerance;
	const n = points.length / 2;
	const at = (i: number): Pt => ({
		x: points[(i % n) * 2] as number,
		y: points[(i % n) * 2 + 1] as number,
	});
	if (n === 1) return Math.hypot(p.x - at(0).x, p.y - at(0).y) <= reach;
	const segments = closed ? n : n - 1;
	for (let i = 0; i < segments; i++) {
		if (distToSegment(p, at(i), at(i + 1)) <= reach) return true;
	}
	return false;
}
