// Werkzeuge am Spieltisch für alle: Messen, Zeichnen und Radieren, Pings und das Würfel-Log.
// Die GM stellt zusätzlich Einheit und Diagonalregel der Szene ein.
import {
	type Action,
	DEFAULT_MEASURE,
	type DrawingData,
	type Entity,
	GM_COLOR,
	type GridData,
	type MeasureData,
	type PlayerData,
	parseDice,
	type RollData,
	type RollTerm,
	type SceneData,
} from "@mistwarden/protocol";
import { button, h } from "../dom.ts";
import { simplifyStroke } from "../draw/shapes.ts";
import { ActionRejected, type SyncConnection } from "../net/connection.ts";
import type {
	StageDrawing,
	StageMeasurement,
	StageTool,
	WorldPoint,
} from "../render/stage.ts";

export interface TableToolsContext {
	conn: SyncConnection;
	isGm: boolean;
	run(action: Action): Promise<number | undefined>;
	showError(message: string | null): void;
	displayedScene(): Entity | undefined;
	currentGrid(): GridData | null;
	stage(): {
		setTool(tool: StageTool): void;
		showPing(x: number, y: number, color: string): void;
	} | null;
	/** Ein Werkzeug von hier wurde gewählt; andere Werkzeuge zurücksetzen. */
	toolTaken(): void;
	/** Zurück zum Auswählen (Werkzeug der Raumansicht). */
	selectTool(): void;
	changed(): void;
}

type ToolName = "measure" | "draw" | "erase";
type Shape = DrawingData["shape"];

const SHAPES: [Shape, string][] = [
	["free", "Frei"],
	["line", "Linie"],
	["rect", "Rechteck"],
	["ellipse", "Ellipse"],
];
/** Strichbreiten als Anteil der Feldgröße. */
const WIDTHS: [number, string][] = [
	[0.04, "Dünn"],
	[0.08, "Mittel"],
	[0.16, "Dick"],
];
/** Farben, aus denen die GM wählt; Spieler zeichnen immer in ihrer eigenen Farbe. */
const GM_PALETTE = [GM_COLOR, "#e04848", "#3fa7e0", "#5cc85c", "#f0f0f0"];
const DIAGONALS: [MeasureData["diagonal"], string][] = [
	["equal", "Jede Diagonale 1 Feld"],
	["alternating", "Abwechselnd 1-2-1"],
	["euclidean", "Luftlinie"],
];
const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];
const ROLL_TOAST_MS = 5000;
const MEASURE_SEND_DELAY_MS = 400;

