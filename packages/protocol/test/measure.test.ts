import { describe, expect, it } from "vitest";
import { DEFAULT_MEASURE, type GridData } from "../src/entities.ts";
import { measureCells, measureDistance, snapToGrid } from "../src/geometry.ts";

const square: GridData = {
	type: "square",
	size: 100,
	offsetX: 20,
	offsetY: 10,
	visible: true,
};
/** Mitte des Felds (col, row) im Quadrat-Grid oben. */
const cell = (col: number, row: number) => ({
	x: 20 + (col + 0.5) * 100,
	y: 10 + (row + 0.5) * 100,
});

describe("Messen auf Quadraten", () => {
	it("gerade Strecken zählen Felder, unabhängig von der Regel", () => {
		for (const d of ["equal", "alternating", "euclidean"] as const) {
			expect(measureCells(square, d, cell(0, 0), cell(4, 0))).toBe(4);
			expect(measureCells(square, d, cell(2, 5), cell(2, 2))).toBe(3);
		}
	});

	it("misst innerhalb eines Felds 0", () => {
		expect(
			measureCells(square, "equal", { x: 25, y: 15 }, { x: 115, y: 105 }),
		).toBe(0);
	});

	it("equal: jede Diagonale zählt ein Feld", () => {
		expect(measureCells(square, "equal", cell(0, 0), cell(3, 3))).toBe(3);
		expect(measureCells(square, "equal", cell(0, 0), cell(5, 2))).toBe(5);
	});

	it("alternating: jede zweite Diagonale zählt doppelt", () => {
		expect(measureCells(square, "alternating", cell(0, 0), cell(1, 1))).toBe(1);
		expect(measureCells(square, "alternating", cell(0, 0), cell(2, 2))).toBe(3);
		expect(measureCells(square, "alternating", cell(0, 0), cell(3, 3))).toBe(4);
		expect(measureCells(square, "alternating", cell(0, 0), cell(5, 2))).toBe(6);
	});

	it("euclidean: Luftlinie", () => {
		expect(measureCells(square, "euclidean", cell(0, 0), cell(3, 4))).toBe(5);
		expect(
			measureCells(square, "euclidean", cell(0, 0), cell(1, 1)),
		).toBeCloseTo(Math.SQRT2);
	});

	it("rechnet in die Einheit der Szene um", () => {
		expect(
			measureDistance(square, DEFAULT_MEASURE, cell(0, 0), cell(3, 1)),
		).toEqual({ cells: 3, distance: 15 });
		expect(
			measureDistance(
				square,
				{ perCell: 1.5, unit: "m", diagonal: "alternating" },
				cell(0, 0),
				cell(2, 2),
			),
		).toEqual({ cells: 3, distance: 4.5 });
	});
});

describe("Messen auf Hex-Grids", () => {
	for (const type of ["hexPointy", "hexFlat"] as const) {
		const grid: GridData = {
			type,
			size: 80,
			offsetX: 5,
			offsetY: -7,
			visible: true,
		};
		const center = (p: { x: number; y: number }) => snapToGrid(grid, p, 1);
		const step = 80;
		const along = (n: number) =>
			type === "hexPointy"
				? { x: 5 + n * step, y: -7 }
				: { x: 5, y: -7 + n * step };

		it(`${type}: Nachbarn in einer Reihe`, () => {
			expect(measureCells(grid, "equal", along(0), along(1))).toBe(1);
			expect(measureCells(grid, "alternating", along(0), along(4))).toBe(4);
		});

		it(`${type}: schräge Nachbarn sind ein Feld`, () => {
			const a = center(along(0));
			// Schräger Nachbar: halbe Zellbreite längs, √3/2 quer.
			const b =
				type === "hexPointy"
					? center({ x: a.x + step / 2, y: a.y + (step * Math.sqrt(3)) / 2 })
					: center({ x: a.x + (step * Math.sqrt(3)) / 2, y: a.y + step / 2 });
			expect(measureCells(grid, "euclidean", a, b)).toBe(1);
			// Zwei schräge Schritte in dieselbe Richtung: zwei Felder.
			const c =
				type === "hexPointy"
					? center({ x: a.x + step, y: a.y + step * Math.sqrt(3) })
					: center({ x: a.x + step * Math.sqrt(3), y: a.y + step });
			expect(measureCells(grid, "equal", a, c)).toBe(2);
		});

		it(`${type}: Zickzack ergibt die kürzeste Hex-Distanz`, () => {
			const a = center(along(0));
			const b =
				type === "hexPointy"
					? center({ x: a.x + step * 3.5, y: a.y + (step * Math.sqrt(3)) / 2 })
					: center({ x: a.x + (step * Math.sqrt(3)) / 2, y: a.y + step * 3.5 });
			expect(measureCells(grid, "equal", a, b)).toBe(4);
		});
	}
});
