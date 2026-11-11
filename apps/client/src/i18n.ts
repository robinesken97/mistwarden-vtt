// Oberflächentexte in der Sprache des Geräts. Inhalte der Nutzer (Namen, Handouts,
// Notizen) werden nicht übersetzt.
import { de } from "./lang/de.ts";
import { en } from "./lang/en.ts";

export const LANGS = ["de", "en"] as const;
export type Lang = (typeof LANGS)[number];
export type TextKey = keyof typeof de;

/** Namen der Sprachen in der jeweiligen Sprache selbst. */
export const LANG_NAMES: Record<Lang, string> = {
	de: "Deutsch",
	en: "English",
};

const texts: Record<Lang, Record<TextKey, string>> = { de, en };
let current: Lang = "de";

export function parseLang(value: string | null): Lang | null {
	return LANGS.includes(value as Lang) ? (value as Lang) : null;
}

/** Deutsch für deutsch eingestellte Geräte, sonst Englisch. */
export function detectLang(deviceLanguage: string | undefined): Lang {
	return deviceLanguage?.toLowerCase().startsWith("de") ? "de" : "en";
}

export function setLang(lang: Lang): void {
	current = lang;
}

export function t(
	key: TextKey,
	vars: Record<string, string | number> = {},
): string {
	return texts[current][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in vars ? String(vars[name]) : whole,
	);
}
