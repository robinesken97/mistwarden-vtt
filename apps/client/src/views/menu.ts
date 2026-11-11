// Schwebendes Menü an einem Objekt der Karte (Token, Fog-Fläche): Zeilen mit Beschriftung
// links und Wert oder Bedienelement rechts, Schalter, Trenner. Dazu die Platzierung.
import { h, iconButton } from "../dom.ts";
import { t } from "../i18n.ts";
import { ICONS } from "../icons.ts";

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Position eines Menüs neben seinem Objekt: rechts daneben, bei Platzmangel links, sonst
 * in die freie Fläche geschoben. Oben bündig mit dem Objekt, soweit es passt.
 */
export function placeMenu(
	anchor: Box,
	size: { width: number; height: number },
	bounds: Box,
	gap = 12,
): { left: number; top: number } {
	const clamp = (v: number, min: number, max: number) =>
		Math.max(min, Math.min(v, Math.max(min, max)));
	const fitsRight = anchor.right + gap + size.width <= bounds.right;
	const fitsLeft = anchor.left - gap - size.width >= bounds.left;
	const left =
		fitsRight || !fitsLeft
			? anchor.right + gap
			: anchor.left - gap - size.width;
	return {
		left: Math.round(clamp(left, bounds.left, bounds.right - size.width)),
		top: Math.round(clamp(anchor.top, bounds.top, bounds.bottom - size.height)),
	};
}

/** Menü mit Kopfzeile (Name, Schließen); `rows` folgen darunter. */
export function menu(name: HTMLElement, onClose: () => void, rows: Node[]) {
	const el = h(
		"div",
		{ className: "menu", hidden: true },
		h(
			"div",
			{ className: "menu-row menu-head" },
			name,
			iconButton(ICONS.close, t("panel.close"), onClose, false),
		),
		...rows,
	);
	el.setAttribute("role", "menu");
	return el;
}

/** Zeile mit Beschriftung links und Bedienelementen rechts. */
export function menuRow(label: string, ...controls: Node[]): HTMLElement {
	return h("div", { className: "menu-row" }, h("span", {}, label), ...controls);
}

/** Zeile mit Auswahlfeld; die ganze Zeile ist das Feld. */
export function menuSelect(
	label: string,
	select: HTMLSelectElement,
): HTMLElement {
	return h("label", { className: "menu-row" }, h("span", {}, label), select);
}

export function menuItem(
	label: string,
	onClick: () => void,
	danger = false,
): HTMLButtonElement {
	const el = h("button", {
		type: "button",
		className: danger ? "menu-item danger" : "menu-item",
		textContent: label,
	});
	el.setAttribute("role", "menuitem");
	el.addEventListener("click", onClick);
	return el;
}

/** Schalter-Zeile; `set` zeigt den aktuellen Zustand. */
export function menuSwitch(label: string, onToggle: () => void) {
	const el = h(
		"button",
		{ type: "button", className: "menu-item" },
		label,
		h("span", { className: "switch" }),
	);
	el.setAttribute("role", "switch");
	el.addEventListener("click", onToggle);
	return {
		el,
		set: (on: boolean) => el.setAttribute("aria-checked", String(on)),
	};
}

export const menuDivider = () => h("div", { className: "menu-divider" });
