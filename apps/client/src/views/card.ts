// Schwebende Karte über der Spielfläche für Notizen und Handouts: eine zur Zeit,
// schließt per Knopf, Escape oder Tipp neben die Karte.
import { h, iconButton } from "../dom.ts";
import { t } from "../i18n.ts";
import { ICONS } from "../icons.ts";

export interface Card {
	el: HTMLElement;
	show(owner: string, ...children: (Node | string)[]): void;
	hide(): void;
	/** Wem die Karte gerade gehört (z. B. "note:<id>"), sonst null. */
	owner(): string | null;
	destroy(): void;
}

export function createCard(): Card {
	let current: string | null = null;
	const body = h("div", { className: "card-body" });
	const box = h(
		"div",
		{ className: "card" },
		h(
			"div",
			{ className: "card-close" },
			iconButton(ICONS.close, t("panel.close"), () => hide(), false),
		),
		body,
	);
	const el = h("div", { className: "card-overlay", hidden: true }, box);
	el.addEventListener("pointerdown", (e) => {
		if (e.target === el) hide();
	});
	const keydown = (e: KeyboardEvent) => {
		if (e.key === "Escape" && !el.hidden) hide();
	};
	window.addEventListener("keydown", keydown);

	function hide(): void {
		current = null;
		el.hidden = true;
		body.replaceChildren();
	}

	return {
		el,
		show(owner, ...children) {
			current = owner;
			body.replaceChildren(...children);
			el.hidden = false;
		},
		hide,
		owner: () => current,
		destroy: () => window.removeEventListener("keydown", keydown),
	};
}
