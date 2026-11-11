// Rahmen für alles außerhalb des Raums: Nachtszene im Hintergrund, Karte in der Mitte.
import { h, icon } from "../dom.ts";

const LANTERN = [
	"M24 4v5M19 9h10M17 15l2-6h10l2 6M15 15h18v18l-4 7H19l-4-7zM19 40l-1 4h12l-1-4",
	"M24 21c3 3 4 5 4 7a4 4 0 01-8 0c0-2 1-4 4-7z",
];

/** Die Szene besteht nur aus Flächen in style.css (kein Bild, folgt dem Theme). */
const SCENE = [
	"scene-moon",
	"scene-moon scene-moon-core",
	"scene-hills scene-hills-far",
	"scene-tower",
	"scene-window",
	"scene-hills scene-hills-near",
	"scene-mist mist-1",
	"scene-mist mist-2",
	"scene-mist mist-3",
];

export function startPage(
	root: HTMLElement,
	...content: (Node | string)[]
): void {
	root.replaceChildren(
		h(
			"div",
			{ className: "start" },
			h(
				"div",
				{ className: "start-scene", ariaHidden: "true" },
				...SCENE.map((className) => h("div", { className })),
			),
			h("div", { className: "start-card" }, ...content),
		),
	);
}

/** Laterne, Titel und eine Zeile darunter; `wordmark` setzt den Titel als Schriftzug. */
export function brand(
	title: string,
	tagline: string,
	wordmark = false,
): HTMLElement {
	const lantern = icon(LANTERN, 48);
	lantern.classList.add("lantern");
	return h(
		"header",
		{ className: "start-brand" },
		lantern,
		...(wordmark ? [] : [h("p", { className: "eyebrow" }, "Mistwarden")]),
		h("h1", { className: wordmark ? "wordmark" : "" }, title),
		...(tagline ? [h("p", { className: "hint" }, tagline)] : []),
	);
}

export function ornament(): HTMLElement {
	return h("div", { className: "ornament", ariaHidden: "true" }, h("span"));
}
