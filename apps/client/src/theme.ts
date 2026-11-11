// Farbschema der Oberfläche, pro Gerät gewählt. „system“ folgt dem Gerät.
// Karte, Tokens und Fog hängen nicht davon ab; die Werte stehen in style.css.

export const THEMES = ["system", "dark", "oled", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
	system: "Wie das Gerät",
	dark: "Dunkel",
	oled: "OLED-Schwarz",
	light: "Hell",
};

/** Unbekannte oder fehlende Werte gelten als „system“. */
export function parseTheme(value: string | null): Theme {
	return THEMES.includes(value as Theme) ? (value as Theme) : "system";
}

export function applyTheme(
	theme: Theme,
	root: { dataset: DOMStringMap } = document.documentElement,
): void {
	if (theme === "system") delete root.dataset.theme;
	else root.dataset.theme = theme;
}

/** Eigene Akzentfarbe als #rrggbb; alles andere gilt als „keine“. */
export function parseAccent(value: string | null): string | null {
	return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/** Schwarz oder Weiß, je nachdem, was auf der Farbe besser lesbar ist (WCAG-Leuchtdichte). */
export function onAccent(hex: string): "#000" | "#fff" {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	// Ab dieser Leuchtdichte hat Schwarz den höheren Kontrast als Weiß.
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000" : "#fff";
}

/** Überschreibt den Akzent des Themes; null stellt den Theme-Wert wieder her. */
export function applyAccent(
	accent: string | null,
	root: {
		style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
	} = document.documentElement,
): void {
	if (accent) {
		root.style.setProperty("--accent", accent);
		root.style.setProperty("--on-accent", onAccent(accent));
	} else {
		root.style.removeProperty("--accent");
		root.style.removeProperty("--on-accent");
	}
}
