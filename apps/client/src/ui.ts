// Gemeinsame Bausteine der Raum-Oberfläche: Panels (immer nur eines offen) und Dialoge.
import { button, h, iconButton } from "./dom.ts";
import { t } from "./i18n.ts";
import { ICONS } from "./icons.ts";

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
		/** Ob gerade ein Panel offen ist (die Werkzeugleiste weicht dann aus). */
		isOpen: () => [...panels].some((p) => !p.hidden),
	};
}

/** Kopf jedes Panels: Titel links, Schließen immer an derselben Stelle rechts. */
export function panelHead(title: string, onClose: () => void): HTMLElement {
	const close = iconButton(ICONS.close, t("panel.close"), onClose, false);
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

/** Wie lange eine Meldung stehen bleibt. */
const TOAST_MS = 6000;

/** Kurze Meldung oben in der Mitte; verschwindet von selbst, null blendet sofort aus. */
export function createToast(kind: "error" | "info") {
	const el = h("div", { className: `toast ${kind}`, hidden: true });
	el.setAttribute("role", kind === "error" ? "alert" : "status");
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		el,
		show(message: string | null): void {
			clearTimeout(timer);
			el.textContent = message ?? "";
			el.hidden = !message;
			if (message) {
				timer = setTimeout(() => {
					el.hidden = true;
				}, TOAST_MS);
			}
		},
	};
}
