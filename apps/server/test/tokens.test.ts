import { randomUUID } from "node:crypto";
import type { Action, Entity, TokenData } from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";

let room: TestRoom;
let gm: RawClient;
let p1: RawClient;
let p2: RawClient;
let sceneId: string;

beforeEach(async () => {
	room = await startTestRoom();
	gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
	p1 = await RawClient.join(room.url, room.p1.token);
	p2 = await RawClient.join(room.url, room.p2.token);
	const snap = gm.received.find((m) => m.type === "snapshot");
	sceneId =
		(snap?.type === "snapshot" &&
			snap.entities.find((e) => e.kind === "scene")?.id) ||
		"";
});

afterEach(async () => {
	for (const c of [gm, p1, p2]) c.close();
	await room.close();
});

function act(client: RawClient, action: Action) {
	client.send({ type: "action", actionId: randomUUID(), action });
	return client.nextOf(["ack", "reject"]);
}

function tokenData(overrides: Partial<TokenData> = {}): TokenData {
	return {
		sceneId,
		assetId: randomUUID(),
		x: 150,
		y: 150,
		size: 1,
		rotation: 0,
		ownerId: null,
		layer: "tokens",
		name: "Wache",
		hidden: false,
		...overrides,
	};
}

async function createToken(
	overrides: Partial<TokenData> = {},
): Promise<string> {
	const id = randomUUID();
	const res = await act(gm, {
		op: "create",
		kind: "token",
		id,
		data: tokenData(overrides),
	});
	expect(res).toMatchObject({ type: "ack" });
	return id;
}

const move = (id: string, x: number, y: number): Action => ({
	op: "update",
	kind: "token",
	id,
	patch: { x, y },
});

describe("Token-Rechte", () => {
	it("Spieler bewegen und drehen eigene Tokens", async () => {
		const id = await createToken({ ownerId: room.p1.id });
		expect(await act(p1, move(id, 250, 350))).toMatchObject({ type: "ack" });
		expect(
			await act(p1, {
				op: "update",
				kind: "token",
				id,
				patch: { rotation: 45 },
			}),
		).toMatchObject({ type: "ack" });
	});

	it("Spieler bewegen keine fremden oder herrenlosen Tokens", async () => {
		const fremd = await createToken({ ownerId: room.p2.id });
		const gmToken = await createToken();
		expect(await act(p1, move(fremd, 0, 0))).toMatchObject({
			reason: "forbidden",
		});
		expect(await act(p1, move(gmToken, 0, 0))).toMatchObject({
			reason: "forbidden",
		});
	});

	it("Spieler ändern an eigenen Tokens nur Position und Drehung", async () => {
		const id = await createToken({ ownerId: room.p1.id });
		for (const patch of [
			{ size: 3 },
			{ ownerId: room.p2.id },
			{ layer: "props" },
			{ name: "X" },
		]) {
			expect(
				await act(p1, { op: "update", kind: "token", id, patch }),
			).toMatchObject({
				reason: "forbidden",
			});
		}
		expect(await act(p1, { op: "delete", kind: "token", id })).toMatchObject({
			reason: "forbidden",
		});
	});

	it("Spieler legen keine Tokens an", async () => {
		expect(
			await act(p1, {
				op: "create",
				kind: "token",
				id: randomUUID(),
				data: tokenData({ ownerId: room.p1.id }),
			}),
		).toMatchObject({ reason: "forbidden" });
	});

	it("Props bewegt nur die GM, auch wenn ein Besitzer eingetragen ist", async () => {
		const id = await createToken({ ownerId: room.p1.id, layer: "props" });
		expect(await act(p1, move(id, 0, 0))).toMatchObject({
			reason: "forbidden",
		});
		expect(await act(gm, move(id, 0, 0))).toMatchObject({ type: "ack" });
	});

	it("Tokens wechseln nie die Szene und brauchen eine existierende Szene", async () => {
		const id = await createToken();
		expect(
			await act(gm, {
				op: "update",
				kind: "token",
				id,
				patch: { sceneId: randomUUID() },
			}),
		).toMatchObject({ reason: "invalid" });
		expect(
			await act(gm, {
				op: "create",
				kind: "token",
				id: randomUUID(),
				data: tokenData({ sceneId: randomUUID() }),
			}),
		).toMatchObject({ reason: "invalid" });
	});

	it("Sichtbarkeit eines Tokens lässt sich nicht direkt setzen", async () => {
		expect(
			await act(gm, {
				op: "create",
				kind: "token",
				id: randomUUID(),
				data: tokenData(),
				audience: { type: "gm" },
			}),
		).toMatchObject({ reason: "invalid" });
	});
});

