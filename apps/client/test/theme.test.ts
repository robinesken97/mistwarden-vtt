import { describe, expect, it } from "vitest";
import { storage } from "../src/storage.ts";
import {
	applyAccent,
	applyTheme,
	onAccent,
	parseAccent,
	parseTheme,
} from "../src/theme.ts";

describe("Theme", () => {
	it("setzt und entfernt data-theme", () => {
		const root = { dataset: {} as DOMStringMap };
		applyTheme("oled", root);
		expect(root.dataset.theme).toBe("oled");
		applyTheme("system", root);
		expect("theme" in root.dataset).toBe(false);
	});

	it("behandelt unbekannte Werte als system", () => {
		expect(parseTheme("neon")).toBe("system");
		expect(parseTheme(null)).toBe("system");
		expect(parseTheme("light")).toBe("light");
	});

	it("übersteht Speichern und Lesen, auch ohne localStorage", () => {
		expect(storage.theme()).toBe("system");
		storage.setTheme("dark");
		expect(storage.theme()).toBe("dark");
		const root = { dataset: {} as DOMStringMap };
		applyTheme(storage.theme(), root);
		expect(root.dataset.theme).toBe("dark");
		storage.setTheme("system");
		expect(storage.theme()).toBe("system");
	});

	it("wählt lesbare Schrift auf dem Akzent", () => {
		expect(onAccent("#ffffff")).toBe("#000");
		expect(onAccent("#000000")).toBe("#fff");
		expect(onAccent("#a99be0")).toBe("#000");
		expect(onAccent("#5b4b8a")).toBe("#fff");
	});

	it("nimmt nur #rrggbb als Akzent an", () => {
		expect(parseAccent("#A99BE0")).toBe("#a99be0");
		expect(parseAccent("red")).toBeNull();
		expect(parseAccent("#fff")).toBeNull();
		expect(parseAccent(null)).toBeNull();
	});

	it("setzt den Akzent und stellt den Theme-Wert wieder her", () => {
		const props = new Map<string, string>();
		const root = {
			style: {
				setProperty: (k: string, v: string) => void props.set(k, v),
				removeProperty: (k: string) => {
					props.delete(k);
					return "";
				},
			},
		};
		storage.setAccent("#204060");
		applyAccent(storage.accent(), root);
		expect(props.get("--accent")).toBe("#204060");
		expect(props.get("--on-accent")).toBe("#fff");
		storage.setAccent(null);
		applyAccent(storage.accent(), root);
		expect(props.size).toBe(0);
	});
});
