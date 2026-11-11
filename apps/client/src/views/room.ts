// Raumansicht: Spielfläche (PixiJS) über die ganze Seite, darüber eine Statusleiste und
// ein Menü mit Spielern und – für die GM – Szenen, Karte, Grid, Tokens, Fog und Spieler-Link.
// Messen, Zeichnen, Pings und Würfel stehen allen zur Verfügung.
import {
	type Action,
	type AssetMeta,
	DEFAULT_GRID,
	type Entity,
	type GridData,
	type PlayerData,
	ROOM_STATE_ID,
	type RoomStateData,
	type SceneData,
} from "@mistwarden/protocol";
import { ApiError, api, assetMeta, errorText, playerLink } from "../api.ts";
import { button, h, icon, iconButton } from "../dom.ts";
import { t } from "../i18n.ts";
import { ICONS } from "../icons.ts";
import {
	ActionRejected,
	defaultSocketUrl,
	SyncConnection,
} from "../net/connection.ts";
import { History, type UndoResult } from "../net/history.ts";
import type { Stage, StageCallbacks, StageTarget } from "../render/stage.ts";
import { navigate } from "../router.ts";
import { storage } from "../storage.ts";
import {
	confirmDialog,
	createPanels,
	createToast,
	panelHead,
	promptDialog,
} from "../ui.ts";
import { createCard } from "./card.ts";
import { deviceSettings } from "./device.ts";
import { createFogTools } from "./fog.ts";
import { createHandoutTools } from "./handouts.ts";
import { createNoteTools } from "./notes.ts";
import { brand, startPage } from "./start.ts";
import { createTableTools } from "./table.ts";
import { createTokenTools } from "./tokens.ts";
import { activeTool, createToolGroups, type ToolGroup } from "./toolgroups.ts";

const statusLabel = {
	connecting: "Verbinde …",
	online: "Verbunden",
	offline: "Getrennt – neuer Versuch läuft",
	unauthorized: "Kein Zugang",
} as const;

const rejectText = {
	invalid: "Nicht möglich (z. B. aktive Szene löschen oder verbergen).",
	forbidden: "Keine Berechtigung.",
	not_found: "Nicht gefunden.",
	exists: "Existiert bereits.",
} as const;

const gridTypes: [GridData["type"], string][] = [
	["square", "Quadrate"],
	["hexPointy", "Hex (Spitze oben)"],
	["hexFlat", "Hex (flach oben)"],
];

/** Verzögerung, bevor Grid-Änderungen gesendet werden (Vorschau ist sofort sichtbar). */
const GRID_SEND_DELAY_MS = 150;

