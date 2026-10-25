import { randomUUID } from "node:crypto";
import type { DrawingData, PlayerData } from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";
import { act, createScene, snapshotEntities } from "./step6-helpers.ts";

let room: TestRoom;
let gm: RawClient;
let p1: RawClient;
let p2: RawClient;
let sceneId: string;
let color1: string;
let color2: string;

beforeEach(async () => {
	room = await startTestRoom();
	gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
	p1 = await RawClient.join(room.url, room.p1.token);
	p2 = await RawClient.join(room.url, room.p2.token);
	const entities = snapshotEntities(gm);
	sceneId = entities.find((e) => e.kind === "scene")?.id ?? "";
	const colorOf = (id: string) => {
		const player = entities.find((e) => e.kind === "player" && e.id === id);
		if (!player) throw new Error(`Spieler ${id} fehlt`);
		return (player.data as PlayerData).color;
	};
	color1 = colorOf(room.p1.id);
	color2 = colorOf(room.p2.id);
});

afterEach(async () => {
	for (const c of [gm, p1, p2]) c.close();
	await room.close();
});

function drawing(overrides: Partial<DrawingData> = {}): DrawingData {
	return {
		sceneId,
		ownerId: room.p1.id,
		color: color1,
		shape: "free",
		points: [0, 0, 10, 10, 20, 5],
		width: 4,
		...overrides,
	};
}

async function draw(
	client: RawClient,
	overrides: Partial<DrawingData> = {},
): Promise<{ id: string; type: string }> {
	const id = randomUUID();
	const res = await act(client, {
		op: "create",
		kind: "drawing",
		id,
		data: drawing(overrides),
	});
	return { id, type: res.type === "reject" ? res.reason : res.type };
}

describe("Zeichnungen", () => {
	it("Spieler zeichnet in eigener Farbe, alle erhalten die Zeichnung", async () => {
		const { id, type } = await draw(p1);
		expect(type).toBe("ack");
		for (const c of [gm, p2]) {
			const msg = await c.next("changes");
			expect(msg.changes[0]).toMatchObject({
				op: "upsert",
				entity: { kind: "drawing", id, data: { ownerId: room.p1.id } },
			});
		}
	});

	it("Formen brauchen genau zwei Punkte", async () => {
		expect(
			(await draw(p1, { shape: "rect", points: [0, 0, 50, 40] })).type,
		).toBe("ack");
		expect(
			(await draw(p1, { shape: "line", points: [0, 0, 5, 5, 9, 9] })).type,
		).toBe("invalid");
	});

	it("Spieler dürfen nicht für andere oder in fremder Farbe zeichnen", async () => {
		expect((await draw(p1, { ownerId: room.p2.id })).type).toBe("forbidden");
		expect((await draw(p1, { color: color2 })).type).toBe("forbidden");
		expect((await draw(p1, { ownerId: null })).type).toBe("forbidden");
	});

	it("die GM zeichnet frei, auch für Spieler", async () => {
		expect((await draw(gm, { ownerId: null, color: "#123456" })).type).toBe(
			"ack",
		);
		expect((await draw(gm, { ownerId: room.p2.id })).type).toBe("ack");
	});

	it("Spieler löschen nur eigene, die GM alle", async () => {
		const own = await draw(p1);
		const other = await draw(p2, { ownerId: room.p2.id, color: color2 });
		expect(
			await act(p1, { op: "delete", kind: "drawing", id: other.id }),
		).toMatchObject({ type: "reject", reason: "forbidden" });
		expect(
			await act(p1, { op: "delete", kind: "drawing", id: own.id }),
		).toMatchObject({ type: "ack" });
		expect(
			await act(gm, { op: "delete", kind: "drawing", id: other.id }),
		).toMatchObject({ type: "ack" });
	});

	it("Spieler ändern Zeichnungen nicht, auch keine eigenen", async () => {
		const { id } = await draw(p1);
		expect(
			await act(p1, {
				op: "update",
				kind: "drawing",
				id,
				patch: { points: [1, 1, 2, 2] },
			}),
		).toMatchObject({ type: "reject", reason: "forbidden" });
	});

	it("keine Zeichnung wechselt die Szene, keine setzt ihre Sichtbarkeit selbst", async () => {
		const { id } = await draw(gm, { ownerId: null });
		const other = await createScene(gm, { type: "all" });
		expect(
			await act(gm, {
				op: "update",
				kind: "drawing",
				id,
				patch: { sceneId: other },
			}),
		).toMatchObject({ type: "reject", reason: "invalid" });
		expect(
			await act(p1, {
				op: "create",
				kind: "drawing",
				id: randomUUID(),
				data: drawing(),
				audience: { type: "gm" },
			}),
		).toMatchObject({ type: "reject", reason: "invalid" });
	});

	it("auf verdeckten Szenen zeichnen Spieler nicht, und GM-Zeichnungen dort sehen sie nicht", async () => {
		const hidden = await createScene(gm, { type: "gm" });
		expect((await draw(p1, { sceneId: hidden })).type).toBe("forbidden");
		await p1.drain();
		expect((await draw(gm, { sceneId: hidden, ownerId: null })).type).toBe(
			"ack",
		);
		const seen = await p1.drain(150);
		expect(JSON.stringify(seen)).not.toContain('"drawing"');
	});

	it("Spieler zeichnen auf Szenen, die nur ausgewählte Spieler sehen", async () => {
		const shared = await createScene(gm, {
			type: "players",
			playerIds: [room.p1.id],
		});
		expect((await draw(p1, { sceneId: shared })).type).toBe("ack");
		expect(
			(await draw(p2, { sceneId: shared, ownerId: room.p2.id, color: color2 }))
				.type,
		).toBe("forbidden");
	});

	it("wird die Szene gelöscht, verschwinden ihre Zeichnungen", async () => {
		const other = await createScene(gm, { type: "all" });
		const { id } = await draw(p1, { sceneId: other });
		await p2.drain();
		expect(
			await act(gm, { op: "delete", kind: "scene", id: other }),
		).toMatchObject({ type: "ack" });
		const msg = await p2.next("changes");
		expect(msg.changes).toContainEqual(
			expect.objectContaining({ op: "delete", kind: "drawing", id }),
		);
	});
});
