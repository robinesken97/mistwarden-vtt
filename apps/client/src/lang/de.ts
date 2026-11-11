// Deutsche Oberflächentexte. Jede weitere Sprache muss dieselben Schlüssel haben
// (der Typ in en.ts erzwingt das). Platzhalter stehen in {geschweiften Klammern}.
export const de = {
	"settings.theme": "Farbschema",
	"theme.system": "Wie das Gerät",
	"theme.dark": "Dunkel",
	"theme.oled": "OLED-Schwarz",
	"theme.light": "Hell",
	"settings.accent": "Akzentfarbe",
	"settings.accentReset": "Standard",
	"settings.language": "Sprache",
	"dice.too_long": "Formel zu lang",
	"dice.empty": "Leere Formel",
	"dice.too_many_terms": "Zu viele Summanden",
	"dice.unreadable": "Unverständlich: {part}",
	"dice.constant_too_large": "Zahl zu groß",
	"dice.no_dice": "Mindestens ein Würfel",
	"dice.sides_range": "Würfel mit 2 bis {maxSides} Seiten",
	"dice.too_many_dice": "Höchstens {maxDice} Würfel",
	"dice.keep_range": "Behalten: 1 bis Anzahl der Würfel",
} as const;
