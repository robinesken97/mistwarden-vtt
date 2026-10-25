// Handouts: die GM erstellt Text und/oder Bild und zeigt es allen oder einzelnen Spielern.
// Empfänger sehen es sofort (auch nach einem Reconnect) und finden es später unter „Handouts“.
import type {
	Action,
	AssetMeta,
	Audience,
	Entity,
	HandoutData,
	PlayerData,
} from "@mistwarden/protocol";
import { api, assetMeta, errorText } from "../api.ts";
import { button, h } from "../dom.ts";
import type { SyncConnection } from "../net/connection.ts";
import { tilesInView } from "../render/tiles.ts";
import type { Card } from "./card.ts";

export interface HandoutToolsContext {
	conn: SyncConnection;
	roomId: string;
	gmToken: string | null;
	run(action: Action): Promise<number | undefined>;
	card: Card;
}

/** Höchstens so viele Kacheln lädt die Bildansicht (2 × 2 = bis 2048 px Kante). */
const MAX_VIEW_TILES = 4;

export function createHandoutTools(ctx: HandoutToolsContext) {
	const isGm = ctx.gmToken !== null;
	const seenKey = `mistwarden.handoutsSeen.${ctx.roomId}`;
	const seen = readSeen(seenKey);
	let listKey = "";

	function handouts(): Entity[] {
		return [...ctx.conn.entities.values()]
			.filter((e) => e.kind === "handout")
			.sort(
				(a, b) =>
					((b.data as HandoutData).shownAt ?? 0) -
						((a.data as HandoutData).shownAt ?? 0) || b.version - a.version,
			);
	}

	function players(): Entity[] {
		return [...ctx.conn.entities.values()].filter((e) => e.kind === "player");
	}

	function recipients(audience: Audience | undefined): string {
		switch (audience?.type) {
			case "all":
				return "alle";
			case "players": {
				const names = audience.playerIds.map(
					(id) =>
						(
							ctx.conn.entities.get(`player:${id}`)?.data as
								| PlayerData
								| undefined
						)?.name ?? "?",
				);
				return names.join(", ") || "niemand";
			}
			default:
				return "Entwurf (nur du)";
		}
	}

	// --- Ansicht für alle ---
	function view(e: Entity): void {
		const d = e.data as HandoutData;
		const image = h("div", { className: "handout-image" });
		if (d.assetId) {
			assetMeta(d.assetId)
				.then((meta) => image.replaceWith(imageView(meta)))
				.catch(() => {
					image.textContent = "Bild nicht gefunden.";
				});
		}
		ctx.card.show(
			`handout:${e.id}`,
			h("h2", {}, d.title),
			...(d.assetId ? [image] : []),
			...(d.text.trim() ? [h("p", { className: "card-text" }, d.text)] : []),
			...(isGm
				? [
						h(
							"p",
							{ className: "hint" },
							`Empfänger: ${recipients(e.audience)}`,
						),
						button("Bearbeiten", () => edit(e.id)),
					]
				: []),
		);
		markSeen(e);
	}

	function list(): void {
		const items = handouts().map((e) =>
			h(
				"li",
				{},
				button((e.data as HandoutData).title, () => view(e), "secondary"),
			),
		);
		ctx.card.show(
			"handouts",
			h("h2", {}, "Handouts"),
			items.length
				? h("ul", { className: "handout-list" }, ...items)
				: h("p", { className: "hint" }, "Noch keine Handouts."),
		);
	}

	function markSeen(e: Entity): void {
		const shownAt = (e.data as HandoutData).shownAt ?? 0;
		if ((seen[e.id] ?? 0) >= shownAt) return;
		seen[e.id] = shownAt;
		writeSeen(seenKey, seen);
	}

	// --- GM: bearbeiten ---
	function edit(id: string | null): void {
		const e = id ? ctx.conn.entities.get(`handout:${id}`) : undefined;
		const d = e?.data as HandoutData | undefined;
		const handoutId = e?.id ?? crypto.randomUUID();
		let assetId = d?.assetId ?? null;

		const title = h("input", {
			type: "text",
			value: d?.title ?? "",
			maxLength: 100,
			placeholder: "Titel",
		});
		const text = h("textarea", {
			value: d?.text ?? "",
			maxLength: 10_000,
			rows: 6,
			placeholder: "Text (optional, wenn ein Bild gesetzt ist)",
		});
		const imageStatus = h("span", { className: "hint" });
		const file = h("input", { type: "file", accept: "image/*", hidden: true });
		const upload = button("Bild hochladen", () => file.click(), "secondary");
		const removeImage = button(
			"Bild entfernen",
			() => {
				assetId = null;
				showImage();
			},
			"secondary",
		);
		function showImage(): void {
			imageStatus.textContent = assetId ? "Bild gesetzt." : "Kein Bild.";
			removeImage.hidden = !assetId;
		}
		showImage();
		file.addEventListener("change", async () => {
			const f = file.files?.[0];
			file.value = "";
			if (!f || !ctx.gmToken) return;
			upload.disabled = true;
			imageStatus.textContent = `„${f.name}“ wird hochgeladen …`;
			try {
				const meta = await api.uploadAsset(ctx.gmToken, f, "map");
				assetId = meta.id;
				showImage();
			} catch (err) {
				imageStatus.textContent = errorText(err);
			} finally {
				upload.disabled = false;
			}
		});

		// Empfänger: Entwurf, alle oder ausgewählte Spieler.
		const audience = e?.audience ?? { type: "gm" };
		const mode = h("select");
		for (const [value, label] of [
			["gm", "Entwurf (nur ich)"],
			["all", "Alle Spieler"],
			["players", "Ausgewählte Spieler"],
		]) {
			mode.append(h("option", { value, textContent: label }));
		}
		mode.value = audience.type;
		const picks = players().map((p) => {
			const box = h("input", {
				type: "checkbox",
				checked:
					audience.type === "players" && audience.playerIds.includes(p.id),
			});
			box.value = p.id;
			return {
				box,
				label: h("label", {}, box, ` ${(p.data as PlayerData).name}`),
			};
		});
		const pickList = h(
			"div",
			{ className: "handout-picks" },
			...picks.map((p) => p.label),
		);
		const syncPicks = () => {
			pickList.hidden = mode.value !== "players";
		};
		mode.addEventListener("change", syncPicks);
		syncPicks();
		const error = h("p", { className: "error", hidden: true });

		function chosenAudience(): Audience {
			if (mode.value === "all") return { type: "all" };
			if (mode.value === "players") {
				return {
					type: "players",
					playerIds: picks.filter((p) => p.box.checked).map((p) => p.box.value),
				};
			}
			return { type: "gm" };
		}

		async function save(show: boolean): Promise<void> {
			const data: HandoutData = {
				title: title.value.trim().slice(0, 100),
				text: text.value.slice(0, 10_000),
				assetId,
				shownAt: show ? Date.now() : (d?.shownAt ?? null),
			};
			if (!data.title) {
				error.hidden = false;
				error.textContent = "Bitte einen Titel angeben.";
				return;
			}
			if (!data.text.trim() && !data.assetId) {
				error.hidden = false;
				error.textContent = "Text oder Bild angeben.";
				return;
			}
			const target = chosenAudience();
			if (show && target.type === "gm") {
				error.hidden = false;
				error.textContent = "Zum Zeigen Empfänger wählen.";
				return;
			}
			const ok = await ctx.run(
				e
					? {
							op: "update",
							kind: "handout",
							id: handoutId,
							patch: data,
							audience: target,
						}
					: {
							op: "create",
							kind: "handout",
							id: handoutId,
							data,
							audience: target,
						},
			);
			if (ok !== undefined) ctx.card.hide();
		}

		ctx.card.show(
			`handout-edit:${handoutId}`,
			h("h2", {}, e ? "Handout bearbeiten" : "Neues Handout"),
			title,
			text,
			h("div", { className: "row" }, upload, removeImage, imageStatus),
			file,
			h("label", {}, "Empfänger ", mode),
			pickList,
			error,
			h(
				"div",
				{ className: "row" },
				button("Zeigen", () => void save(true)),
				button("Speichern", () => void save(false), "secondary"),
				...(e
					? [
							button(
								"Löschen",
								() => {
									if (!confirm("Handout löschen?")) return;
									ctx.run({ op: "delete", kind: "handout", id: handoutId });
									ctx.card.hide();
								},
								"secondary",
							),
						]
					: []),
			),
		);
		title.focus();
	}

	// --- Menü (GM) und HUD (alle) ---
	const gmList = h("ul", { className: "handout-list" });
	const gmSection = h(
		"div",
		{},
		h("h2", {}, "Handouts"),
		gmList,
		button("Neues Handout", () => edit(null)),
	);
	const hudButton = button("Handouts", () => list(), "secondary");

	function render(): void {
		const all = handouts();
		hudButton.hidden = !isGm && all.length === 0;
		const key = all
			.map((e) => `${e.id}:${e.version}:${JSON.stringify(e.audience)}`)
			.join(",");
		if (isGm && key !== listKey) {
			gmList.replaceChildren(
				...(all.length
					? all.map((e) =>
							h(
								"li",
								{},
								button(
									(e.data as HandoutData).title,
									() => view(e),
									"secondary",
								),
								h("span", { className: "hint" }, ` ${recipients(e.audience)}`),
							),
						)
					: [h("li", { className: "hint" }, "Noch keine Handouts.")]),
			);
		}
		listKey = key;

		// Empfänger: neu gezeigtes Handout öffnen (auch wenn es während einer Trennung kam).
		if (!isGm && ctx.conn.status === "online") {
			const fresh = all.find(
				(e) => ((e.data as HandoutData).shownAt ?? 0) > (seen[e.id] ?? 0),
			);
			if (fresh && ctx.card.owner() !== `handout:${fresh.id}`) {
				// Nur das neueste öffnen; ältere ungelesene stehen in der Liste.
				for (const e of all) markSeen(e);
				view(fresh);
			}
		}
		// Offenes Handout weg (gelöscht oder entzogen): Karte schließen.
		const owner = ctx.card.owner();
		if (
			owner?.startsWith("handout:") &&
			!ctx.conn.entities.has(`handout:${owner.slice(8)}`)
		) {
			ctx.card.hide();
		}
	}

	return { gmSection, hudButton, render };
}