export function createTableTools(ctx: TableToolsContext) {
	let tool: ToolName | null = null;
	let shape: Shape = "free";
	let widthFactor = 0.08;
	let gmColor = GM_COLOR;
	let hiddenRoll = true;
	let logKey = "";
	let knownRolls: Set<string> | null = null;
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let measureTimer: ReturnType<typeof setTimeout> | undefined;

	// --- Daten ---
	function myPlayerId(): string | null {
		const id = ctx.conn.identity;
		return id?.role === "player" ? id.playerId : null;
	}

	function playerName(id: string | null): string {
		if (id === null) return "GM";
		const p = ctx.conn.entities.get(`player:${id}`);
		return (p?.data as PlayerData | undefined)?.name ?? "Unbekannt";
	}

	function myColor(): string {
		const id = myPlayerId();
		if (id === null) return gmColor;
		const p = ctx.conn.entities.get(`player:${id}`);
		return (p?.data as PlayerData | undefined)?.color ?? GM_COLOR;
	}

	function sceneDrawings(): Entity[] {
		const scene = ctx.displayedScene();
		if (!scene) return [];
		return [...ctx.conn.entities.values()]
			.filter(
				(e) =>
					e.kind === "drawing" && (e.data as DrawingData).sceneId === scene.id,
			)
			.sort((a, b) => a.version - b.version);
	}

	function canErase(d: DrawingData): boolean {
		return ctx.isGm || d.ownerId === myPlayerId();
	}

	function stageDrawings(): StageDrawing[] {
		return sceneDrawings().map((e) => {
			const d = e.data as DrawingData;
			return {
				id: e.id,
				version: e.version,
				shape: d.shape,
				points: d.points,
				color: d.color,
				width: d.width,
				erasable: canErase(d),
			};
		});
	}

	function strokeWidth(): number {
		const size = ctx.currentGrid()?.size ?? 100;
		return Math.min(100, Math.max(1, Math.round(size * widthFactor)));
	}

	function stageTool(): StageTool | null {
		switch (tool) {
			case "measure":
				return { type: "measure" };
			case "erase":
				return { type: "erase" };
			case "draw":
				return {
					type: "draw",
					shape,
					color: myColor(),
					width: strokeWidth(),
				};
			case null:
				return null;
		}
	}

	function setTool(next: ToolName | null): void {
		if (next === null) {
			reset();
			ctx.selectTool();
			return;
		}
		ctx.toolTaken();
		tool = next;
		const t = stageTool();
		if (t) ctx.stage()?.setTool(t);
		render();
	}

	/** Von außen: ein anderes Werkzeug ist jetzt aktiv. */
	function reset(): void {
		tool = null;
		measureLabel.hidden = true;
		render();
	}

	// --- Aktionen ---
	async function draw(kind: Shape, points: WorldPoint[]): Promise<void> {
		const scene = ctx.displayedScene();
		if (!scene || points.length === 0) return;
		const width = strokeWidth();
		let flat: number[];
		if (kind === "free") {
			flat = simplifyStroke(points, Math.max(1, width / 4));
		} else {
			const a = points[0] as WorldPoint;
			const b = points[points.length - 1] as WorldPoint;
			flat = [a.x, a.y, b.x, b.y].map(Math.round);
			// Versehentliches Antippen ohne Ausdehnung ergibt keine Form.
			if (flat[0] === flat[2] && flat[1] === flat[3]) return;
		}
		await ctx.run({
			op: "create",
			kind: "drawing",
			id: crypto.randomUUID(),
			data: {
				sceneId: scene.id,
				ownerId: myPlayerId(),
				color: myColor(),
				shape: kind,
				points: flat,
				width,
			},
		});
	}

	function erase(id: string): void {
		ctx.run({ op: "delete", kind: "drawing", id });
	}

	function eraseMany(all: boolean): void {
		const targets = sceneDrawings().filter((e) => {
			const d = e.data as DrawingData;
			return all ? canErase(d) : d.ownerId === myPlayerId();
		});
		if (targets.length === 0) return;
		const question = all
			? `Alle ${targets.length} Zeichnungen dieser Szene löschen?`
			: `Deine ${targets.length} Zeichnungen in dieser Szene löschen?`;
		if (!confirm(question)) return;
		for (const e of targets) erase(e.id);
	}

	function ping(world: WorldPoint): void {
		const scene = ctx.displayedScene();
		if (!scene) return;
		ctx.conn.pointer(scene.id, world.x, world.y);
	}

	async function roll(formula: string): Promise<void> {
		const parsed = parseDice(formula);
		if (!parsed.ok) {
			rollError.textContent = parsed.error;
			rollError.hidden = false;
			return;
		}
		rollError.hidden = true;
		try {
			await ctx.conn.roll(parsed.formula, ctx.isGm && hiddenRoll);
		} catch (err) {
			rollError.hidden = false;
			rollError.textContent =
				err instanceof ActionRejected
					? "Wurf abgelehnt."
					: `Wurf fehlgeschlagen: ${String(err)}`;
		}
	}

	ctx.conn.onPointer((p) => {
		if (p.sceneId === ctx.displayedScene()?.id) {
			ctx.stage()?.showPing(p.x, p.y, p.color);
		}
	});

	const callbacks = {
		drawDone(kind: Shape, points: WorldPoint[]) {
			void draw(kind, points);
		},
		erase,
		ping,
		measure(result: StageMeasurement | null) {
			if (!result) {
				measureLabel.hidden = true;
				return;
			}
			measureLabel.hidden = false;
			measureLabel.textContent = `${formatNumber(result.cells)} ${
				result.cells === 1 ? "Feld" : "Felder"
			} · ${formatNumber(result.distance)} ${result.unit}`;
			measureLabel.style.transform = `translate(${Math.round(result.screen.x + 14)}px, ${Math.round(result.screen.y - 34)}px)`;
		},
	};

	// --- HUD: Werkzeuge für alle ---
	const toolButtons = new Map<ToolName, HTMLButtonElement>();
	const toolSwitch = h("span", { className: "tool-switch" });
	for (const [name, label] of [
		["measure", "Messen"],
		["draw", "Zeichnen"],
	] as const) {
		const b = button(
			label,
			() => setTool(tool === name ? null : name),
			"secondary",
		);
		toolButtons.set(name, b);
		toolSwitch.append(b);
	}
	const logButton = button(
		"Würfel",
		() => {
			logPanel.hidden = !logPanel.hidden;
			if (!logPanel.hidden) scrollLog();
			render();
		},
		"secondary",
	);

	const measureLabel = h("div", { className: "measure-label", hidden: true });

	// --- Zeichenleiste ---
	const shapeButtons = new Map<Shape, HTMLButtonElement>();
	const shapeGroup = h("span", { className: "bar-group" });
	for (const [name, label] of SHAPES) {
		const b = button(
			label,
			() => {
				shape = name;
				setTool("draw");
			},
			"secondary",
		);
		shapeButtons.set(name, b);
		shapeGroup.append(b);
	}
	const widthButtons = new Map<number, HTMLButtonElement>();
	const widthGroup = h("span", { className: "bar-group" });
	for (const [factor, label] of WIDTHS) {
		const b = button(
			label,
			() => {
				widthFactor = factor;
				setTool("draw");
			},
			"secondary",
		);
		widthButtons.set(factor, b);
		widthGroup.append(b);
	}
	const colorButtons = new Map<string, HTMLButtonElement>();
	const colorGroup = h("span", { className: "bar-group" });
	for (const color of GM_PALETTE) {
		const b = button(
			"",
			() => {
				gmColor = color;
				setTool("draw");
			},
			"secondary",
		);
		b.className = "swatch";
		b.style.background = color;
		b.title = `Farbe ${color}`;
		colorButtons.set(color, b);
		colorGroup.append(b);
	}
	colorGroup.hidden = !ctx.isGm;
	const eraseButton = button(
		"Radierer",
		() => setTool(tool === "erase" ? "draw" : "erase"),
		"secondary",
	);
	const drawBar = h(
		"div",
		{ className: "selection-bar", hidden: true },
		shapeGroup,
		widthGroup,
		colorGroup,
		h(
			"span",
			{ className: "bar-group" },
			eraseButton,
			button("Meine löschen", () => eraseMany(false), "secondary"),
			...(ctx.isGm
				? [button("Alle löschen", () => eraseMany(true), "secondary")]
				: []),
		),
		button("Fertig", () => setTool(null), "secondary"),
	);
	const measureBar = h(
		"div",
		{ className: "selection-bar", hidden: true },
		h("span", { className: "hint" }, "Ziehen misst von Feld zu Feld"),
		button("Fertig", () => setTool(null), "secondary"),
	);

	// --- Würfel-Log ---
	const logList = h("ol", { className: "roll-log" });
	const formulaInput = h("input", {
		type: "text",
		placeholder: "z. B. 1d20+5 oder 4d6kh3",
		autocomplete: "off",
		maxLength: 100,
	});
	formulaInput.setAttribute("autocapitalize", "off");
	formulaInput.spellcheck = false;
	const rollError = h("p", { className: "error", hidden: true });
	const hiddenBox = h("input", { type: "checkbox", checked: hiddenRoll });
	hiddenBox.addEventListener("change", () => {
		hiddenRoll = hiddenBox.checked;
	});
	const rollForm = h(
		"form",
		{ className: "roll-form" },
		formulaInput,
		h("button", { type: "submit" }, "Würfeln"),
	);
	rollForm.addEventListener("submit", (e) => {
		e.preventDefault();
		const formula = formulaInput.value.trim();
		if (!formula) return;
		void roll(formula).then(() => {
			if (rollError.hidden) formulaInput.value = "";
		});
	});
	const quick = h("div", { className: "quick-dice" });
	for (const sides of QUICK_DICE) {
		quick.append(
			button(`d${sides}`, () => void roll(`1d${sides}`), "secondary"),
		);
	}
	const logPanel = h(
		"aside",
		{ className: "log-panel", hidden: true },
		h(
			"div",
			{ className: "log-head" },
			h("h2", {}, "Würfel"),
			button(
				"Schließen",
				() => {
					logPanel.hidden = true;
					render();
				},
				"secondary",
			),
		),
		logList,
		quick,
		rollForm,
		...(ctx.isGm
			? [
					h(
						"label",
						{ className: "hint" },
						hiddenBox,
						" Verdeckt würfeln (nur du siehst den Wurf)",
					),
				]
			: []),
		rollError,
	);
	const toast = h("div", { className: "roll-toast", hidden: true });

	function rolls(): Entity[] {
		return [...ctx.conn.entities.values()]
			.filter((e) => e.kind === "roll")
			.sort(
				(a, b) =>
					(a.data as RollData).at - (b.data as RollData).at ||
					a.version - b.version,
			);
	}

	function rollLine(e: Entity): HTMLLIElement {
		const r = e.data as RollData;
		const time = new Date(r.at).toLocaleTimeString("de-DE", {
			hour: "2-digit",
			minute: "2-digit",
		});
		return h(
			"li",
			{ className: r.hidden ? "roll hidden-roll" : "roll" },
			h(
				"div",
				{ className: "roll-head" },
				h("strong", {}, playerName(r.authorId)),
				h("span", { className: "hint" }, ` ${time}`),
				...(r.hidden ? [h("span", { className: "badge" }, "verdeckt")] : []),
			),
			h(
				"div",
				{},
				h("span", { className: "roll-formula" }, r.formula),
				" ",
				...r.terms.flatMap((t, i) => termNodes(t, i)),
				" = ",
				h("strong", { className: "roll-total" }, String(r.total)),
			),
		);
	}

	function scrollLog(): void {
		logList.scrollTop = logList.scrollHeight;
	}

	function renderLog(): void {
		const list = rolls();
		const key = list.map((e) => e.id).join(",");
		if (key === logKey) return;
		logKey = key;
		logList.replaceChildren(...list.map(rollLine));
		if (!logPanel.hidden) scrollLog();

		// Neue Würfe kurz einblenden – nicht beim ersten Laden oder nach dem Nachholen.
		const ids = new Set(list.map((e) => e.id));
		if (knownRolls && ctx.conn.status === "online") {
			const fresh = list.filter((e) => !knownRolls?.has(e.id));
			const last = fresh[fresh.length - 1];
			if (last) showToast(last);
		}
		knownRolls = ctx.conn.status === "online" ? ids : knownRolls;
	}

	function showToast(e: Entity): void {
		const r = e.data as RollData;
		toast.textContent = `${playerName(r.authorId)}: ${r.formula} = ${r.total}${
			r.hidden ? " (verdeckt)" : ""
		}`;
		toast.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast.hidden = true;
		}, ROLL_TOAST_MS);
	}

	// --- GM: Messeinstellungen der Szene ---
	const perCell = h("input", {
		type: "number",
		step: "0.5",
		min: "0.5",
		className: "num",
	});
	const unit = h("input", { type: "text", maxLength: 8, className: "num" });
	const diagonal = h("select");
	for (const [value, label] of DIAGONALS) {
		diagonal.append(h("option", { value, textContent: label }));
	}
	let measureDraft: { sceneId: string; measure: MeasureData } | null = null;

	function currentMeasure(): MeasureData {
		const scene = ctx.displayedScene();
		if (scene && measureDraft?.sceneId === scene.id)
			return measureDraft.measure;
		return (
			(scene?.data as Partial<SceneData> | undefined)?.measure ??
			DEFAULT_MEASURE
		);
	}

	function changeMeasure(): void {
		const scene = ctx.displayedScene();
		if (!scene) return;
		const old = currentMeasure();
		const n = Number(perCell.value);
		const next: MeasureData = {
			perCell: Number.isFinite(n) && n > 0 ? Math.min(10_000, n) : old.perCell,
			unit: unit.value.trim().slice(0, 8) || old.unit,
			diagonal: diagonal.value as MeasureData["diagonal"],
		};
		measureDraft = { sceneId: scene.id, measure: next };
		ctx.changed();
		clearTimeout(measureTimer);
		measureTimer = setTimeout(async () => {
			const draft = measureDraft;
			if (!draft) return;
			await ctx.run({
				op: "update",
				kind: "scene",
				id: draft.sceneId,
				patch: { measure: draft.measure },
			});
			if (measureDraft === draft) {
				measureDraft = null;
				ctx.changed();
			}
		}, MEASURE_SEND_DELAY_MS);
	}
	for (const input of [perCell, unit, diagonal]) {
		input.addEventListener("input", changeMeasure);
	}

	const gmMeasureSection = h(
		"div",
		{},
		h("h3", {}, "Messen"),
		h(
			"div",
			{ className: "grid-form" },
			h("label", {}, "Pro Feld ", perCell),
			h("label", {}, "Einheit ", unit),
			h("label", {}, "Diagonalen ", diagonal),
		),
		h(
			"p",
			{ className: "hint" },
			"Gilt für Quadrat-Grids; auf Hex-Grids zählt immer die Hex-Distanz.",
		),
	);

	// --- Darstellung ---
	function render(): void {
		for (const [name, b] of toolButtons) {
			b.classList.toggle(
				"active",
				name === tool || (name === "draw" && tool === "erase"),
			);
		}
		logButton.classList.toggle("active", !logPanel.hidden);
		drawBar.hidden = tool !== "draw" && tool !== "erase";
		measureBar.hidden = tool !== "measure";
		for (const [name, b] of shapeButtons) {
			b.classList.toggle("active", tool === "draw" && name === shape);
		}
		for (const [factor, b] of widthButtons) {
			b.classList.toggle("active", factor === widthFactor);
		}
		for (const [color, b] of colorButtons) {
			b.classList.toggle("active", color === gmColor);
		}
		eraseButton.classList.toggle("active", tool === "erase");
		if (tool !== "measure") measureLabel.hidden = true;
		renderLog();

		const m = currentMeasure();
		const set = (
			input: HTMLInputElement | HTMLSelectElement,
			value: string,
		) => {
			if (document.activeElement !== input) input.value = value;
		};
		set(perCell, String(m.perCell));
		set(unit, m.unit);
		set(diagonal, m.diagonal);
	}

	return {
		toolSwitch,
		logButton,
		drawBar,
		measureBar,
		measureLabel,
		logPanel,
		toast,
		gmMeasureSection,
		callbacks,
		stageDrawings,
		currentMeasure,
		reset,
		render,
	};
}

/** Summand im Log, z. B. „+ [2, 6, ~1~, 5]“; verworfene Würfel durchgestrichen. */
function termNodes(t: RollTerm, index: number): (Node | string)[] {
	const sign = t.sign < 0 ? "− " : index === 0 ? "" : "+ ";
	if (t.type === "const") return [`${sign}${t.value} `];
	const dice: (Node | string)[] = [];
	t.results.forEach((value, i) => {
		if (i > 0) dice.push(", ");
		dice.push(
			t.kept[i]
				? String(value)
				: h("s", { className: "dropped" }, String(value)),
		);
	});
	return [sign, h("span", { className: "roll-dice" }, "[", ...dice, "]"), " "];
}

function formatNumber(n: number): string {
	return n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}
