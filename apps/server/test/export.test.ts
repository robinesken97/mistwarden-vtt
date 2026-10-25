import { randomUUID } from "node:crypto";
import type {
	Action,
	AssetMeta,
	Entity,
	RoomExport,
	RoomSummary,
} from "@mistwarden/protocol";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, RawClient, startTestRoom, type TestRoom } from "./helpers.ts";
import { act, createScene, snapshotEntities } from "./step6-helpers.ts";

let room: TestRoom;
let gm: RawClient;
let p1: RawClient;
let sceneId: string;
let assetId: string;

async function uploadImage(target: TestRoom): Promise<AssetMeta> {
	const png = await sharp({
		create: { width: 300, height: 200, channels: 3, background: "#4a6" },
	})
		.png()
		.toBuffer();
	const res = await fetch(`${target.http}/api/assets?purpose=token`, {
		method: "POST",
		headers: {
			"content-type": "image/png",
			authorization: `Bearer ${target.gm}`,
		},
		body: png,
	});
	return (await res.json()) as AssetMeta;
}

beforeEach(async () => {
	room = await startTestRoom();
	gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
	p1 = await RawClient.join(room.url, room.p1.token);
	sceneId = snapshotEntities(gm).find((e) => e.kind === "scene")?.id ?? "";
	assetId = (await uploadImage(room)).id;
});

afterEach(async () => {
	gm.close();
	p1.close();
	await room.close();
});

async function fillRoom(): Promise<void> {
	const ok = async (client: RawClient, action: Action) =>
		expect(await act(client, action)).toMatchObject({ type: "ack" });
	await ok(gm, {
		op: "create",
		kind: "token",
		id: "tok",
		data: {
			sceneId,
			assetId,
			x: 50,
			y: 50,
			size: 1,
			rotation: 0,
			ownerId: room.p1.id,
			layer: "tokens",
			name: "Held",
		},
	});
	await ok(gm, {
		op: "create",
		kind: "fog",
		id: "fog",
		data: {
			sceneId,
			polygons: [{ outer: [0, 0, 100, 0, 100, 100], holes: [] }],
			active: true,
			source: "hand",
		},
	});
	await ok(gm, {
		op: "create",
		kind: "note",
		id: "note",
		data: { sceneId, x: 1, y: 2, title: "Geheim", text: "x", hidden: true },
	});
	await ok(gm, {
		op: "create",
		kind: "handout",
		id: "hand",
		data: { title: "Brief", text: "Hallo", assetId: null, shownAt: 5 },
		audience: { type: "players", playerIds: [room.p1.id] },
	});
	const secret = await createScene(gm, {
		type: "players",
		playerIds: [room.p1.id],
	});
	await ok(gm, {
		op: "create",
		kind: "fog",
		id: "fog2",
		data: {
			sceneId: secret,
			polygons: [{ outer: [0, 0, 10, 0, 10, 10], holes: [] }],
			active: true,
			source: "hand",
		},
	});
	const me = snapshotEntities(p1).find(
		(e) => e.kind === "player" && e.id === room.p1.id,
	);
	if (!me) throw new Error("Spieler fehlt");
	await ok(p1, {
		op: "create",
		kind: "drawing",
		id: "draw",
		data: {
			sceneId,
			ownerId: room.p1.id,
			color: (me.data as { color: string }).color,
			shape: "line",
			points: [0, 0, 9, 9],
			width: 3,
		},
	});
	p1.send({
		type: "roll",
		actionId: randomUUID(),
		formula: "1d20",
		hidden: false,
	});
	await p1.nextOf(["ack", "reject"]);
}

async function exportFile(target: TestRoom = room): Promise<RoomExport> {
	const res = await api<RoomExport>(
		target.http,
		`/api/rooms/${target.roomId}/export`,
		{ token: target.gm },
	);
	expect(res.status).toBe(200);
	return res.body;
}

async function importInto(target: TestRoom, file: unknown) {
	return api<RoomSummary>(target.http, "/api/rooms/import", {
		token: target.gm,
		body: file,
	});
}

async function roomEntities(
	target: TestRoom,
	roomId: string,
): Promise<Entity[]> {
	const c = await RawClient.join(target.url, target.gm, { roomId });
	const list = snapshotEntities(c);
	c.close();
	return list;
}

