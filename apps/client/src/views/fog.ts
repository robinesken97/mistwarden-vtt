// Fog-Werkzeuge der Raumansicht: Werkzeug-Umschalter (GM), Zeichenleiste für Polygon und
// Pinsel, Auswahlleiste und Liste der Fog-Formen, Schalter für die Nebelanimation.
import {
	type Action,
	type Entity,
	type FogData,
	type FogPolygon,
	type GridData,
	MAX_FOG_COORDS,
} from "@mistwarden/protocol";
import { button, h } from "../dom.ts";
import { brushToPolygons, polygonToPolygons } from "../fog/shapes.ts";
import { t } from "../i18n.ts";
import type { SyncConnection } from "../net/connection.ts";
import type { StageFog, StageTool, WorldPoint } from "../render/stage.ts";
import { confirmDialog, promptDialog } from "../ui.ts";
import { menu, menuDivider, menuItem, menuSwitch } from "./menu.ts";

export interface FogToolsContext {
	conn: SyncConnection;
	isGm: boolean;
	run(action: Action): Promise<number | undefined>;
	showError(message: string | null): void;
	displayedScene(): Entity | undefined;
	currentGrid(): GridData | null;
	/** Spielfläche, sobald geladen. */
	stage(): {
		setTool(tool: StageTool): void;
		finishPolygon(): void;
		undoPolygonPoint(): void;
		cancelDrawing(): void;
		setAnimateFog(on: boolean): void;
	} | null;
	changed(): void;
	/** Ein Fog-Werkzeug (oder Auswählen) wurde gewählt; andere Werkzeuge zurücksetzen. */
	toolTaken(): void;
	/** Ob Einrasten an ist (gilt für Tokens und das Fog-Rechteck). */
	snapping(): boolean;
}

type ToolName = "select" | "polygon" | "rect" | "brush";

const ANIMATE_KEY = "mistwarden.animateFog";
const BRUSH_SIZES = [0.25, 0.5, 1, 2, 3];

