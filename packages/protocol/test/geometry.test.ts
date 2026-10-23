import { describe, expect, it } from "vitest";
import type { GridData } from "../src/entities.ts";
import { snapToGrid } from "../src/geometry.ts";

const grid = (
	type: GridData["type"],
	size = 100,
	offsetX = 0,
	offsetY = 0,
): GridData => ({
	type,
	size,
	offsetX,
	offsetY,
	visible: true,
});

describe("Einrasten am Quadrat-Grid", () => {
	it("ungerade Größen rasten in die Feldmitte", () => {
		expect(snapToGrid(grid("square"), { x: 130, y: 260 }, 1)).toEqual({
			x: 150,
			y: 250,
		});
		expect(snapToGrid(grid("square"), { x: 199, y: 1 }, 3)).toEqual({
			x: 150,
			y: 50,
		});
		expect(snapToGrid(grid("square"), { x: 30, y: 30 }, 0.5)).toEqual({
			x: 50,
			y: 50,
		});
	});

	it("gerade Größen rasten auf den Kreuzungspunkt", () => {
		expect(snapToGrid(grid("square"), { x: 130, y: 260 }, 2)).toEqual({
			x: 100,
			y: 300,
		});
		expect(snapToGrid(grid("square"), { x: 449, y: 451 }, 4)).toEqual({
			x: 400,
			y: 500,
		});
	});

	it("berücksichtigt Versatz und negative Koordinaten", () => {
		expect(
			snapToGrid(grid("square", 70, 10, -20), { x: 15, y: -5 }, 1),
		).toEqual({
			x: 45,
			y: 15,
		});
		expect(snapToGrid(grid("square"), { x: -30, y: -130 }, 1)).toEqual({
			x: -50,
			y: -150,
		});
	});
});

describe("Einrasten am Hex-Grid", () => {
	const s3 = Math.sqrt(3);
	const close = (p: { x: number; y: number }, x: number, y: number) => {
		expect(p.x).toBeCloseTo(x);
		expect(p.y).toBeCloseTo(y);
	};

	it("Spitze oben: Mitten im Raster des Shaders", () => {
		const g = grid("hexPointy", 100);
		close(snapToGrid(g, { x: 10, y: 10 }, 1), 0, 0);
		close(snapToGrid(g, { x: 95, y: -5 }, 1), 100, 0);
		// versetzte Reihe: (0,5 | √3/2) in Zellbreiten
		close(snapToGrid(g, { x: 55, y: 80 }, 1), 50, (s3 / 2) * 100);
		close(snapToGrid(g, { x: 0, y: 170 }, 2), 0, s3 * 100);
	});

	it("flach oben: dieselben Mitten mit vertauschten Achsen", () => {
		const g = grid("hexFlat", 100);
		close(snapToGrid(g, { x: 80, y: 55 }, 1), (s3 / 2) * 100, 50);
		close(snapToGrid(g, { x: -5, y: 95 }, 1), 0, 100);
	});

	it("jeder Punkt rastet auf eine Mitte innerhalb des Zell-Umkreises", () => {
		for (const type of ["hexPointy", "hexFlat"] as const) {
			const g = grid(type, 80, 13, -7);
			for (let i = 0; i < 500; i++) {
				const p = { x: ((i * 37.3) % 900) - 300, y: ((i * 61.7) % 700) - 200 };
				const s = snapToGrid(g, p, 1);
				// Umkreisradius einer Hexzelle der Breite size: size/√3.
				expect(Math.hypot(s.x - p.x, s.y - p.y)).toBeLessThanOrEqual(
					80 / s3 + 1e-9,
				);
			}
		}
	});
});
