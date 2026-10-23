import { type AssetMeta, levelCount } from "@mistwarden/protocol";
import { describe, expect, it } from "vitest";
import { Camera } from "../src/render/camera.ts";
import { TileCache } from "../src/render/tile-cache.ts";
import {
	defaultBudgetBytes,
	idealLevel,
	overviewTile,
	planTiles,
	type TileRef,
	tilesInView,
} from "../src/render/tiles.ts";

function meta(width: number, height: number): AssetMeta {
	return {
		id: "a",
		name: "Test",
		width,
		height,
		tileSize: 1024,
		levels: levelCount(width, height),
		purpose: "map",
		createdAt: 0,
	};
}

const MiB = 1024 * 1024;
/** iPad 6: 2160 × 1620 Gerätepixel, Auflösung 2. */
const IPAD = { width: 1080, height: 810, resolution: 2 };

describe("Stufenwahl", () => {
	const big = meta(12_000, 9_000); // große Karte, 5 Stufen

	it("wählt die Stufe, bei der ein Kartenpixel etwa ein Bildschirmpixel ist", () => {
		expect(big.levels).toBe(5);
		expect(idealLevel(big, 1)).toBe(0);
		expect(idealLevel(big, 2)).toBe(0);
		expect(idealLevel(big, 0.5)).toBe(1);
		expect(idealLevel(big, 0.3)).toBe(1);
		expect(idealLevel(big, 0.01)).toBe(4);
	});

	it("liefert nur die sichtbaren Kacheln", () => {
		const tiles = tilesInView(big, 0, {
			x: 1000,
			y: 1000,
			width: 500,
			height: 500,
		});
		expect(tiles.map((t) => [t.x, t.y])).toEqual([
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		]);
		const edge = tilesInView(big, 0, {
			x: 11_500,
			y: 8_500,
			width: 9_999,
			height: 9_999,
		});
		expect(edge).toHaveLength(1);
		expect(edge[0]?.world).toEqual({
			x: 11_264,
			y: 8_192,
			width: 736,
			height: 808,
		});
	});

	it("die Übersicht ist eine einzelne kleine Kachel", () => {
		const o = overviewTile(big);
		expect(o.level).toBe(4);
		expect(o.world).toEqual({ x: 0, y: 0, width: 12_000, height: 9_000 });
		expect(o.bytes).toBeLessThanOrEqual(1024 * 1024 * 4);
	});
});

describe("Speicherbudget", () => {
	it("hält das iPad-Budget bei jeder Zoomstufe ein", () => {
		const big = meta(20_000, 15_000);
		const budget = defaultBudgetBytes(true);
		expect(budget).toBe(96 * MiB);
		const camera = new Camera();
		for (const zoom of [0.03, 0.06, 0.1, 0.25, 0.5, 1, 2, 4]) {
			camera.zoom = zoom;
			camera.x = 5_000;
			camera.y = 4_000;
			const view = camera.view(IPAD.width, IPAD.height);
			const plan = planTiles(big, zoom * IPAD.resolution, view, budget);
			const overview = overviewTile(big);
			const bytes =
				plan.tiles.reduce((s, t) => s + t.bytes, 0) +
				(plan.level === overview.level ? 0 : overview.bytes);
			expect(bytes).toBeLessThanOrEqual(budget);
		}
	});

	it("wird gröber, wenn die ideale Stufe nicht ins Budget passt", () => {
		const big = meta(20_000, 15_000);
		const view = { x: 0, y: 0, width: 20_000, height: 15_000 };
		// Ideal wäre Stufe 0 (alles in voller Auflösung, über 1 GiB).
		const plan = planTiles(big, 1, view, 96 * MiB);
		expect(plan.level).toBeGreaterThan(0);
	});

	it("die volle Auflösung wird nie als eine Textur geladen", () => {
		const big = meta(20_000, 15_000);
		const tiles = tilesInView(big, 0, {
			x: 0,
			y: 0,
			width: 20_000,
			height: 15_000,
		});
		expect(Math.max(...tiles.map((t) => t.bytes))).toBe(1024 * 1024 * 4);
	});
});

describe("Kachel-Cache", () => {
	function fakeTile(key: string, bytes: number): TileRef {
		return {
			key,
			url: key,
			level: 0,
			x: 0,
			y: 0,
			world: { x: 0, y: 0, width: 1, height: 1 },
			bytes,
		};
	}

	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("lädt höchstens zwei gleichzeitig und gibt Unbenutztes über dem Budget frei", async () => {
		let active = 0;
		let maxActive = 0;
		const released: string[] = [];
		const cache = new TileCache<string>({
			budgetBytes: 30,
			load: async (tile) => {
				active++;
				maxActive = Math.max(maxActive, active);
				await flush();
				active--;
				return {
					value: tile.key,
					bytes: tile.bytes,
					release: () => released.push(tile.key),
				};
			},
			onChange: () => {},
		});

		cache.want(["a", "b", "c"].map((k) => fakeTile(k, 10)));
		for (let i = 0; i < 10; i++) await flush();
		expect(maxActive).toBe(2);
		expect(cache.usedBytes).toBe(30);

		// Neue Kacheln: alte, nicht mehr benötigte fliegen raus.
		cache.want(["d", "e"].map((k) => fakeTile(k, 10)));
		for (let i = 0; i < 10; i++) await flush();
		expect(cache.usedBytes).toBeLessThanOrEqual(30);
		expect(released).toHaveLength(2);
		expect(cache.get("d")).toBe("d");
		expect(cache.get("e")).toBe("e");

		cache.destroy();
		expect(released.sort()).toEqual(["a", "b", "c", "d", "e"]);
	});
});

describe("Kamera", () => {
	it("zoomt um den Zeiger, der Punkt darunter bleibt stehen", () => {
		const c = new Camera();
		c.x = 100;
		c.y = 50;
		const before = c.screenToWorld(300, 200);
		c.zoomAt(300, 200, 2.5);
		const after = c.screenToWorld(300, 200);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it("richtet sich zentriert auf eine Karte aus", () => {
		const c = new Camera();
		c.fit({ x: 0, y: 0, width: 4000, height: 2000 }, 1000, 1000, 0);
		expect(c.zoom).toBe(0.25);
		expect(c.x).toBe(0);
		expect(c.y).toBe(-1000);
	});
});
