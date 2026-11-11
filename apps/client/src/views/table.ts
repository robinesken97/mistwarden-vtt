// Werkzeuge am Spieltisch für alle: Messen, Zeichnen und Radieren, Pings und das Würfel-Log.
// Die GM stellt zusätzlich Einheit und Diagonalregel der Szene ein.
import {
	type Action,
	DEFAULT_MEASURE,
	type DrawingData,
	type Entity,
	GM_COLOR,
	type GridData,
	MAX_DICE,
	MAX_SIDES,
	type MeasureData,
	type PlayerData,
	parseDice,
	type RollData,
	type RollTerm,
	type SceneData,
} from "@mistwarden/protocol";
import { changeDie, dieCount } from "../dice-pool.ts";
import { button, h, iconButton } from "../dom.ts";
import { simplifyStroke } from "../draw/shapes.ts";
import { t } from "../i18n.ts";
import { ICONS } from "../icons.ts";
import { ActionRejected, type SyncConnection } from "../net/connection.ts";
import type {
	StageDrawing,
	StageMeasurement,
	StageTool,
	WorldPoint,
} from "../render/stage.ts";
import { confirmDialog, panelHead } from "../ui.ts";

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
	/** Nach jedem Neuzeichnen: die Werkzeugleiste gleicht sich ab. */
	toolChanged(): void;
	/** Zurück zum Auswählen (Werkzeug der Raumansicht). */
	selectTool(): void;
	/** Öffnet oder schließt ein Panel; die Raumansicht hält immer nur eines offen. */
	togglePanel(panel: HTMLElement): void;
	changed(): void;
}

type ToolName = "measure" | "draw" | "erase";
type Shape = DrawingData["shape"];