describe("Token-Sichtbarkeit folgt der Szene", () => {
	async function hiddenScene(): Promise<string> {
		const id = randomUUID();
		await act(gm, {
			op: "create",
			kind: "scene",
			id,
			data: { name: "Vorbereitet", order: 5 },
			audience: { type: "gm" },
		});
		return id;
	}

	it("Tokens einer verdeckten Szene erreichen keine Spieler", async () => {
		const scene = await hiddenScene();
		await createToken({ sceneId: scene, name: "Geheimer Hinterhalt" });
		await p1.drain();
		expect(p1.raw.join("\n")).not.toContain("Geheimer Hinterhalt");
	});

	it("Aufdecken der Szene liefert ihre Tokens, Verbergen entfernt sie", async () => {
		const scene = await hiddenScene();
		const token = await createToken({ sceneId: scene, name: "Hinterhalt" });
		await p1.drain();

		await act(gm, {
			op: "update",
			kind: "scene",
			id: scene,
			audience: { type: "all" },
		});
		const shown = (await p1.drain(150)).flatMap((m) =>
			m.type === "changes" ? m.changes : [],
		);
		expect(
			shown.map((c) => (c.op === "upsert" ? c.entity.kind : c.kind)),
		).toEqual(["scene", "token"]);

		await act(gm, {
			op: "update",
			kind: "scene",
			id: scene,
			audience: { type: "gm" },
		});
		const hidden = (await p1.drain(150)).flatMap((m) =>
			m.type === "changes" ? m.changes : [],
		);
		expect(hidden).toEqual([
			expect.objectContaining({ op: "delete", kind: "scene", id: scene }),
			expect.objectContaining({ op: "delete", kind: "token", id: token }),
		]);
	});

	it("auch beim Nachholen nach Reconnect", async () => {
		const before = room.baseVersion;
		const scene = await hiddenScene();
		await createToken({ sceneId: scene, name: "Spät gesehen" });
		await act(gm, {
			op: "update",
			kind: "scene",
			id: scene,
			audience: { type: "all" },
		});

		const late = await RawClient.open(room.url);
		late.hello(room.p2.token, { lastVersion: before });
		await late.next("welcome");
		const catchUp = await late.next("changes");
		const tokens = catchUp.changes.filter(
			(c): c is Extract<typeof c, { op: "upsert" }> =>
				c.op === "upsert" && c.entity.kind === "token",
		);
		expect(tokens.map((c) => c.entity.data.name)).toEqual(["Spät gesehen"]);
		late.close();
	});

	it("Löschen einer Szene löscht ihre Tokens", async () => {
		const scene = await hiddenScene();
		const token = await createToken({ sceneId: scene });
		await act(gm, { op: "delete", kind: "scene", id: scene });
		const snap = await RawClient.join(room.url, room.gm, {
			roomId: room.roomId,
		});
		const s = snap.received.find((m) => m.type === "snapshot");
		const ids =
			s?.type === "snapshot" ? s.entities.map((e: Entity) => e.id) : [];
		expect(ids).not.toContain(token);
		snap.close();
	});
});

describe("Echtzeit", () => {
	it("Token-Bewegung erreicht andere Geräte in unter 300 ms", async () => {
		const id = await createToken({ ownerId: room.p1.id });
		await p2.drain();
		const t0 = performance.now();
		p1.send({
			type: "action",
			actionId: randomUUID(),
			action: move(id, 450, 550),
		});
		const msg = await p2.next("changes", 300);
		expect(performance.now() - t0).toBeLessThan(300);
		expect(msg.changes[0]).toMatchObject({
			entity: { data: { x: 450, y: 550 } },
		});
	});
});
