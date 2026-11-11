// Einstellungen, die nur dieses Gerät betreffen: Sprache, Farbschema, Akzentfarbe.
import { DICE_MODES, parseDiceMode } from "../dice/mode.ts";
import { button, h } from "../dom.ts";
import { LANG_NAMES, LANGS, parseLang, t } from "../i18n.ts";
import { storage } from "../storage.ts";
import {
	applyAccent,
	applyTheme,
	parseAccent,
	parseTheme,
	THEMES,
} from "../theme.ts";

/** `withDice`: im Raum zusätzlich die Wahl der Würfelanimation. */
export function deviceSettings(withDice = false): HTMLElement {
	const diceSelect = h("select");
	diceSelect.append(
		...DICE_MODES.map((value) =>
			h("option", { value, textContent: t(`dice.mode.${value}`) }),
		),
	);
	diceSelect.value = storage.diceMode();
	diceSelect.addEventListener("change", () =>
		storage.setDiceMode(parseDiceMode(diceSelect.value)),
	);
	const langSelect = h("select");
	langSelect.append(
		...LANGS.map((value) =>
			h("option", { value, textContent: LANG_NAMES[value] }),
		),
	);
	langSelect.value = document.documentElement.lang;
	langSelect.addEventListener("change", () => {
		storage.setLang(parseLang(langSelect.value));
		// shortcut: Neuladen statt alle Views neu aufzubauen; ändern, sobald Views ihre Texte selbst aktualisieren können.
		location.reload();
	});
	const themeSelect = h("select");
	themeSelect.append(
		...THEMES.map((value) =>
			h("option", { value, textContent: t(`theme.${value}`) }),
		),
	);
	themeSelect.value = storage.theme();
	themeSelect.addEventListener("change", () => {
		const theme = parseTheme(themeSelect.value);
		storage.setTheme(theme);
		applyTheme(theme);
		if (!storage.accent()) accentInput.value = themeAccent();
	});
	// Ohne eigene Wahl zeigt das Feld den Akzent des aktuellen Themes.
	const themeAccent = () =>
		parseAccent(
			getComputedStyle(document.documentElement)
				.getPropertyValue("--accent")
				.trim(),
		) ?? "#000000";
	const accentInput = h("input", { type: "color" });
	accentInput.value = storage.accent() ?? themeAccent();
	accentInput.addEventListener("input", () => {
		const accent = parseAccent(accentInput.value);
		storage.setAccent(accent);
		applyAccent(accent);
	});
	const accentReset = button(
		t("settings.accentReset"),
		() => {
			storage.setAccent(null);
			applyAccent(null);
			accentInput.value = themeAccent();
		},
		"secondary",
	);
	return h(
		"div",
		{ className: "device-settings" },
		h("label", {}, t("settings.language"), langSelect),
		h("label", {}, t("settings.theme"), themeSelect),
		h("label", {}, t("settings.accent"), accentInput),
		accentReset,
		...(withDice
			? [h("label", { className: "wide" }, t("settings.dice"), diceSelect)]
			: []),
	);
}