describe("Raum-Export", () => {
	it("enthält Szenen, Objekte und Bilder, aber keine Spieler und keine Würfe", async () => {
		await fillRoom();
		const file = await exportFile();
		const kinds = new Set(file.entities.map((e) => e.kind));
		expect(kinds.has("player")).toBe(false);
		expect(kinds.has("roll")).toBe(false);
		for (const k of [
			"scene",
			"roomState",
			"token",
			"fog",
			"drawing",
			"note",
			"handout",
		]) {
			expect(kinds.has(k as Entity["kind"])).toBe(true);
		}
		expect(file.assets.map((a) => a.id)).toEqual([assetId]);
		expect(
			Buffer.from(file.assets[0]?.data ?? "", "base64")
				.subarray(1, 4)
				.toString(),
		).toBe("PNG");
	});

	it("nur für die GM", async () => {
		const res = await api(room.http, `/api/rooms/${room.roomId}/export`, {
			token: room.p1.token,
		});
		expect(res.status).toBe(403);
	});
});

describe("Raum-Import", () => {
	it("legt einen neuen Raum an; Besitz geht an die GM, Spielerlisten werden verdeckt", async () => {
		await fillRoom();
		const file = await exportFile();
		const res = await importInto(room, file);
		expect(res.status).toBe(200);
		expect(res.body.id).not.toBe(room.roomId);
		expect(res.body.name).toBe("Testraum");

		const list = await roomEntities(room, res.body.id);
		const get = (kind: string, id?: string) =>
			list.find((e) => e.kind === kind && (id === undefined || e.id === id));
		expect(list.filter((e) => e.kind === "scene")).toHaveLength(2);
		expect(get("player")).toBeUndefined();
		expect(get("token", "tok")?.data).toMatchObject({ ownerId: null, assetId });
		expect(get("drawing", "draw")?.data).toMatchObject({ ownerId: null });
		expect(get("note", "note")?.audience).toEqual({ type: "gm" });
		expect(get("handout", "hand")).toMatchObject({
			audience: { type: "gm" },
			data: { shownAt: null },
		});
		// Szene nur für ausgewählte Spieler → verdeckt, ihr Fog folgt.
		expect(get("fog", "fog2")?.audience).toEqual({ type: "gm" });
		expect(get("roomState")?.data.activeSceneId).toBe(sceneId);

		// Spieler im alten Raum merken nichts davon.
		expect(JSON.stringify(await p1.drain(100))).not.toContain(res.body.id);
	});

	it("kodiert Bilder in einer anderen Installation neu", async () => {
		await fillRoom();
		const file = await exportFile();
		const other = await startTestRoom();
		try {
			const res = await importInto(other, file);
			expect(res.status).toBe(200);
			const list = await roomEntities(other, res.body.id);
			const token = list.find((e) => e.kind === "token");
			const newAsset = token?.data.assetId as string;
			expect(newAsset).not.toBe(assetId);
			const meta = await fetch(`${other.http}/assets/${newAsset}/meta.json`);
			expect(((await meta.json()) as AssetMeta).purpose).toBe("token");
		} finally {
			await other.close();
		}
	});

	it("lehnt kaputte oder manipulierte Dateien ab, ohne einen Raum anzulegen", async () => {
		const before = (
			await api<RoomSummary[]>(room.http, "/api/rooms", { token: room.gm })
		).body.length;
		const file = await exportFile();
		expect((await importInto(room, { format: "anders" })).status).toBe(400);
		const broken = structuredClone(file);
		broken.entities.push({
			kind: "token",
			id: "kaputt",
			data: { sceneId, assetId, x: "nicht", y: 0 },
			audience: { type: "all" },
		});
		expect((await importInto(room, broken)).status).toBe(400);
		const bogusImage = structuredClone(file);
		bogusImage.assets.push({
			id: "falsch",
			name: "x",
			purpose: "map",
			data: Buffer.from("kein Bild").toString("base64"),
		});
		expect((await importInto(room, bogusImage)).status).toBe(415);
		const after = (
			await api<RoomSummary[]>(room.http, "/api/rooms", { token: room.gm })
		).body.length;
		expect(after).toBe(before);
	});

	it("nur für die GM", async () => {
		const file = await exportFile();
		const res = await api(room.http, "/api/rooms/import", {
			token: room.p1.token,
			body: file,
		});
		expect(res.status).toBe(403);
	});
});
