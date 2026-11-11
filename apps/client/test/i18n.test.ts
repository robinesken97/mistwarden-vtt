import { afterEach, describe, expect, it } from "vitest";
import { detectLang, parseLang, setLang, t } from "../src/i18n.ts";
import { storage } from "../src/storage.ts";

afterEach(() => setLang("de"));

describe("Sprache", () => {
	it("wählt Deutsch nur für deutsche Geräte", () => {
		expect(detectLang("de-AT")).toBe("de");
		expect(detectLang("DE")).toBe("de");
		expect(detectLang("fr-FR")).toBe("en");
		expect(detectLang(undefined)).toBe("en");
	});

	it("wechselt die Texte und setzt Platzhalter ein", () => {
		expect(t("dice.too_many_dice", { maxDice: 100 })).toBe(
			"Höchstens 100 Würfel",
		);
		setLang("en");
		expect(t("dice.too_many_dice", { maxDice: 100 })).toBe("At most 100 dice");
		expect(t("settings.language")).toBe("Language");
	});

	it("lässt fehlende Platzhalter sichtbar stehen", () => {
		expect(t("dice.unreadable")).toBe("Unverständlich: {part}");
	});

	it("speichert nur bekannte Sprachen", () => {
		expect(storage.lang()).toBeNull();
		storage.setLang("en");
		expect(storage.lang()).toBe("en");
		expect(parseLang("fr")).toBeNull();
		storage.setLang(null);
		expect(storage.lang()).toBeNull();
	});
});
