// Werkzeuggruppen der Raumansicht: Leiste mit den Gruppen, dazu die Unterwerkzeuge der
// aktiven Gruppe (über der Leiste, am Laptop daneben). Der Werkzeugzustand selbst liegt
// weiter bei fog.ts und table.ts; hier wird er nur gelesen und angezeigt.
import { h, iconButton } from "../dom.ts";

export interface Subtool {
	key: string;
	label: string;
	icon: string[];
	pick(): void;
}

export interface ToolGroup {
	key: string;
	label: string;
	icon: string[];
	pick(): void;
	subtools?: Subtool[];
	/** Schalter hinter den Unterwerkzeugen (z. B. Einrasten); versteckte bleiben weg. */
	extras?: HTMLElement[];
}

export interface ActiveTool {
	group: string;
	subtool: string | null;
}

export interface ToolState {
	/** Offenes Panel einer Gruppe; geht vor, die Leiste zeigt immer nur eine Gruppe aktiv. */
	panel: "tokens" | "scene" | "dice" | null;
	table: "measure" | "draw" | "erase" | null;
	shape: string;
	fog: "select" | "polygon" | "rect" | "brush";
}

/** Welche Gruppe und welches Unterwerkzeug gerade gelten. */
export function activeTool(s: ToolState): ActiveTool {
	if (s.panel) return { group: s.panel, subtool: null };
	if (s.table === "measure") return { group: "view", subtool: "measure" };
	if (s.table === "draw") return { group: "draw", subtool: s.shape };
	if (s.table === "erase") return { group: "draw", subtool: "erase" };
	if (s.fog !== "select") return { group: "fog", subtool: s.fog };
	return { group: "view", subtool: "select" };
}

export function createToolGroups(groups: ToolGroup[], label: string) {
	const toolbar = h("nav", { className: "toolbar" });
	toolbar.setAttribute("aria-label", label);
	const subtools = h("div", { className: "subtools", hidden: true });
	subtools.setAttribute("role", "group");

	const groupButtons = new Map<string, HTMLButtonElement>();
	const subButtons = new Map<string, Map<string, HTMLButtonElement>>();
	for (const g of groups) {
		const b = iconButton(g.icon, g.label, g.pick);
		groupButtons.set(g.key, b);
		toolbar.append(b);
		subButtons.set(
			g.key,
			new Map(
				(g.subtools ?? []).map((s) => [
					s.key,
					iconButton(s.icon, s.label, s.pick),
				]),
			),
		);
	}

	return {
		toolbar,
		subtools,
		render(active: ActiveTool): void {
			for (const [key, b] of groupButtons) {
				b.classList.toggle("active", key === active.group);
				b.setAttribute("aria-pressed", String(key === active.group));
			}
			const group = groups.find((g) => g.key === active.group);
			const buttons = subButtons.get(active.group) ?? new Map();
			for (const [key, b] of buttons) {
				b.classList.toggle("active", key === active.subtool);
				b.setAttribute("aria-pressed", String(key === active.subtool));
			}
			const extras = (group?.extras ?? []).filter((e) => !e.hidden);
			subtools.hidden = buttons.size === 0;
			subtools.setAttribute("aria-label", group?.label ?? "");
			subtools.replaceChildren(
				...buttons.values(),
				...(extras.length
					? [h("span", { className: "subtools-divider" }), ...extras]
					: []),
			);
		},
	};
}
