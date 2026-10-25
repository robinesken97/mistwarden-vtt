// Fog-Geometrie mit Clipper2: Pinselstrich → Fläche, Polygon bereinigen, Treffertest.
// Ergebnis sind immer Flächen mit Außenrand und Löchern in ganzen Kartenpixeln.
import type { FogPolygon } from "@mistwarden/protocol";
import {
	Clipper,
	ClipType,
	EndType,
	FillRule,
	JoinType,
	type Path64,
	type Paths64,
	type PolyPath64,
	PolyTree64,
} from "clipper2-ts";

export interface Point {
	x: number;
	y: number;
}

/**
 * Wandelt einen Pinselstrich (offene Linie) in Fog-Flächen um: runde Enden und Ecken,
 * Überlappungen vereinigt, Punkte vereinfacht (Toleranz in Kartenpixeln).
 */
export function brushToPolygons(
	stroke: Point[],
	radius: number,
	tolerance = 1,
): FogPolygon[] {
	if (stroke.length === 0 || radius <= 0) return [];
	const path = toPath(stroke);
	// Ein einzelner Tipper wird zu einem Kreis.
	if (path.length === 1)
		path.push({ x: (path[0]?.x ?? 0) + 1, y: path[0]?.y ?? 0 });
	const inflated = Clipper.inflatePaths(
		[path],
		radius,
		JoinType.Round,
		EndType.Round,
	);
	return normalize(inflated, tolerance);
}

/** Bereinigt ein gezeichnetes Polygon (Selbstüberschneidungen, doppelte Punkte). */
export function polygonToPolygons(
	points: Point[],
	tolerance = 1,
): FogPolygon[] {
	if (points.length < 3) return [];
	return normalize([toPath(points)], tolerance);
}

/** Liegt der Punkt in der Fläche (innerhalb des Außenrands, nicht in einem Loch)? */
export function pointInFog(polygons: FogPolygon[], p: Point): boolean {
	return polygons.some(
		(poly) =>
			insideRing(poly.outer, p) &&
			!poly.holes.some((hole) => insideRing(hole, p)),
	);
}

/** Vereinigt Pfade und zerlegt das Ergebnis in Flächen mit Löchern. */
function normalize(paths: Paths64, tolerance: number): FogPolygon[] {
	const simplified =
		tolerance > 0 ? Clipper.simplifyPaths(paths, tolerance) : paths;
	const tree = new PolyTree64();
	Clipper.booleanOpWithPolyTree(
		ClipType.Union,
		simplified,
		null,
		tree,
		FillRule.NonZero,
	);
	const result: FogPolygon[] = [];
	const visit = (node: PolyPath64) => {
		for (let i = 0; i < node.count; i++) {
			const outer = node.child(i);
			if (!outer.polygon || outer.polygon.length < 3) continue;
			const holes: number[][] = [];
			for (let j = 0; j < outer.count; j++) {
				const hole = outer.child(j);
				if (hole.polygon && hole.polygon.length >= 3)
					holes.push(flat(hole.polygon));
				// Inseln in Löchern sind wieder eigene Flächen.
				visit(hole);
			}
			result.push({ outer: flat(outer.polygon), holes });
		}
	};
	visit(tree);
	return result;
}

function toPath(points: Point[]): Path64 {
	const path: Path64 = [];
	for (const p of points) {
		const x = Math.round(p.x);
		const y = Math.round(p.y);
		const last = path[path.length - 1];
		if (!last || last.x !== x || last.y !== y) path.push({ x, y });
	}
	return path;
}

function flat(path: Path64): number[] {
	return path.flatMap((p) => [p.x, p.y]);
}

/** Even-odd-Test gegen einen flachen Ring. */
function insideRing(ring: number[], p: Point): boolean {
	let inside = false;
	const n = ring.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = ring[2 * i] as number;
		const yi = ring[2 * i + 1] as number;
		const xj = ring[2 * j] as number;
		const yj = ring[2 * j + 1] as number;
		if (
			yi > p.y !== yj > p.y &&
			p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
		) {
			inside = !inside;
		}
	}
	return inside;
}

/** Fläche in Quadratpixeln (zum Aussortieren von Mini-Formen). */
export function polygonArea(polygons: FogPolygon[]): number {
	const ringArea = (ring: number[]) => {
		let a = 0;
		for (let i = 0, n = ring.length / 2; i < n; i++) {
			const j = (i + 1) % n;
			a += (ring[2 * i] as number) * (ring[2 * j + 1] as number);
			a -= (ring[2 * j] as number) * (ring[2 * i + 1] as number);
		}
		return Math.abs(a) / 2;
	};
	return polygons.reduce(
		(sum, p) =>
			sum + ringArea(p.outer) - p.holes.reduce((s, h) => s + ringArea(h), 0),
		0,
	);
}
