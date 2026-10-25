// Token-Werkzeuge der Raumansicht: Auswahlleiste, Einrasten, Props-Sperre, GM-Bereich
// zum Anlegen sowie die Aufbereitung der Tokens für die Spielfläche.
import {
	type Action,
	type AssetMeta,
	type Entity,
	type GridData,
	type PlayerData,
	snapToGrid,
	type TokenData,
	tileUrl,
} from "@mistwarden/protocol";
import { api, assetMeta, errorText } from "../api.ts";
import { button, h } from "../dom.ts";
import type { SyncConnection } from "../net/connection.ts";
import type { StageToken, WorldPoint } from "../render/stage.ts";

export interface TokenToolsContext {
	conn: SyncConnection;
	gmToken: string | null;
	run(action: Action): Promise<number | undefined>;
	displayedScene(): Entity | undefined;
	currentGrid(): GridData | null;
	viewCenter(): { x: number; y: number } | null;
	/** Tokens oder ihre Darstellung haben sich geändert. */
	changed(): void;
}

const SIZES = [0.5, 1, 2, 3, 4];

export function createTokenTools(ctx: TokenToolsContext) {
	const isGm = ctx.gmToken !== null;
	let selectedId: string | null = null;
	let snapping = true;
	let propsLocked = true;
	/** Eigene Änderungen, die der Server noch nicht bestätigt hat (sofort sichtbar). */
	const pending = new Map<
		string,
		Partial<Pick<TokenData, "x" | "y" | "rotation">>
	>();
	const metas = new Map<string, AssetMeta | null>();
	let tokenAssets: AssetMeta[] = [];

	// --- Daten ---
	function myPlayerId(): string | null {
		const id = ctx.conn.identity;
		return id?.role === "player" ? id.playerId : null;
	}

	function sceneTokens(): Entity[] {
		const scene = ctx.displayedScene();
		if (!scene) return [];
		return [...ctx.conn.entities.values()]
			.filter(
				(e) => e.kind === "token" && (e.data as TokenData).sceneId === scene.id,
			)
			.sort((a, b) => a.version - b.version);
	}

	function tokenData(e: Entity): TokenData {
		return { ...(e.data as TokenData), ...pending.get(e.id) };
	}

	function canMove(e: Entity): boolean {
		const t = e.data as TokenData;
		if (isGm) return t.layer === "tokens" || !propsLocked;
		return (
			t.layer === "tokens" && t.ownerId !== null && t.ownerId === myPlayerId()
		);
	}

	function byId(id: string | null): Entity | undefined {
		return id ? ctx.conn.entities.get(`token:${id}`) : undefined;
	}

	function meta(assetId: string): AssetMeta | null {
		if (!metas.has(assetId)) {
			metas.set(assetId, null);
			assetMeta(assetId)
				.then((m) => {
					metas.set(assetId, m);
					ctx.changed();
				})
				.catch(() => {});
		}
		return metas.get(assetId) ?? null;
	}

	/** Tokens der angezeigten Szene, aufbereitet für die Spielfläche. */
	function stageTokens(): StageToken[] {
		const grid = ctx.currentGrid();
		if (!grid) return [];
		const players = new Map(
			[...ctx.conn.entities.values()]
				.filter((e) => e.kind === "player")
				.map((e) => [e.id, (e.data as PlayerData).color]),
		);
		return sceneTokens().map((e) => {
			const t = tokenData(e);
			const m = meta(t.assetId);
			return {
				id: e.id,
				x: t.x,
				y: t.y,
				sizePx: t.size * grid.size,
				rotation: t.rotation,
				layer: t.layer,
				textureUrl: m ? tileUrl(m.id, m.levels - 1, 0, 0) : null,
				color: t.ownerId ? (players.get(t.ownerId) ?? null) : null,
				selected: e.id === selectedId,
				hidden: t.hidden === true,
				hittable: canMove(e),
			};
		});
	}

	// --- Aktionen ---
	function update(
		id: string,
		patch: Partial<TokenData>,
		optimistic = true,
	): void {
		if (optimistic) {
			const local: Partial<Pick<TokenData, "x" | "y" | "rotation">> = {};
			if (patch.x !== undefined) local.x = patch.x;
			if (patch.y !== undefined) local.y = patch.y;
			if (patch.rotation !== undefined) local.rotation = patch.rotation;
			pending.set(id, { ...pending.get(id), ...local });
			ctx.changed();
		}
		ctx.run({ op: "update", kind: "token", id, patch }).finally(() => {
			// Bestätigt: Stand kam vom Server. Abgelehnt: Token springt zurück.
			pending.delete(id);
			ctx.changed();
		});
	}

	function select(id: string | null): void {
		const e = byId(id);
		selectedId = e && canMove(e) ? e.id : null;
		ctx.changed();
	}

	function canDrag(id: string): boolean {
		const e = byId(id);
		return e !== undefined && canMove(e);
	}

	function drop(id: string, world: WorldPoint, free: boolean): void {
		const e = byId(id);
		const grid = ctx.currentGrid();
		if (!e || !grid) return;
		const t = tokenData(e);
		const pos = snapping && !free ? snapToGrid(grid, world, t.size) : world;
		selectedId = id;
		update(id, { x: round(pos.x), y: round(pos.y) });
	}

	function rotate(delta: number): void {
		const e = byId(selectedId);
		if (!e) return;
		const rotation = (((tokenData(e).rotation + delta) % 360) + 360) % 360;
		update(e.id, { rotation });
	}

	async function place(
		asset: AssetMeta,
		layer: TokenData["layer"],
	): Promise<void> {
		const scene = ctx.displayedScene();
		const grid = ctx.currentGrid();
		const center = ctx.viewCenter();
		if (!scene || !grid || !center) return;
		const pos = snapToGrid(grid, center, 1);
		const id = crypto.randomUUID();
		const ok = await ctx.run({
			op: "create",
			kind: "token",
			id,
			data: {
				sceneId: scene.id,
				assetId: asset.id,
				x: round(pos.x),
				y: round(pos.y),
				size: 1,
				rotation: 0,
				ownerId: null,
				layer,
				name: asset.name.slice(0, 40),
			},
		});
		if (ok !== undefined) select(id);
	}

	// --- HUD: Einrasten ---
	const snapButton = button(
		"Einrasten: an",
		() => {
			snapping = !snapping;
			snapButton.textContent = `Einrasten: ${snapping ? "an" : "aus"}`;
		},
		"secondary",
	);
	snapButton.title = "Am Laptop: Alt-Taste beim Loslassen setzt frei.";

	// --- Auswahlleiste ---
	const barName = h("strong", { className: "bar-name" });
	const sizeSelect = h("select");
	for (const s of SIZES) {
		sizeSelect.append(
			h("option", {
				value: String(s),
				textContent: `${s} Feld${s === 1 ? "" : "er"}`,
			}),
		);
	}
	sizeSelect.addEventListener("change", () => {
		const e = byId(selectedId);
		const grid = ctx.currentGrid();
		if (!e || !grid) return;
		const size = Number(sizeSelect.value);
		// Neue Größe neu einrasten: gerade Größen gehören auf den Kreuzungspunkt.
		const t = tokenData(e);
		const pos = snapping ? snapToGrid(grid, t, size) : t;
		update(e.id, { size, x: round(pos.x), y: round(pos.y) }, false);
	});
	const ownerSelect = h("select");
	ownerSelect.addEventListener("change", () => {
		if (selectedId)
			update(selectedId, { ownerId: ownerSelect.value || null }, false);
	});
	const layerButton = button(
		"",
		() => {
			const e = byId(selectedId);
			if (!e) return;
			const layer = tokenData(e).layer === "props" ? "tokens" : "props";
			update(e.id, { layer }, false);
		},
		"secondary",
	);
	// Versteckt: Spieler bekommen das Token gar nicht erst übertragen.
	const hideButton = button(
		"",
		() => {
			const e = byId(selectedId);
			if (e) update(e.id, { hidden: !tokenData(e).hidden }, false);
		},
		"secondary",
	);
	const gmControls = h(
		"span",
		{ className: "bar-group" },
		h("label", {}, "Größe ", sizeSelect),
		h("label", {}, "Besitzer ", ownerSelect),
		layerButton,
		hideButton,
		button(
			"Umbenennen",
			() => {
				const e = byId(selectedId);
				if (!e) return;
				const name = prompt("Name des Tokens", tokenData(e).name);
				if (name !== null)
					update(e.id, { name: name.trim().slice(0, 40) }, false);
			},
			"secondary",
		),
		button(
			"Löschen",
			() => {
				const e = byId(selectedId);
				if (!e || !confirm(`„${tokenData(e).name || "Token"}“ löschen?`))
					return;
				selectedId = null;
				ctx.run({ op: "delete", kind: "token", id: e.id });
				ctx.changed();
			},
			"secondary",
		),
	);
	const bar = h(
		"div",
		{ className: "selection-bar", hidden: true },
		barName,
		h(
			"span",
			{ className: "bar-group" },
			button("⟲ 45°", () => rotate(-45), "secondary"),
			button("⟲ 15°", () => rotate(-15), "secondary"),
			button("⟳ 15°", () => rotate(15), "secondary"),
			button("⟳ 45°", () => rotate(45), "secondary"),
		),
		isGm ? gmControls : "",
		button("✕", () => select(null), "secondary"),
	);

	// --- GM: Tokens anlegen ---
	const layerSelect = h("select");
	layerSelect.append(
		h("option", { value: "tokens", textContent: "als Token" }),
		h("option", { value: "props", textContent: "als Prop" }),
	);
	const tokenFile = h("input", {
		type: "file",
		accept: "image/png,image/jpeg,image/webp",
		hidden: true,
	});
	const uploadButton = button("Bild hochladen …", () => tokenFile.click());
	const assetSelect = h("select");
	const placeButton = button(
		"Platzieren",
		() => {
			const asset = tokenAssets.find((a) => a.id === assetSelect.value);
			if (asset) void place(asset, layerSelect.value as TokenData["layer"]);
		},
		"secondary",
	);
	const status = h("p", { className: "hint", hidden: true });
	const propsLock = h("input", { type: "checkbox", checked: true });
	propsLock.addEventListener("change", () => {
		propsLocked = propsLock.checked;
		const e = byId(selectedId);
		if (e && !canMove(e)) selectedId = null;
		ctx.changed();
	});

	tokenFile.addEventListener("change", async () => {
		const file = tokenFile.files?.[0];
		tokenFile.value = "";
		if (!file || !ctx.gmToken) return;
		uploadButton.disabled = true;
		status.hidden = false;
		status.textContent = `„${file.name}“ wird hochgeladen …`;
		try {
			const asset = await api.uploadAsset(ctx.gmToken, file, "token");
			status.textContent = "Token platziert – in der Mitte der Ansicht.";
			await refreshAssets();
			await place(asset, layerSelect.value as TokenData["layer"]);
		} catch (err) {
			status.textContent = errorText(err);
		} finally {
			uploadButton.disabled = false;
		}
	});

	async function refreshAssets(): Promise<void> {
		if (!ctx.gmToken) return;
		try {
			tokenAssets = (await api.assets(ctx.gmToken)).filter(
				(a) => a.purpose === "token",
			);
		} catch {
			return;
		}
		assetSelect.replaceChildren(
			...(tokenAssets.length
				? tokenAssets.map((a) =>
						h("option", { value: a.id, textContent: a.name }),
					)
				: [
						h("option", {
							value: "",
							textContent: "– noch keine Token-Bilder –",
						}),
					]),
		);
		placeButton.disabled = tokenAssets.length === 0;
	}

	const gmSection = h(
		"div",
		{},
		h("h2", {}, "Tokens"),
		h("div", { className: "row" }, layerSelect, uploadButton),
		tokenFile,
		h("div", { className: "row" }, assetSelect, placeButton),
		status,
		h(
			"label",
			{},
			propsLock,
			" Props sperren (gegen versehentliches Verschieben)",
		),
		h(
			"p",
			{ className: "hint" },
			"Neue Tokens erscheinen in der Mitte der Ansicht. Antippen wählt aus, ziehen verschiebt. Besitzer dürfen ihre Tokens selbst bewegen und drehen.",
		),
	);
	if (isGm) void refreshAssets();

	// --- Darstellung der Leiste ---
	function render(): void {
		const e = byId(selectedId);
		if (selectedId && (!e || !canMove(e) || !sceneTokens().includes(e))) {
			selectedId = null;
		}
		bar.hidden = !e || selectedId === null;
		const scene = ctx.displayedScene();
		const mine = sceneTokens().some((t) => canMove(t));
		snapButton.hidden = !scene || !mine;
		if (!e || selectedId === null) return;
		const t = tokenData(e);
		barName.textContent = t.name || (t.layer === "props" ? "Prop" : "Token");
		if (!isGm) return;
		if (document.activeElement !== sizeSelect)
			sizeSelect.value = String(t.size);
		const players = [...ctx.conn.entities.values()].filter(
			(p) => p.kind === "player",
		);
		ownerSelect.replaceChildren(
			h("option", { value: "", textContent: "niemand (GM)" }),
			...players.map((p) =>
				h("option", {
					value: p.id,
					textContent: (p.data as PlayerData).name,
					selected: p.id === t.ownerId,
				}),
			),
		);
		hideButton.textContent = t.hidden ? "Für Spieler zeigen" : "Verstecken";
		layerButton.textContent =
			t.layer === "props" ? "Zu Token machen" : "Zu Prop machen";
	}

	return {
		canDrag,
		drop,
		select,
		stageTokens,
		render,
		snapButton,
		bar,
		gmSection,
	};
}

/** Positionen auf zwei Nachkommastellen, damit keine Gleitkomma-Reste im Protokoll landen. */
function round(n: number): number {
	return Math.round(n * 100) / 100;
}
