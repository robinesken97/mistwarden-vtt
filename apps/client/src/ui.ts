// Gemeinsame Bausteine der Raum-Oberfläche: Panels (immer nur eines offen) und Dialoge.
import { button, h } from "./dom.ts";
import { t } from "./i18n.ts";

interface Hideable {
	hidden: HTMLElement["hidden"];
}

/** Verwaltet die Panels eines Raums; ein zweites zu öffnen schließt das erste. */
export function createPanels(onChange: () => void = () => {}) {
	const panels = new Set<Hideable>();
	const show = (open: Hideable | null) => {
		for (const p of panels) p.hidden = p !== open;
		onChange();
	};
	return {
		add<T extends Hideable>(panel: T): T {
			panel.hidden = true;
			panels.add(panel);
			return panel;
		},
		toggle: (panel: Hideable) => show(panel.hidden ? panel : null),
		close: () => show(null),
	};
}

/** Kopf jedes Panels: Titel links, Schließen immer an derselben Stelle rechts. */
export function panelHead(title: string, onClose: () => void): HTMLElement {
	const close = button("✕", onClose, "secondary");
	close.setAttribute("aria-label", t("panel.close"));
	return h("div", { className: "panel-head" }, h("h2", {}, title), close);
}

/** Modaler Dialog; liefert null bei Abbrechen oder Escape. */
function ask<T>(
	content: Node[],
	okLabel: string,
	value: () => T,
): Promise<T | null> {
	return new Promise((resolve) => {
		let result: T | null = null;
		const cancel = button(
			t("dialog.cancel"),
			() => dialog.close(),
			"secondary",
		);
		const form = h(
			"form",
			{ method: "dialog" },
			...content,
			h(
				"div",
				{ className: "dialog-actions" },
				cancel,
				h("button", { type: "submit", textContent: okLabel }),
			),
		);
		const dialog = h("dialog", { className: "dialog" }, form);
		form.addEventListener("submit", () => {
			result = value();
		});
		dialog.addEventListener("close", () => {
			dialog.remove();
			resolve(result);
		});
		document.body.append(dialog);
		dialog.showModal();
	});
}

/** Ersetzt `confirm()`; der Fokus liegt zuerst auf „Abbrechen“. */
export function confirmDialog(
	message: string,
	okLabel: string,
): Promise<boolean> {
	return ask([h("p", {}, message)], okLabel, () => true).then(Boolean);
}

/** Ersetzt `prompt()`; null bei Abbrechen. */
export function promptDialog(
	label: string,
	initial: string,
): Promise<string | null> {
	const input = h("input", { type: "text", value: initial });
	return ask([h("label", {}, label, input)], t("dialog.ok"), () => input.value);
}
