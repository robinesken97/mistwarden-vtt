import { describe, expect, it } from "vitest";
import { rectCorners } from "../src/fog/rect.ts";
import { activeTool } from "../src/views/toolgroups.ts";

describe("Werkzeuggruppen", () => {
	const idle = {
		panel: null,
		table: null,
		shape: "free",
		fog: "select",
	} as const;

	it("zeigt ohne Werkzeug Ansicht/Wählen", () => {
		expect(activeTool(idle)).toEqual({ group: "view", subtool: "select" });
	});

	it("ordnet Messen, Zeichnen, Radierer und Fog ihrer Gruppe zu", () => {
		expect(activeTool({ ...idle, table: "measure" })).toEqual({
			group: "view",
			subtool: "measure",
		});
		expect(activeTool({ ...idle, table: "draw", shape: "rect" })).toEqual({
			group: "draw",
			subtool: "rect",
		});
		expect(activeTool({ ...idle, table: "erase" })).toEqual({
			group: "draw",
			subtool: "erase",
		});
		expect(activeTool({ ...idle, fog: "brush" })).toEqual({
			group: "fog",
			subtool: "brush",
		});
	});

	it("lässt ein offenes Gruppen-Panel vorgehen", () => {
		expect(activeTool({ ...idle, panel: "scene", table: "draw" })).toEqual({
			group: "scene",
			subtool: null,
		});
	});
});

describe("Fog-Rechteck", () => {
	it("liefert vier Ecken, egal in welche Richtung gezogen wird", () => {
		expect(rectCorners({ x: 30, y: 40 }, { x: 10, y: 5 }, null)).toEqual([
			{ x: 10, y: 5 },
			{ x: 30, y: 5 },
			{ x: 30, y: 40 },
			{ x: 10, y: 40 },
		]);
	});

	it("rastet an den Gitterlinien ein, auch mit Versatz", () => {
		const grid = { size: 100, offsetX: 20, offsetY: 0 };
		expect(rectCorners({ x: 105, y: 48 }, { x: 290, y: 260 }, grid)).toEqual([
			{ x: 120, y: 0 },
			{ x: 320, y: 0 },
			{ x: 320, y: 300 },
			{ x: 120, y: 300 },
		]);
	});

	it("verwirft Rechtecke ohne Fläche", () => {
		expect(rectCorners({ x: 5, y: 5 }, { x: 5.4, y: 80 }, null)).toEqual([]);
		const grid = { size: 100, offsetX: 0, offsetY: 0 };
		expect(rectCorners({ x: 110, y: 110 }, { x: 140, y: 290 }, grid)).toEqual(
			[],
		);
	});
});
