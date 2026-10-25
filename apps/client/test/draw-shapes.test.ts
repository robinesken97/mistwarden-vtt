import { MAX_DRAWING_COORDS } from "@mistwarden/protocol";
import { describe, expect, it } from "vitest";
import {
	drawingOutline,
	hitDrawing,
	simplifyStroke,
} from "../src/draw/shapes.ts";

describe("Freihandlinien vereinfachen", () => {
	it("entfernt Punkte auf einer Geraden und rundet", () => {
		const line = Array.from({ length: 50 }, (_, i) => ({
			x: i * 2.2,
			y: 10.4,
		}));
		expect(simplifyStroke(line, 1)).toEqual([0, 10, 108, 10]);
	});

	it("behält Ecken", () => {
		const corner = [
			{ x: 0, y: 0 },
			{ x: 50, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 50 },
			{ x: 100, y: 100 },
		];
		expect(simplifyStroke(corner, 1)).toEqual([0, 0, 100, 0, 100, 100]);
	});

	it("macht aus einem Tipp zwei gleiche Punkte", () => {
		expect(simplifyStroke([{ x: 3.4, y: 7.6 }], 1)).toEqual([3, 8, 3, 8]);
	});

	it("bleibt unter der Punktgrenze", () => {
		const zigzag = Array.from({ length: 10_000 }, (_, i) => ({
			x: i,
			y: i % 2 === 0 ? 0 : 40,
		}));
		const flat = simplifyStroke(zigzag, 1);
		expect(flat.length).toBeLessThanOrEqual(MAX_DRAWING_COORDS);
		expect(flat.length % 2).toBe(0);
	});
});

describe("Treffer für den Radierer", () => {
	it("trifft Linien innerhalb halber Strichbreite plus Toleranz", () => {
		const d = { shape: "line" as const, points: [0, 0, 100, 0], width: 10 };
		expect(hitDrawing(d, { x: 50, y: 7 }, 3)).toBe(true);
		expect(hitDrawing(d, { x: 50, y: 9 }, 3)).toBe(false);
		expect(hitDrawing(d, { x: 105, y: 0 }, 3)).toBe(true);
	});

	it("Rechtecke treffen am Rand, nicht in der Mitte", () => {
		const d = { shape: "rect" as const, points: [0, 0, 100, 60], width: 4 };
		expect(hitDrawing(d, { x: 0, y: 30 }, 2)).toBe(true);
		expect(hitDrawing(d, { x: 50, y: 60 }, 2)).toBe(true);
		expect(hitDrawing(d, { x: 50, y: 30 }, 2)).toBe(false);
	});

	it("Ellipsen treffen auf dem Umfang", () => {
		const d = { shape: "ellipse" as const, points: [0, 0, 200, 100], width: 4 };
		expect(hitDrawing(d, { x: 200, y: 50 }, 2)).toBe(true);
		expect(hitDrawing(d, { x: 100, y: 0 }, 2)).toBe(true);
		expect(hitDrawing(d, { x: 100, y: 50 }, 2)).toBe(false);
	});

	it("ein Punkt ist ein Kreis", () => {
		const d = { shape: "free" as const, points: [10, 10, 10, 10], width: 6 };
		expect(hitDrawing(d, { x: 14, y: 10 }, 2)).toBe(true);
		expect(hitDrawing(d, { x: 16, y: 10 }, 2)).toBe(false);
	});

	it("Formen aus zwei Ecken unabhängig von der Zugrichtung", () => {
		const a = drawingOutline({ shape: "rect", points: [100, 60, 0, 0] });
		expect(a.closed).toBe(true);
		expect(a.points).toHaveLength(8);
	});
});