export function createFogTools(ctx: FogToolsContext) {
	let tool: ToolName = "select";
	/** Zuletzt benutztes Fog-Werkzeug; die Gruppe „Fog“ öffnet damit. */
	let lastDraw: ToolName = "polygon";
	let brushCells = 0.5;
	let polygonPoints = 0;
	let selectedId: string | null = null;
	let animate = readAnimate();

	// --- Daten ---
	function sceneFog(): Entity[] {
		const scene = ctx.displayedScene();
		if (!scene) return [];
		return [...ctx.conn.entities.values()]
			.filter(
				(e) => e.kind === "fog" && (e.data as FogData).sceneId === scene.id,
			)
			.sort((a, b) => a.version - b.version);
	}

	function byId(id: string | null): Entity | undefined {
		return id ? ctx.conn.entities.get(`fog:${id}`) : undefined;
	}

	/** Für Spieler nur aktive Formen; die GM sieht auch ausgeschaltete als Umriss. */
	function stageFog(): StageFog[] {
		return sceneFog()
			.filter((e) => ctx.isGm || (e.data as FogData).active)
			.map((e) => {
				const f = e.data as FogData;
				return {
					id: e.id,
					version: e.version,
					polygons: f.polygons,
					active: f.active,
					selected: e.id === selectedId,
				};
			});
	}

	function stageTool(): StageTool {
		if (tool === "brush") {
			const grid = ctx.currentGrid();
			return { type: "brush", radius: ((grid?.size ?? 100) * brushCells) / 2 };
		}
		if (tool === "rect") {
			const grid = ctx.currentGrid();
			return {
				type: "rect",
				grid: ctx.snapping() && grid?.type === "square" ? grid : null,
			};
		}
		return { type: tool };
	}

	// --- Aktionen ---
	async function create(polygons: FogPolygon[]): Promise<void> {
		const scene = ctx.displayedScene();
		if (!scene || polygons.length === 0) return;
		const coords = polygons.reduce(
			(n, p) => n + p.outer.length + p.holes.reduce((m, r) => m + r.length, 0),
			0,
		);
		if (coords > MAX_FOG_COORDS) {
			ctx.showError(t("fog.tooDetailed"));
			return;
		}
		await ctx.run({
			op: "create",
			kind: "fog",
			id: crypto.randomUUID(),
			data: {
				sceneId: scene.id,
				polygons,
				active: true,
				source: "hand",
				name: "",
			},
		});
	}

	function setActive(id: string, active: boolean): void {
		ctx.run({ op: "update", kind: "fog", id, patch: { active } });
	}

	function select(id: string | null): void {
		selectedId = ctx.isGm && byId(id) ? id : null;
		ctx.changed();
	}

	function setTool(next: ToolName): void {
		ctx.toolTaken();
		tool = next;
		if (next !== "select") {
			selectedId = null;
			lastDraw = next;
		}
		ctx.stage()?.setTool(stageTool());
		ctx.changed();
	}

	const callbacks = {
		polygonChanged(points: number) {
			polygonPoints = points;
			render();
		},
		polygonDone(points: WorldPoint[]) {
			void create(polygonToPolygons(points));
		},
		brushDone(stroke: WorldPoint[], radius: number) {
			// Toleranz: ein Zehntel des Pinselradius, mindestens ein Kartenpixel.
			void create(brushToPolygons(stroke, radius, Math.max(1, radius / 10)));
		},
	};

	// --- Zeichenleiste ---
	const pointsText = h("span");
	const finishButton = button(t("common.done"), () =>
		ctx.stage()?.finishPolygon(),
	);
	const undoButton = button(
		t("common.back"),
		() => ctx.stage()?.undoPolygonPoint(),
		"secondary",
	);
	const polygonGroup = h(
		"span",
		{ className: "bar-group" },
		pointsText,
		undoButton,
		finishButton,
		button(t("dialog.cancel"), () => ctx.stage()?.cancelDrawing(), "secondary"),
	);
	const brushText = h("span");
	const brushGroup = h(
		"span",
		{ className: "bar-group" },
		button("−", () => stepBrush(-1), "secondary"),
		brushText,
		button("+", () => stepBrush(1), "secondary"),
	);
	const rectHint = h("span", { className: "hint" }, t("fog.rectHint"));
	const drawBar = h(
		"div",
		{ className: "selection-bar", hidden: true },
		polygonGroup,
		brushGroup,
		rectHint,
	);

	function stepBrush(dir: number): void {
		const i = BRUSH_SIZES.indexOf(brushCells);
		brushCells =
			BRUSH_SIZES[Math.min(BRUSH_SIZES.length - 1, Math.max(0, i + dir))] ??
			0.5;
		ctx.stage()?.setTool(stageTool());
		render();
	}

	// --- Menü an der gewählten Fog-Fläche ---
	const fogName = h("strong", { className: "bar-name" });
	const activeSwitch = menuSwitch(t("fog.covers"), () => {
		const e = byId(selectedId);
		if (e) setActive(e.id, !(e.data as FogData).active);
	});
	const selectBar = menu(fogName, () => select(null), [
		activeSwitch.el,
		menuDivider(),
		menuItem(t("common.rename"), async () => {
			const e = byId(selectedId);
			if (!e) return;
			const name = await promptDialog(
				t("fog.namePrompt"),
				(e.data as FogData).name,
			);
			if (name !== null) {
				ctx.run({
					op: "update",
					kind: "fog",
					id: e.id,
					patch: { name: name.trim().slice(0, 40) },
				});
			}
		}),
		menuItem(
			t("common.delete"),
			async () => {
				const e = byId(selectedId);
				if (
					!e ||
					!(await confirmDialog(t("fog.deleteConfirm"), t("common.delete")))
				)
					return;
				selectedId = null;
				ctx.run({ op: "delete", kind: "fog", id: e.id });
				ctx.changed();
			},
			true,
		),
	]);

	// --- Menü: Liste (GM) und Animation (alle) ---
	const list = h("ul");
	const gmSection = h(
		"div",
		{},
		h("h2", {}, t("group.fog")),
		h("p", { className: "hint" }, t("fog.help")),
		h(
			"div",
			{ className: "row" },
			button(t("fog.coverAll"), () => setAll(true), "secondary"),
			button(t("fog.revealAll"), () => setAll(false), "secondary"),
		),
		list,
	);
	const animateBox = h("input", { type: "checkbox", checked: animate });
	animateBox.addEventListener("change", () => {
		animate = animateBox.checked;
		writeAnimate(animate);
		ctx.stage()?.setAnimateFog(animate);
	});
	const settingsSection = h(
		"div",
		{},
		h("label", {}, animateBox, t("fog.animate")),
	);

	function setAll(active: boolean): void {
		for (const e of sceneFog()) {
			if ((e.data as FogData).active !== active) setActive(e.id, active);
		}
	}

	// --- Tastatur (Laptop) im Polygon-Werkzeug ---
	const keydown = (e: KeyboardEvent) => {
		if (tool !== "polygon" || e.target instanceof HTMLInputElement) return;
		if (e.key === "Enter") ctx.stage()?.finishPolygon();
		else if (e.key === "Escape") ctx.stage()?.cancelDrawing();
		else if (e.key === "Backspace") ctx.stage()?.undoPolygonPoint();
		else return;
		e.preventDefault();
	};
	window.addEventListener("keydown", keydown);

	function render(): void {
		drawBar.hidden = tool === "select";
		polygonGroup.hidden = tool !== "polygon";
		brushGroup.hidden = tool !== "brush";
		rectHint.hidden = tool !== "rect";
		pointsText.textContent =
			polygonPoints === 0
				? t("fog.tapCorners")
				: t("fog.points", { count: polygonPoints });
		finishButton.disabled = polygonPoints < 3;
		undoButton.disabled = polygonPoints === 0;
		brushText.textContent = t("fog.brushSize", {
			size: brushCells.toLocaleString(document.documentElement.lang),
		});

		const e = byId(selectedId);
		if (selectedId && (!e || !sceneFog().includes(e))) selectedId = null;
		selectBar.hidden = !e || selectedId === null;
		if (e && selectedId) {
			const f = e.data as FogData;
			fogName.textContent = f.name || t("fog.area");
			activeSwitch.set(f.active);
		}

		if (!ctx.isGm) return;
		const items = sceneFog().map((entity, i) => {
			const f = entity.data as FogData;
			return h(
				"li",
				{},
				h(
					"span",
					{ className: "name" },
					f.name || t("fog.areaN", { n: i + 1 }),
					f.active
						? ""
						: h("span", { className: "badge muted" }, t("fog.revealedBadge")),
				),
				button(
					f.active ? t("fog.reveal") : t("fog.cover"),
					() => setActive(entity.id, !f.active),
					"secondary",
				),
				button(
					t("fog.select"),
					() => {
						setTool("select");
						select(entity.id);
					},
					"secondary",
				),
			);
		});
		list.replaceChildren(
			...(items.length
				? items
				: [h("li", { className: "hint" }, t("fog.none"))]),
		);
	}

	return {
		callbacks,
		stageFog,
		stageTool,
		select,
		render,
		setTool,
		/** Ein anderes Werkzeug ist jetzt aktiv: eigene Leisten schließen. */
		reset() {
			tool = "select";
			render();
		},
		animate: () => animate,
		tool: () => tool,
		/** Umriss der gewählten Fläche in Weltkoordinaten (für die Lage des Menüs). */
		selectedBox() {
			const e = byId(selectedId);
			if (!e) return null;
			const points = (e.data as FogData).polygons.flatMap((p) => p.outer);
			if (points.length === 0) return null;
			// Ringe sind flach gespeichert: x, y, x, y, …
			const xs = points.filter((_, i) => i % 2 === 0);
			const ys = points.filter((_, i) => i % 2 === 1);
			return {
				left: Math.min(...xs),
				top: Math.min(...ys),
				right: Math.max(...xs),
				bottom: Math.max(...ys),
			};
		},
		/** Gruppe „Fog“ gewählt: mit dem zuletzt benutzten Werkzeug weiter. */
		pickGroup: () => setTool(lastDraw),
		drawBar,
		selectBar,
		gmSection,
		settingsSection,
		destroy: () => window.removeEventListener("keydown", keydown),
	};
}

function readAnimate(): boolean {
	try {
		return localStorage.getItem(ANIMATE_KEY) !== "0";
	} catch {
		return true;
	}
}

function writeAnimate(on: boolean): void {
	try {
		localStorage.setItem(ANIMATE_KEY, on ? "1" : "0");
	} catch {
		// nur für diese Sitzung
	}
}
