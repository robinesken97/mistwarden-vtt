import type { ServerMessage } from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";
import { createScene, snapshotEntities } from "./step6-helpers.ts";

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
	sceneId = snapshotEntities(gm).find((e) => e.kind === "scene")?.id ?? "";
});

afterEach(async () => {
	for (const c of [gm, p1, p2]) c.close();
	await room.close();
});

const pointers = (msgs: ServerMessage[]) =>
	msgs.filter((m) => m.type === "pointer");

describe("Ping", () => {
	it("erreicht GM und alle Spieler, mit Farbe des Absenders", async () => {
		p1.send({ type: "pointer", sceneId, x: 120.4, y: 80 });
		for (const c of [gm, p1, p2]) {
			expect(await c.next("pointer")).toMatchObject({
				sceneId,
				x: 120,
				y: 80,
				playerId: room.p1.id,
				color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
			});
		}
	});

	it("Pings der GM tragen keine Spieler-ID", async () => {
		gm.send({ type: "pointer", sceneId, x: 1, y: 2 });
		expect(await p2.next("pointer")).toMatchObject({ playerId: null });
	});

	it("landet nicht im Änderungslog", async () => {
		gm.send({ type: "pointer", sceneId, x: 1, y: 2 });
		await p1.next("pointer");
		const fresh = await RawClient.join(room.url, room.p1.token, {
			lastVersion: room.baseVersion,
		});
		expect(fresh.raw.join("")).not.toContain("pointer");
		fresh.close();
	});

	it("Pings auf verdeckten Szenen sehen nur, die die Szene sehen", async () => {
		const hidden = await createScene(gm, { type: "gm" });
		const onlyP1 = await createScene(gm, {
			type: "players",
			playerIds: [room.p1.id],
		});
		await Promise.all([p1.drain(), p2.drain()]);

		gm.send({ type: "pointer", sceneId: hidden, x: 5, y: 5 });
		expect(await gm.next("pointer")).toMatchObject({ sceneId: hidden });
		gm.send({ type: "pointer", sceneId: onlyP1, x: 5, y: 5 });
		expect(await p1.next("pointer")).toMatchObject({ sceneId: onlyP1 });
		expect(pointers(await p2.drain(150))).toHaveLength(0);
		expect(pointers(await p1.drain(0))).toHaveLength(0);

		// Spieler können auf Szenen, die sie nicht sehen, nicht pingen.
		await gm.drain(0);
		p2.send({ type: "pointer", sceneId: onlyP1, x: 5, y: 5 });
		p2.send({ type: "pointer", sceneId: hidden, x: 5, y: 5 });
		expect(pointers(await gm.drain(150))).toHaveLength(0);
	});

	it("begrenzt die Rate pro Verbindung", async () => {
		for (let i = 0; i < 20; i++) {
			p1.send({ type: "pointer", sceneId, x: i, y: i });
		}
		const got = pointers(await p2.drain(200));
		expect(got.length).toBeGreaterThanOrEqual(4);
		expect(got.length).toBeLessThan(8);
	});
});
