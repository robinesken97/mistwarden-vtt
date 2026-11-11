import { describe, expect, it } from "vitest";
import { placeMenu } from "../src/views/menu.ts";

describe("Menü am Objekt", () => {
	const bounds = { left: 8, top: 60, right: 1016, bottom: 600 };
	const size = { width: 232, height: 300 };

	it("steht rechts neben dem Objekt, oben bündig", () => {
		const anchor = { left: 400, top: 200, right: 440, bottom: 240 };
		expect(placeMenu(anchor, size, bounds)).toEqual({ left: 452, top: 200 });
	});

	it("weicht nach links aus, wenn rechts kein Platz ist", () => {
		const anchor = { left: 900, top: 200, right: 940, bottom: 240 };
		expect(placeMenu(anchor, size, bounds)).toEqual({ left: 656, top: 200 });
	});

	it("bleibt in der freien Fläche", () => {
		const low = { left: 400, top: 580, right: 440, bottom: 620 };
		expect(placeMenu(low, size, bounds).top).toBe(300);
		const wide = { left: 0, top: 0, right: 1024, bottom: 700 };
		expect(placeMenu(wide, size, bounds)).toEqual({ left: 784, top: 60 });
	});
});