/** Liefert eine Aufräumfunktion, die beim Verlassen der Ansicht aufgerufen wird. */
export function roomView(root: HTMLElement, roomId: string): () => void {
	const gmToken = storage.gmToken();
	const token = gmToken ?? storage.playerToken(roomId);
	if (!token) {
		startPage(
			root,
			brand("Mistwarden", t("room.noAccess"), true),
			button(t("start.toStart"), () => navigate("/")),
		);
		return () => {};
	}
	const isGm = gmToken !== null;

	const conn = new SyncConnection({
		url: defaultSocketUrl(location),
		token,
		...(isGm ? { roomId } : {}),
	});

	let disposed = false;
	let stage: Stage | null = null;
	/** Szene, die sich die GM gerade ansieht; null = die aktive Szene. */
	let viewedSceneId: string | null = null;
	/** Grid-Entwurf, solange Änderungen noch nicht beim Server angekommen sind. */
	let gridDraft: { sceneId: string; grid: GridData } | null = null;
	let gridTimer: ReturnType<typeof setTimeout> | undefined;
	let stageRequest = 0;

	// --- Grundgerüst ---
	const stageHost = h("div", { className: "stage" });
	const title = h("strong", { className: "hud-title" }, "Mistwarden");
	const statusDot = h("span", { className: "dot" });
	const statusText = h("span", { className: "hud-status" });
	const sceneText = h("span", { className: "hud-scene" });
	const backToActive = button(
		"Zur aktiven Szene",
		() => {
			viewedSceneId = null;
			render();
		},
		"secondary",
	);
	const panels = createPanels(() => {
		menuButton.classList.toggle("active", !panel.hidden);
		sceneButton.classList.toggle("active", !scenePanel.hidden);
		roomEl.classList.toggle("panel-open", panels.isOpen());
		// Die Leiste zeigt nur eine Gruppe aktiv: mit einem Gruppen-Panel gilt „Wählen“.
		if (groupPanel() && (table.tool() || fog.tool() !== "select"))
			fog.setTool("select");
		table.render();
	});
	// Panel der Gruppe „Tokens“ (GM): Bilder hochladen und platzieren.
	const tokenPanel = h(
		"aside",
		{ className: "panel", hidden: true },
		panelHead(t("group.tokens"), () => panels.close()),
	);
	const groupPanel = (): "tokens" | "scene" | "dice" | null =>
		!tokenPanel.hidden
			? "tokens"
			: !scenePanel.hidden
				? "scene"
				: !table.logPanel.hidden
					? "dice"
					: null;
	// GM: Der Szenenname in der Kopfzeile öffnet das Szenen-Panel (Liste, Karte, Grid).
	const scenePanel = h(
		"aside",
		{ className: "panel", hidden: true },
		panelHead(t("scenes.title"), () => panels.close()),
	);
	const sceneButton = button("", () => panels.toggle(scenePanel), "secondary");
	sceneButton.classList.add("hud-scene-button");
	sceneButton.append(sceneText, icon(ICONS.chevron));
	const menuButton = iconButton(
		ICONS.menu,
		t("menu.title"),
		() => panels.toggle(panel),
		false,
	);
	// Reihenfolge wie im Entwurf: Menü, Raum, Szene | Status, Verlauf, Handouts, Log.
	const hud = h(
		"header",
		{ className: "hud" },
		menuButton,
		title,
		isGm ? sceneButton : sceneText,
		backToActive,
		h("span", { className: "hud-space" }),
		h("span", { className: "hud-conn" }, statusDot, statusText),
		h("span", { className: "hud-slot" }),
	);
	// Fehler erscheinen als Meldung über der Karte, auch wenn kein Panel offen ist.
	const error = createToast("error");
	const stageMessage = h("p", { className: "stage-message", hidden: true });

	const roleText = h("p", { className: "hint" });
	const players = h("ul", { className: "players" });
	const gmPanel = h("div");
	const leave = isGm
		? button("Zur Raumliste", () => navigate("/"), "secondary")
		: button(
				t("room.leave"),
				async () => {
					if (!(await confirmDialog(t("room.leaveConfirm"), t("room.leave"))))
						return;
					storage.setPlayerToken(roomId, null);
					cleanup();
					startPage(
						root,
						brand("Mistwarden", t("room.left"), true),
						button(t("start.toStart"), () => navigate("/")),
					);
				},
				"secondary",
			);
	const deviceRow = deviceSettings();
	const panel = h(
		"aside",
		{ className: "panel", hidden: true },
		panelHead(t("menu.title"), () => panels.close()),
		roleText,
		h("h2", {}, "Spieler"),
		players,
		gmPanel,
		deviceRow,
		h("p", {}, leave),
	);

	panels.add(panel);
	panels.add(scenePanel);
	panels.add(tokenPanel);
	root.classList.add("room-mode");
	root.replaceChildren(
		h(
			"div",
			{ className: "room" },
			stageHost,
			stageMessage,
			hud,
			panel,
			scenePanel,
			tokenPanel,
		),
	);
	const roomEl = root.firstElementChild as HTMLElement;
	// Die HUD bricht auf schmalen Geräten (iPad hochkant) um; Panels sitzen darunter.
	const hudSize = new ResizeObserver(() =>
		roomEl.style.setProperty(
			"--hud-height",
			`${Math.ceil(hud.getBoundingClientRect().bottom)}px`,
		),
	);
	hudSize.observe(hud);

	const showActionError = (err: unknown) =>
		error.show(
			err instanceof ActionRejected ? rejectText[err.reason] : String(err),
		);

	// --- Rückgängig/Wiederholen (eigene Änderungen auf diesem Gerät) ---
	const history = new History({
		get: (key) => conn.entities.get(key),
		send: (action) => conn.send(action),
	});
	const undoText: Record<UndoResult, string | null> = {
		done: null,
		empty: null,
		stale: "Nicht mehr möglich: Das Objekt wurde inzwischen geändert.",
		failed: "Rückgängig/Wiederholen ist fehlgeschlagen.",
	};
	async function step(direction: "undo" | "redo"): Promise<void> {
		error.show(null);
		const result = await (direction === "undo"
			? history.undo()
			: history.redo());
		error.show(undoText[result]);
		renderHistory();
	}
	const undoButton = iconButton(
		ICONS.undo,
		t("history.undo"),
		() => void step("undo"),
		false,
	);
	undoButton.title = t("history.undoHint");
	const redoButton = iconButton(
		ICONS.redo,
		t("history.redo"),
		() => void step("redo"),
		false,
	);
	redoButton.title = t("history.redoHint");
	function renderHistory(): void {
		undoButton.disabled = !history.canUndo;
		redoButton.disabled = !history.canRedo;
	}
	const historyKeys = (e: KeyboardEvent) => {
		const target = e.target as HTMLElement | null;
		if (target?.closest("input, textarea, select")) return;
		if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
		const key = e.key.toLowerCase();
		if (key === "z") {
			e.preventDefault();
			void step(e.shiftKey ? "redo" : "undo");
		} else if (key === "y") {
			e.preventDefault();
			void step("redo");
		}
	};
	window.addEventListener("keydown", historyKeys);

	const run = (action: Action): Promise<number | undefined> => {
		error.show(null);
		return history
			.run(action)
			.catch((err: unknown) => {
				showActionError(err);
				return undefined;
			})
			.finally(renderHistory);
	};

	// --- Tokens ---
	const tokens = createTokenTools({
		conn,
		gmToken,
		run,
		displayedScene,
		currentGrid,
		viewCenter: () => stage?.viewCenter() ?? null,
		changed: () => {
			tokens.render();
			stage?.setTokens(tokens.stageTokens());
		},
		snapChanged: () => {
			if (fog.tool() === "rect") stage?.setTool(fog.stageTool());
		},
	});

	// --- Fog ---
	const fog = createFogTools({
		conn,
		isGm,
		run,
		showError: (msg) => error.show(msg),
		displayedScene,
		currentGrid,
		stage: () => stage,
		changed: () => {
			fog.render();
			stage?.setFog(fog.stageFog(), isGm);
			renderTools();
		},
		toolTaken: () => table.reset(),
		snapping: () => tokens.snapping(),
	});

	// --- Messen, Zeichnen, Pings, Würfel ---
	const table = createTableTools({
		conn,
		isGm,
		run,
		showError: (msg) => error.show(msg),
		displayedScene,
		currentGrid,
		stage: () => stage,
		toolTaken: () => fog.reset(),
		toolChanged: () => renderTools(),
		selectTool: () => fog.setTool("select"),
		togglePanel: (panel) => panels.toggle(panel),
		changed: () => {
			table.render();
			updateStage();
		},
	});

	// --- Notizen und Handouts ---
	const card = createCard();
	const notes = createNoteTools({
		conn,
		isGm,
		run,
		displayedScene,
		viewCenter: () => stage?.viewCenter() ?? null,
		card,
		changed: () => stage?.setNotes(notes.stageNotes()),
	});
	const handouts = createHandoutTools({ conn, roomId, gmToken, run, card });

	hud
		.querySelector(".hud-slot")
		?.replaceWith(
			undoButton,
			redoButton,
			h("span", { className: "hud-divider" }),
			handouts.hudButton,
			table.logButton,
		);

	// --- Werkzeuggruppen: GM sechs, Spieler drei ---
	/** Ein Werkzeug wird gewählt: ein offenes Gruppen-Panel weicht. */
	const leavePanel = () => {
		if (groupPanel()) panels.close();
	};
	const sub = (
		key: string,
		label: string,
		iconPaths: string[],
		pick: () => void,
	) => ({
		key,
		label,
		icon: iconPaths,
		pick: () => {
			leavePanel();
			pick();
		},
	});
	const groupList: (ToolGroup | null)[] = [
		{
			...sub("view", t("group.view"), ICONS.select, () =>
				fog.setTool("select"),
			),
			subtools: [
				sub("select", t("tool.select"), ICONS.select, () =>
					fog.setTool("select"),
				),
				sub("measure", t("tool.measure"), ICONS.measure, () =>
					table.setTool("measure"),
				),
			],
			extras: [tokens.snapButton],
		},
		{
			...sub("draw", t("group.draw"), ICONS.draw, () => table.setTool("draw")),
			subtools: [
				sub("free", t("tool.free"), ICONS.free, () => table.setShape("free")),
				sub("line", t("tool.line"), ICONS.line, () => table.setShape("line")),
				sub("rect", t("tool.rect"), ICONS.rect, () => table.setShape("rect")),
				sub("ellipse", t("tool.ellipse"), ICONS.ellipse, () =>
					table.setShape("ellipse"),
				),
				sub("erase", t("tool.erase"), ICONS.eraser, () =>
					table.setTool("erase"),
				),
			],
		},
		isGm
			? {
					...sub("fog", t("group.fog"), ICONS.fog, () => fog.pickGroup()),
					subtools: [
						sub("polygon", t("tool.polygon"), ICONS.polygon, () =>
							fog.setTool("polygon"),
						),
						sub("rect", t("tool.rect"), ICONS.rect, () => fog.setTool("rect")),
						sub("brush", t("tool.brush"), ICONS.brush, () =>
							fog.setTool("brush"),
						),
					],
					extras: [tokens.snapButton],
				}
			: null,
		isGm
			? {
					key: "tokens",
					label: t("group.tokens"),
					icon: ICONS.tokens,
					pick: () => panels.toggle(tokenPanel),
				}
			: null,
		isGm
			? {
					key: "scene",
					label: t("group.scene"),
					icon: ICONS.scene,
					pick: () => panels.toggle(scenePanel),
				}
			: null,
		{
			key: "dice",
			label: t("group.dice"),
			icon: ICONS.dice,
			pick: () => table.logButton.click(),
		},
	];
	const groups = createToolGroups(
		groupList.filter((g): g is ToolGroup => g !== null),
		t("toolbar.label"),
	);
	function renderTools(): void {
		groups.render(
			activeTool({
				panel: groupPanel(),
				table: table.tool(),
				shape: table.shape(),
				fog: fog.tool(),
			}),
		);
	}
	panels.add(table.logPanel);
	// Alle Leisten liegen in einem Stapel über der Werkzeugleiste und überdecken sich nie.
	roomEl.append(
		h(
			"div",
			{ className: "dock" },
			tokens.bar,
			fog.selectBar,
			fog.drawBar,
			table.drawBar,
			table.measureBar,
			h("div", { className: "tools" }, groups.toolbar, groups.subtools),
		),
		table.measureLabel,
		table.logPanel,
		h("div", { className: "toasts" }, error.el, table.toast),
		card.el,
	);
	panel.insertBefore(fog.settingsSection, deviceRow);

	/** Antippen wählt genau ein Objekt aus – Token oder Fog-Fläche. */
	const selectTarget = (target: StageTarget | null) => {
		tokens.select(target?.kind === "token" ? target.id : null);
		fog.select(target?.kind === "fog" ? target.id : null);
		notes.select(target?.kind === "note" ? target.id : null);
	};
	const stageCallbacks: StageCallbacks = {
		canDrag: tokens.canDrag,
		drop: tokens.drop,
		select: selectTarget,
		context: selectTarget,
		...fog.callbacks,
		...table.callbacks,
		moveNote: notes.moveNote,
	};

	// --- Daten aus dem gespiegelten Raumzustand ---
	function entitiesOf(kind: Entity["kind"]): Entity[] {
		return [...conn.entities.values()].filter((e) => e.kind === kind);
	}
	function sceneList(): Entity[] {
		return entitiesOf("scene").sort(
			(a, b) => (a.data as SceneData).order - (b.data as SceneData).order,
		);
	}
	function sceneById(id: string | null): Entity | undefined {
		return id ? conn.entities.get(`scene:${id}`) : undefined;
	}
	function activeSceneId(): string | null {
		const state = conn.entities.get(`roomState:${ROOM_STATE_ID}`);
		return state ? (state.data as RoomStateData).activeSceneId : null;
	}
	function displayedScene(): Entity | undefined {
		return sceneById(viewedSceneId) ?? sceneById(activeSceneId());
	}

	// --- GM: Szenen ---
	const scenes = h("ul");
	const sceneName = h("input", { type: "text", placeholder: "Neue Szene" });
	const sceneHidden = h("input", { type: "checkbox" });
	const sceneForm = h(
		"form",
		{},
		sceneName,
		h("label", {}, sceneHidden, "Nur GM"),
		h("button", { type: "submit" }, "Anlegen"),
	);
	sceneForm.addEventListener("submit", (e) => {
		e.preventDefault();
		const name = sceneName.value.trim();
		if (!name) return;
		sceneName.value = "";
		const order =
			Math.max(-1, ...sceneList().map((s) => (s.data as SceneData).order)) + 1;
		run({
			op: "create",
			kind: "scene",
			id: crypto.randomUUID(),
			data: { name, order },
			audience: sceneHidden.checked ? { type: "gm" } : { type: "all" },
		});
	});

	function sceneItem(scene: Entity, active: boolean, viewed: boolean) {
		const data = scene.data as SceneData;
		const hidden = scene.audience?.type === "gm";
		const name = h(
			"span",
			{ className: "name" },
			data.name,
			active ? h("span", { className: "badge" }, "aktiv") : "",
			hidden ? h("span", { className: "badge muted" }, "nur GM") : "",
			viewed && !active
				? h("span", { className: "badge muted" }, "angesehen")
				: "",
		);
		const view = button(
			"Ansehen",
			() => {
				viewedSceneId = scene.id;
				render();
			},
			"secondary",
		);
		const renameButton = button("Umbenennen", () => rename(scene), "secondary");
		if (active) return h("li", {}, name, viewed ? "" : view, renameButton);
		return h(
			"li",
			{},
			name,
			button("Aktivieren", async () => {
				// Die aktive Szene sehen alle: verdeckte Szene vorher aufdecken.
				if (hidden) {
					await run({
						op: "update",
						kind: "scene",
						id: scene.id,
						audience: { type: "all" },
					});
				}
				const ok = await run({
					op: "update",
					kind: "roomState",
					id: ROOM_STATE_ID,
					patch: { activeSceneId: scene.id },
				});
				if (ok !== undefined) {
					viewedSceneId = null;
					render();
				}
			}),
			viewed ? "" : view,
			button(
				hidden ? "Aufdecken" : "Verbergen",
				() =>
					run({
						op: "update",
						kind: "scene",
						id: scene.id,
						audience: { type: hidden ? "all" : "gm" },
					}),
				"secondary",
			),
			renameButton,
			button(
				"Löschen",
				async () => {
					if (
						await confirmDialog(
							t("scene.deleteConfirm", { name: data.name }),
							t("scene.delete"),
						)
					) {
						run({ op: "delete", kind: "scene", id: scene.id });
					}
				},
				"secondary",
			),
		);
	}

	async function rename(scene: Entity): Promise<void> {
		const name = (
			await promptDialog(
				t("scene.renamePrompt"),
				(scene.data as SceneData).name,
			)
		)?.trim();
		if (name)
			run({ op: "update", kind: "scene", id: scene.id, patch: { name } });
	}

	// --- GM: Karte der angesehenen Szene ---
	const mapName = h("span", { className: "name" });
	const mapFile = h("input", {
		type: "file",
		accept: "image/png,image/jpeg,image/webp",
		hidden: true,
	});
	const uploadButton = button("Karte hochladen …", () => mapFile.click());
	const assetSelect = h("select");
	const mapStatus = h("p", { className: "hint", hidden: true });
	let assetList: AssetMeta[] = [];

	async function refreshAssets(): Promise<void> {
		if (!gmToken) return;
		try {
			assetList = (await api.assets(gmToken)).filter(
				(a) => a.purpose !== "token",
			);
			renderAssetSelect();
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) leaveAsGm();
		}
	}

	function renderAssetSelect(): void {
		const current = (displayedScene()?.data as SceneData | undefined)?.map;
		assetSelect.replaceChildren(
			h("option", { value: "", textContent: "– vorhandene Karte wählen –" }),
			...assetList.map((a) =>
				h("option", {
					value: a.id,
					textContent: `${a.name} (${a.width}×${a.height})`,
					selected: a.id === current,
				}),
			),
		);
	}

	function setMap(assetId: string | null): void {
		const scene = displayedScene();
		if (scene) {
			run({
				op: "update",
				kind: "scene",
				id: scene.id,
				patch: { map: assetId },
			});
		}
	}

	mapFile.addEventListener("change", async () => {
		const file = mapFile.files?.[0];
		mapFile.value = "";
		if (!file || !gmToken) return;
		const sceneId = displayedScene()?.id;
		uploadButton.disabled = true;
		mapStatus.hidden = false;
		mapStatus.textContent = `„${file.name}“ wird hochgeladen und verarbeitet …`;
		try {
			const meta = await api.uploadAsset(gmToken, file);
			mapStatus.textContent = `Fertig: ${meta.width}×${meta.height} Pixel, ${meta.levels} Stufen.`;
			await refreshAssets();
			if (sceneId) {
				run({
					op: "update",
					kind: "scene",
					id: sceneId,
					patch: { map: meta.id },
				});
			}
		} catch (err) {
			mapStatus.textContent = errorText(err);
		} finally {
			uploadButton.disabled = false;
		}
	});
	assetSelect.addEventListener("change", () => {
		if (assetSelect.value) setMap(assetSelect.value);
	});
	const removeMap = button("Karte entfernen", () => setMap(null), "secondary");

	// --- GM: Grid der angesehenen Szene ---
	const gridType = h("select");
	for (const [value, label] of gridTypes) {
		gridType.append(h("option", { value, textContent: label }));
	}
	const gridVisible = h("input", { type: "checkbox" });
	const numberField = (step: number) =>
		h("input", { type: "number", step: String(step), className: "num" });
	const gridSize = numberField(1);
	const gridOffsetX = numberField(1);
	const gridOffsetY = numberField(1);

	function stepper(input: HTMLInputElement, delta: number): HTMLElement {
		const minus = button("−", () => nudge(input, -delta), "secondary");
		const plus = button("+", () => nudge(input, delta), "secondary");
		return h("span", { className: "stepper" }, minus, input, plus);
	}
	function nudge(input: HTMLInputElement, delta: number): void {
		input.value = String(round(Number(input.value) + delta));
		changeGrid();
	}
	function round(n: number): number {
		return Math.round(n * 100) / 100;
	}

	function currentGrid(): GridData | null {
		const scene = displayedScene();
		if (!scene) return null;
		if (gridDraft?.sceneId === scene.id) return gridDraft.grid;
		return (scene.data as Partial<SceneData>).grid ?? DEFAULT_GRID;
	}

	function changeGrid(): void {
		const scene = displayedScene();
		const grid = currentGrid();
		if (!scene || !grid) return;
		const size = Number(gridSize.value);
		const next: GridData = {
			type: gridType.value as GridData["type"],
			size: Number.isFinite(size)
				? Math.min(2000, Math.max(8, size))
				: grid.size,
			offsetX: clampOffset(gridOffsetX.value, grid.offsetX),
			offsetY: clampOffset(gridOffsetY.value, grid.offsetY),
			visible: gridVisible.checked,
		};
		gridDraft = { sceneId: scene.id, grid: next };
		updateStage();
		clearTimeout(gridTimer);
		gridTimer = setTimeout(async () => {
			const draft = gridDraft;
			if (!draft) return;
			await run({
				op: "update",
				kind: "scene",
				id: draft.sceneId,
				patch: { grid: draft.grid },
			});
			if (gridDraft === draft) {
				gridDraft = null;
				render();
			}
		}, GRID_SEND_DELAY_MS);
	}
	function clampOffset(value: string, fallback: number): number {
		const n = Number(value);
		return Number.isFinite(n) ? Math.min(4000, Math.max(-4000, n)) : fallback;
	}
	for (const input of [
		gridType,
		gridVisible,
		gridSize,
		gridOffsetX,
		gridOffsetY,
	]) {
		input.addEventListener("input", changeGrid);
	}

	/** Felder nur setzen, wenn die GM nicht gerade darin tippt. */
	function syncGridInputs(): void {
		const grid = currentGrid();
		if (!grid) return;
		const set = (
			input: HTMLInputElement | HTMLSelectElement,
			value: string,
		) => {
			if (document.activeElement !== input) input.value = value;
		};
		set(gridType, grid.type);
		set(gridSize, String(grid.size));
		set(gridOffsetX, String(grid.offsetX));
		set(gridOffsetY, String(grid.offsetY));
		gridVisible.checked = grid.visible;
	}

	// --- GM: Spieler-Link ---
	const linkInput = h("input", { type: "text", readOnly: true });
	const linkBox = h(
		"div",
		{ className: "link-box" },
		linkInput,
		button("Kopieren", async () => {
			linkInput.select();
			await navigator.clipboard?.writeText(linkInput.value).catch(() => {});
		}),
		button(
			"Neu erzeugen",
			async () => {
				if (!gmToken) return;
				if (
					!(await confirmDialog(
						t("link.regenerateConfirm"),
						t("link.regenerate"),
					))
				)
					return;
				try {
					const res = await api.regenerateLink(gmToken, roomId);
					linkInput.value = playerLink(res.playerLinkToken);
				} catch (err) {
					error.show(errorText(err));
				}
			},
			"secondary",
		),
	);

	const settingsTitle = h("h2");
	if (isGm && gmToken) {
		scenePanel.append(
			scenes,
			sceneForm,
			settingsTitle,
			h("p", {}, mapName),
			h("div", { className: "row" }, uploadButton, removeMap),
			mapFile,
			assetSelect,
			mapStatus,
			h("h3", {}, "Grid"),
			h(
				"div",
				{ className: "grid-form" },
				h("label", {}, "Art ", gridType),
				h("label", {}, gridVisible, "Grid anzeigen"),
				h("label", {}, "Größe (px) ", stepper(gridSize, 1)),
				h("label", {}, "Versatz X ", stepper(gridOffsetX, 1)),
				h("label", {}, "Versatz Y ", stepper(gridOffsetY, 1)),
			),
			h(
				"p",
				{ className: "hint" },
				"Größe und Versatz in Kartenpixeln. Die Karte bleibt fest, das Grid wird an sie angepasst.",
			),
			table.gmMeasureSection,
		);
		// Der Panel-Kopf trägt den Titel schon.
		tokens.gmSection.querySelector("h2")?.remove();
		tokenPanel.append(tokens.gmSection);
		gmPanel.append(
			fog.gmSection,
			notes.gmSection,
			handouts.gmSection,
			h("h2", {}, "Spieler-Link"),
			linkBox,
			h(
				"p",
				{ className: "hint" },
				"Diesen Link an die Spieler schicken. Sie treten mit ihrem Namen bei, ohne Account.",
			),
		);
		api
			.rooms(gmToken)
			.then((rooms) => {
				const room = rooms.find((r) => r.id === roomId);
				if (room) linkInput.value = playerLink(room.playerLinkToken);
			})
			.catch((err: unknown) => {
				if (err instanceof ApiError && err.status === 401) leaveAsGm();
			});
		void refreshAssets();
	}

	function leaveAsGm(): void {
		cleanup();
		storage.setGmToken(null);
		navigate("/", true);
	}

	// --- Spielfläche ---
	import("../render/stage.ts")
		.then(({ createStage }) => createStage(stageHost, stageCallbacks))
		.then((s) => {
			if (disposed) {
				s.destroy();
				return;
			}
			stage = s;
			s.setTool(fog.stageTool());
			s.setAnimateFog(fog.animate());
			updateStage();
		})
		.catch((err: unknown) => {
			stageMessage.hidden = false;
			stageMessage.textContent = `Spielfläche nicht verfügbar: ${String(err)}`;
		});

	function updateStage(): void {
		if (!stage) return;
		stage.setTokens(tokens.stageTokens());
		stage.setFog(fog.stageFog(), isGm);
		stage.setDrawings(table.stageDrawings());
		stage.setNotes(notes.stageNotes());
		const scene = displayedScene();
		const request = ++stageRequest;
		if (!scene) {
			stage.setScene(null);
			return;
		}
		const data = scene.data as SceneData;
		const grid = currentGrid() ?? DEFAULT_GRID;
		const measure = table.currentMeasure();
		if (!data.map) {
			stage.setScene({ id: scene.id, map: null, grid, measure });
			return;
		}
		assetMeta(data.map)
			.then((meta) => {
				if (request === stageRequest) {
					stage?.setScene({ id: scene.id, map: meta, grid, measure });
				}
			})
			.catch(() => {
				if (request !== stageRequest) return;
				stage?.setScene({ id: scene.id, map: null, grid, measure });
				error.show("Kartenbild nicht gefunden.");
			});
	}

	// --- Darstellung ---
	function render(): void {
		if (disposed) return;
		statusDot.dataset.status = conn.status;
		const playerCount = entitiesOf("player").length;
		statusText.textContent =
			isGm && conn.status === "online"
				? `${statusLabel.online} · ${t("status.players", { count: playerCount })}`
				: statusLabel[conn.status];
		title.textContent = conn.roomName ?? "Mistwarden";
		document.title = conn.roomName
			? `${conn.roomName} – Mistwarden`
			: "Mistwarden";

		const id = conn.identity;
		const me =
			id?.role === "player"
				? (conn.entities.get(`player:${id.playerId}`)?.data as
						| PlayerData
						| undefined)
				: undefined;
		roleText.textContent = id
			? id.role === "gm"
				? "Du bist die Spielleitung."
				: `Du spielst als ${me?.name ?? "…"}.`
			: "";

		if (viewedSceneId && !sceneById(viewedSceneId)) viewedSceneId = null;
		const activeId = activeSceneId();
		const shown = displayedScene();
		const shownName = shown ? (shown.data as SceneData).name : "–";
		const previewing = shown !== undefined && shown.id !== activeId;
		sceneText.textContent = previewing
			? `Vorschau: ${shownName} (Spieler sehen eine andere Szene)`
			: `Szene: ${shownName}`;
		sceneText.classList.toggle("preview", previewing);
		backToActive.hidden = !previewing;

		const playerItems = entitiesOf("player").map((p) => {
			const data = p.data as PlayerData;
			const swatch = h("span", { className: "swatch" });
			swatch.style.background = data.color;
			return h("li", {}, swatch, h("span", { className: "name" }, data.name));
		});
		players.replaceChildren(
			...(playerItems.length
				? playerItems
				: [h("li", { className: "hint" }, "Noch niemand beigetreten.")]),
		);

		if (isGm) {
			scenes.replaceChildren(
				...sceneList().map((s) =>
					sceneItem(s, s.id === activeId, s.id === shown?.id),
				),
			);
			settingsTitle.textContent = `Karte – ${shownName}`;
			const mapId = (shown?.data as SceneData | undefined)?.map ?? null;
			const asset = assetList.find((a) => a.id === mapId);
			mapName.textContent = mapId
				? (asset?.name ?? "Karte gesetzt")
				: "Keine Karte – nur Grid.";
			removeMap.hidden = !mapId;
			renderAssetSelect();
			syncGridInputs();
		}

		tokens.render();
		fog.render();
		table.render();
		notes.render();
		handouts.render();
		renderHistory();
		updateStage();

		if (conn.status === "unauthorized") {
			if (isGm) leaveAsGm();
			else {
				storage.setPlayerToken(roomId, null);
				cleanup();
				root.replaceChildren(
					h("h1", {}, "Mistwarden"),
					h(
						"p",
						{},
						"Deine Sitzung ist nicht mehr gültig. Bitte über den Spieler-Link neu beitreten.",
					),
				);
			}
		}
	}

	conn.subscribe(render);
	conn.start();
	render();

	// Safari beendet Verbindungen bei Displaysperre und im Hintergrund.
	const wake = () => {
		if (document.visibilityState === "visible") conn.wake();
	};
	const online = () => conn.wake();
	document.addEventListener("visibilitychange", wake);
	window.addEventListener("pageshow", wake);
	window.addEventListener("online", online);

	function cleanup(): void {
		if (disposed) return;
		disposed = true;
		clearTimeout(gridTimer);
		hudSize.disconnect();
		fog.destroy();
		card.destroy();
		window.removeEventListener("keydown", historyKeys);
		conn.stop();
		stage?.destroy();
		stage = null;
		root.classList.remove("room-mode");
		document.removeEventListener("visibilitychange", wake);
		window.removeEventListener("pageshow", wake);
		window.removeEventListener("online", online);
	}
	return cleanup;
}