/** Bild aus der Kachelpyramide: feinste Stufe mit höchstens vier Kacheln. */
function imageView(meta: AssetMeta): HTMLElement {
	let level = meta.levels - 1;
	const all = { x: 0, y: 0, width: meta.width, height: meta.height };
	while (
		level > 0 &&
		tilesInView(meta, level - 1, all).length <= MAX_VIEW_TILES
	) {
		level--;
	}
	const box = h("div", { className: "handout-image" });
	box.style.aspectRatio = `${meta.width} / ${meta.height}`;
	for (const tile of tilesInView(meta, level, all)) {
		const img = h("img", { src: tile.url, alt: "", draggable: false });
		img.style.left = `${(tile.world.x / meta.width) * 100}%`;
		img.style.top = `${(tile.world.y / meta.height) * 100}%`;
		img.style.width = `${(tile.world.width / meta.width) * 100}%`;
		img.style.height = `${(tile.world.height / meta.height) * 100}%`;
		box.append(img);
	}
	return box;
}

function readSeen(key: string): Record<string, number> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, number>)
			: {};
	} catch {
		return {};
	}
}

function writeSeen(key: string, seen: Record<string, number>): void {
	try {
		localStorage.setItem(key, JSON.stringify(seen));
	} catch {
		// nur für diese Sitzung
	}
}
