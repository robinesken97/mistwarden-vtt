import type { de } from "./de.ts";

export const en: Record<keyof typeof de, string> = {
	"settings.theme": "Color scheme",
	"theme.system": "Match device",
	"theme.dark": "Dark",
	"theme.oled": "OLED black",
	"theme.light": "Light",
	"settings.accent": "Accent color",
	"settings.accentReset": "Default",
	"settings.language": "Language",
	"dice.too_long": "Formula too long",
	"dice.empty": "Empty formula",
	"dice.too_many_terms": "Too many terms",
	"dice.unreadable": "Can't read: {part}",
	"dice.constant_too_large": "Number too large",
	"dice.no_dice": "At least one die",
	"dice.sides_range": "Dice with 2 to {maxSides} sides",
	"dice.too_many_dice": "At most {maxDice} dice",
	"dice.keep_range": "Keep: 1 up to the number of dice",
};