/** Strichbreiten als Anteil der Feldgröße. */
const WIDTHS: [number, string][] = [
	[0.04, "Dünn"],
	[0.08, "Mittel"],
	[0.16, "Dick"],
];
/** Farben, aus denen die GM wählt; Spieler zeichnen immer in ihrer eigenen Farbe. */
const GM_PALETTE = [GM_COLOR, "#e04848", "#3fa7e0", "#5cc85c", "#f0f0f0"];
const DIAGONALS: [MeasureData["diagonal"], string][] = [
	["equal", "Immer 1 Feld"],
	["alternating", "Wechsel 1-2-1"],
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

	async function eraseMany(all: boolean): Promise<void> {
		const targets = sceneDrawings().filter((e) => {
			const d = e.data as DrawingData;
			return all ? canErase(d) : d.ownerId === myPlayerId();
		});
		if (targets.length === 0) return;
		const question = t(all ? "draw.clearAllConfirm" : "draw.clearOwnConfirm", {
			count: targets.length,
		});
		if (!(await confirmDialog(question, t("common.delete")))) return;
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
			rollError.textContent = t(`dice.${parsed.error}`, {
				part: parsed.part ?? "",
				maxSides: MAX_SIDES,
				maxDice: MAX_DICE,
			});
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

	// --- Kopfzeile: Würfel-Log ---
	const logButton = iconButton(ICONS.log, t("hud.log"), () => {
		ctx.togglePanel(logPanel);
		if (!logPanel.hidden) scrollLog();
	});

	const measureLabel = h("div", { className: "measure-label", hidden: true });

	// --- Zeichenleiste ---
	const widthButtons = new Map<number, HTMLButtonElement>();
	const widthGroup = h("span", { className: "bar-group segmented" });
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
		b.style.setProperty("--swatch", color);
		b.title = `Farbe ${color}`;
		colorButtons.set(color, b);
		colorGroup.append(b);
	}
	colorGroup.hidden = !ctx.isGm;
	// Formen und Radierer sind Unterwerkzeuge der Leiste; hier stehen nur die Einstellungen.
	const drawBar = h(
		"div",
		{ className: "selection-bar", hidden: true },
		widthGroup,
		colorGroup,
		button("Meine löschen", () => eraseMany(false), "secondary"),
		...(ctx.isGm
			? [button("Alle löschen", () => eraseMany(true), "secondary")]
			: []),
	);
	const measureBar = h(
		"div",
		{ className: "selection-bar", hidden: true },
		h("span", { className: "hint" }, "Ziehen misst von Feld zu Feld"),
	);
	const logList = h("ol", { className: "roll-log" });
	const formulaInput = h("input", {
		type: "text",
		placeholder: t("dice.placeholder"),
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
		h("button", { type: "submit" }, t("dice.roll")),
	);
	rollForm.addEventListener("submit", (e) => {
		e.preventDefault();
		const formula = formulaInput.value.trim();
		if (!formula) return;
		void roll(formula).then(() => {
			if (rollError.hidden) formulaInput.value = "";
			renderPool();
		});
	});
	// Würfelvorrat: Antippen legt einen Würfel in die Formel, „−“ nimmt einen weg.
	const pool = QUICK_DICE.map((sides) => {
		const change = (delta: 1 | -1) => {
			formulaInput.value = changeDie(formulaInput.value, sides, delta);
			renderPool();
		};
		const less = button("−", () => change(-1), "secondary");
		less.setAttribute("aria-label", t("dice.less", { die: `d${sides}` }));
		return { sides, less, add: button("", () => change(1), "secondary") };
	});
	function renderPool(): void {
		for (const { sides, add, less } of pool) {
			const count = dieCount(formulaInput.value, sides);
			// Anzahl in eigener Zeile: „d100 ×12“ passt nicht nebeneinander in den Knopf.
			add.replaceChildren(
				`d${sides}`,
				...(count ? [h("span", { className: "die-count" }, `×${count}`)] : []),
			);
			less.disabled = count === 0;
		}
	}
	formulaInput.addEventListener("input", renderPool);
	renderPool();
	const quick = h(
		"div",
		{ className: "quick-dice" },
		...pool.map((p) => p.add),
		...pool.map((p) => p.less),
	);
	// Eine Spalte pro Würfel, damit jedes „−“ unter seinem Würfel steht.
	quick.style.gridTemplateColumns = `repeat(${pool.length}, minmax(0, 1fr))`;
	const logPanel = h(
		"aside",
		{ className: "panel log-panel", hidden: true },
		panelHead(t("dice.title"), () => ctx.togglePanel(logPanel)),
		logList,
		h(
			"div",
			{ className: "roll-controls" },
			quick,
			rollForm,
			...(ctx.isGm
				? [h("label", { className: "hint" }, hiddenBox, t("dice.hidden"))]
				: []),
			rollError,
		),
	);
	const toast = h("div", { className: "toast", hidden: true });

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
		const time = new Date(r.at).toLocaleTimeString(
			document.documentElement.lang,
			{ hour: "2-digit", minute: "2-digit" },
		);
		// Aufbau wie im Entwurf: oben Name und Zeit, darunter Formel, Einzelwürfe, Summe rechts.
		return h(
			"li",
			{ className: "roll" },
			h(
				"span",
				{ className: "roll-meta" },
				`${playerName(r.authorId)} · ${time}`,
				...(r.hidden
					? [" ", h("span", { className: "badge" }, t("dice.hiddenBadge"))]
					: []),
			),
			h(
				"span",
				{ className: "roll-row" },
				h("span", { className: "roll-formula" }, r.formula),
				h(
					"span",
					{ className: "roll-detail" },
					...r.terms.flatMap((term, index) => termNodes(term, index)),
				),
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
		logButton.classList.toggle("active", !logPanel.hidden);
		drawBar.hidden = tool !== "draw" && tool !== "erase";
		measureBar.hidden = tool !== "measure";
		for (const [factor, b] of widthButtons) {
			b.classList.toggle("active", factor === widthFactor);
		}
		for (const [color, b] of colorButtons) {
			b.classList.toggle("active", color === gmColor);
		}
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
		ctx.toolChanged();
	}

	return {
		tool: () => tool,
		shape: () => shape,
		setTool,
		/** Form wählen und zeichnen. */
		setShape(next: Shape): void {
			shape = next;
			setTool("draw");
		},
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
