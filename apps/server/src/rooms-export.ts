// Raum-Export und -Import. Der Import legt einen neuen Raum an und schreibt jedes Objekt
// über die normale Prüfung (Schemas, Konsistenzregeln); Bilder werden neu kodiert.
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import {
	type Action,
	type Audience,
	type EntityKind,
	isSceneChild,
	ROOM_EXPORT_FORMAT,
	ROOM_EXPORT_VERSION,
	ROOM_STATE_ID,
	type RoomExport,
	type RoomSummary,
} from "@mistwarden/protocol";
import type { AssetStore } from "./assets/store.ts";
import type { Db } from "./db/connection.ts";
import { type ApplySystemAction, createRoom, getRoom } from "./rooms.ts";
import type { StoredEntity } from "./sync/visibility.ts";

/** Reihenfolge beim Import: Szenen vor Raumzustand vor allem, was auf Szenen verweist. */
const IMPORT_ORDER: EntityKind[] = [
	"scene",
	"roomState",
	"token",
	"fog",
	"drawing",
	"note",
	"handout",
];

export class ImportError extends Error {}

export async function exportRoom(
	db: Db,
	assets: AssetStore,
	entities: (roomId: string) => StoredEntity[],
	roomId: string,
): Promise<RoomExport | undefined> {
	const room = getRoom(db, roomId);
	if (!room) return undefined;
	const list = entities(roomId).filter((e) => IMPORT_ORDER.includes(e.kind));
	const assetIds = new Set<string>();
	for (const e of list) {
		const ref = assetRef(e.kind, e.data);
		if (ref) assetIds.add(ref);
	}
	const files: RoomExport["assets"] = [];
	for (const id of assetIds) {
		const meta = assets.get(id);
		const path = assets.originalPath(id);
		if (!meta || !path) continue;
		const data = await readFile(path).catch(() => null);
		if (!data) continue;
		files.push({
			id,
			name: meta.name,
			purpose: meta.purpose,
			data: data.toString("base64"),
		});
	}
	return {
		format: ROOM_EXPORT_FORMAT,
		version: ROOM_EXPORT_VERSION,
		exportedAt: Date.now(),
		room: { name: room.name },
		entities: list.map((e) => ({
			kind: e.kind,
			id: e.id,
			data: e.data,
			audience: e.audience,
		})),
		assets: files,
	};
}

/**
 * Legt aus einem Export einen neuen Raum an. Spieler gibt es dort noch nicht: Besitz von
 * Tokens und Zeichnungen geht an die GM, Szenen und Handouts für einzelne Spieler werden
 * verdeckt, gezeigte Handouts gelten als nicht gezeigt.
 */
export async function importRoom(
	db: Db,
	assets: AssetStore,
	apply: ApplySystemAction,
	file: RoomExport,
): Promise<RoomSummary> {
	// Bilder zuerst (asynchron); vorhandene mit gleicher ID werden wiederverwendet.
	const assetIds = new Map<string, string>();
	for (const a of file.assets) {
		if (assets.get(a.id)) {
			assetIds.set(a.id, a.id);
			continue;
		}
		const meta = await assets.ingest(
			Readable.from([Buffer.from(a.data, "base64")]),
			a.name,
			a.purpose,
		);
		assetIds.set(a.id, meta.id);
	}
	const mapAsset = (id: unknown) =>
		typeof id === "string"
			? (assetIds.get(id) ?? (assets.get(id) ? id : null))
			: null;

	const actions: Action[] = [];
	const scenes = new Map<string, Audience>();
	const sorted = file.entities
		.filter((e) => IMPORT_ORDER.includes(e.kind))
		.sort(
			(a, b) => IMPORT_ORDER.indexOf(a.kind) - IMPORT_ORDER.indexOf(b.kind),
		);
	for (const e of sorted) {
		const data = { ...e.data };
		let audience: Audience | undefined = onlyAllOrGm(e.audience);
		switch (e.kind) {
			case "scene":
				data.map = mapAsset(data.map);
				scenes.set(e.id, audience);
				break;
			case "roomState": {
				const active = data.activeSceneId;
				if (typeof active !== "string" || scenes.get(active)?.type !== "all") {
					data.activeSceneId = null;
				}
				audience = { type: "all" };
				break;
			}
			case "token": {
				const asset = mapAsset(data.assetId);
				if (!asset) continue;
				data.assetId = asset;
				data.ownerId = null;
				break;
			}
			case "drawing":
				data.ownerId = null;
				break;
			case "handout":
				data.assetId = mapAsset(data.assetId);
				data.shownAt = null;
				break;
		}
		if (isSceneChild(e.kind)) {
			if (!scenes.has(data.sceneId as string)) continue;
			audience = undefined;
		}
		actions.push({
			op: "create",
			kind: e.kind,
			id: e.id,
			data,
			...(audience ? { audience } : {}),
		});
	}

	return db.transaction(() => {
		const room = createRoom(db, apply, `${file.room.name}`.slice(0, 100), {
			empty: true,
		});
		const hasState = actions.some((a) => a.kind === "roomState");
		for (const action of actions) {
			try {
				apply(room.id, action);
			} catch {
				throw new ImportError(`${action.kind}:${action.id}`);
			}
		}
		if (!hasState) {
			apply(room.id, {
				op: "create",
				kind: "roomState",
				id: ROOM_STATE_ID,
				data: { activeSceneId: null },
			});
		}
		return room;
	})();
}

function assetRef(
	kind: EntityKind,
	data: Record<string, unknown>,
): string | null {
	const ref =
		kind === "scene"
			? data.map
			: kind === "token" || kind === "handout"
				? data.assetId
				: null;
	return typeof ref === "string" ? ref : null;
}

/** Spieler-Listen gelten im neuen Raum nicht: verdeckt statt falsch zugeordnet. */
function onlyAllOrGm(audience: Audience): Audience {
	return audience.type === "all" ? audience : { type: "gm" };
}
