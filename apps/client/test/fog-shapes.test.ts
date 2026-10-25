import { FogSchema } from "@mistwarden/protocol";
import { describe, expect, it } from "vitest";
import {
	brushToPolygons,
	pointInFog,
	polygonArea,
	polygonToPolygons,
} from "../src/fog/shapes.ts";

describe("Pinsel", () => {
	it("macht aus einer Linie eine Fläche mit runden Enden", () => {
		const polys = brushToPolygons(
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			],
			10,
		);
		expect(polys).toHaveLength(1);
		// Rechteck 100×20 plus zwei Halbkreise r=10 ≈ 2000 + 314
		expect(polygonArea(polys)).toBeGreaterThan(2250);
		expect(polygonArea(polys)).toBeLessThan(2330);
		expect(pointInFog(polys, { x: 50, y: 0 })).toBe(true);
		expect(pointInFog(polys, { x: 105, y: 0 })).toBe(true); // runde Kappe
		expect(pointInFog(polys, { x: 50, y: 15 })).toBe(false);
	});

	it("ein einzelner Tipper ergibt einen Kreis", () => {
		const polys = brushToPolygons([{ x: 10, y: 10 }], 20);
		expect(polygonArea(polys)).toBeGreaterThan(1200); // π·20² ≈ 1257
		expect(pointInFog(polys, { x: 10, y: 10 })).toBe(true);
	});

	it("ein geschlossener Ring aus Strichen hat ein Loch", () => {
		const ring = [
			{ x: 0, y: 0 },
			{ x: 200, y: 0 },
			{ x: 200, y: 200 },
			{ x: 0, y: 200 },
			{ x: 0, y: 0 },
		];
		const polys = brushToPolygons(ring, 10);
		expect(polys).toHaveLength(1);
		expect(polys[0]?.holes).toHaveLength(1);
		expect(pointInFog(polys, { x: 100, y: 100 })).toBe(false); // im Loch
		expect(pointInFog(polys, { x: 100, y: 0 })).toBe(true); // auf dem Strich
	});

	it("das Ergebnis passt zum Protokoll-Schema", () => {
		const polys = brushToPolygons(
			Array.from({ length: 200 }, (_, i) => ({
				x: i * 3,
				y: Math.sin(i / 10) * 50,
			})),
			15,
		);
		const parsed = FogSchema.safeParse({
			sceneId: "s1",
			polygons: polys,
			active: true,
			source: "hand",
		});
		expect(parsed.success).toBe(true);
	});
});

describe("Polygon", () => {
	it("bereinigt Selbstüberschneidungen", () => {
		// Schleife (Achterform) → zwei Dreiecke
		const polys = polygonToPolygons([
			{ x: 0, y: 0 },
			{ x: 100, y: 100 },
			{ x: 100, y: 0 },
			{ x: 0, y: 100 },
		]);
		expect(polys).toHaveLength(2);
		expect(polygonArea(polys)).toBeCloseTo(5000, -1);
	});

	it("weniger als drei Punkte ergeben keine Fläche", () => {
		expect(
			polygonToPolygons([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		).toEqual([]);
	});
});
