import { randomUUID } from "node:crypto";
import {
	type Action,
	type FogData,
	MAX_FOG_COORDS,
} from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";

let room: TestRoom;
let gm: RawClient;
let p1: RawClient;
let sceneId: string;

beforeEach(async () => {
	room = await startTestRoom();
	gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
	p1 = await RawClient.join(room.url, room.p1.token);
	const snap = gm.received.find((m) => m.type === "snapshot");
	sceneId =
		(snap?.type === "snapshot" &&
			snap.entities.find((e) => e.kind === "scene")?.id) ||
		"";
});

afterEach(async () => {
	gm.close();
	p1.close();
	await room.close();
});

function act(client: RawClient, action: Action) {
	client.send({ type: "action", actionId: randomUUID(), action });
	return client.nextOf(["ack", "reject"]);
}

const square = (x: number, y: number, s: number) => [
	x,
	y,
	x + s,
	y,
	x + s,
	y + s,
	x,
	y + s,
];

function fog(overrides: Partial<FogData> = {}): FogData {
	return {
		sceneId,
		polygons: [{ outer: square(0, 0, 500), holes: [square(100, 100, 50)] }],
		active: true,
		source: "hand",
		name: "Gruft",
		...overrides,
	};
}

async function createFog(overrides: Partial<FogData> = {}): Promise<string> {
	const id = randomUUID();
	expect(
		await act(gm, { op: "create", kind: "fog", id, data: fog(overrides) }),
	).toMatchObject({
		type: "ack",
	});
	return id;
}

describe("Fog", () => {
	it("die GM legt an und schaltet, Spieler erhalten die Form", async () => {
		const id = await createFog();
		const created = await p1.next("changes");
		expect(created.changes[0]).toMatchObject({
			op: "upsert",
			entity: { kind: "fog", id, data: { active: true, name: "Gruft" } },
		});
		expect(
			await act(gm, {
				op: "update",
				kind: "fog",
				id,
				patch: { active: false },
			}),
		).toMatchObject({ type: "ack" });
		const toggled = await p1.next("changes");
		expect(toggled.changes[0]).toMatchObject({
			entity: { data: { active: false } },
		});
	});

	it("Spieler dürfen Fog weder anlegen noch schalten noch löschen", async () => {
		const id = await createFog();
		expect(
			await act(p1, {
				op: "create",
				kind: "fog",
				id: randomUUID(),
				data: fog(),
			}),
		).toMatchObject({ reason: "forbidden" });
		expect(
			await act(p1, {
				op: "update",
				kind: "fog",
				id,
				patch: { active: false },
			}),
		).toMatchObject({ reason: "forbidden" });
		expect(await act(p1, { op: "delete", kind: "fog", id })).toMatchObject({
			reason: "forbidden",
		});
	});

	it("ungültige oder zu große Polygone werden abgewiesen", async () => {
		const bad: FogData[] = [
			fog({ polygons: [] }),
			fog({ polygons: [{ outer: [0, 0, 10, 10], holes: [] }] }), // nur zwei Punkte
			fog({ polygons: [{ outer: [0, 0, 10, 10, 5], holes: [] }] }), // ungerade
			fog({ polygons: [{ outer: [0.5, 0, 10, 0, 10, 10], holes: [] }] }), // keine ganze Zahl
			fog({
				polygons: [
					{
						outer: Array.from({ length: MAX_FOG_COORDS + 2 }, (_, i) => i),
						holes: [],
					},
				],
			}),
		];
		for (const data of bad) {
			expect(
				await act(gm, { op: "create", kind: "fog", id: randomUUID(), data }),
			).toMatchObject({ reason: "invalid" });
		}
	});

	it("Fog einer verdeckten Szene erreicht keine Spieler, Aufdecken liefert ihn nach", async () => {
		const hidden = randomUUID();
		await act(gm, {
			op: "create",
			kind: "scene",
			id: hidden,
			data: { name: "Vorbereitet", order: 3 },
			audience: { type: "gm" },
		});
		const id = await createFog({ sceneId: hidden, name: "Geheimgang" });
		await p1.drain();
		expect(p1.raw.join("\n")).not.toContain("Geheimgang");

		await act(gm, {
			op: "update",
			kind: "scene",
			id: hidden,
			audience: { type: "all" },
		});
		const changes = (await p1.drain(150)).flatMap((m) =>
			m.type === "changes" ? m.changes : [],
		);
		expect(changes).toContainEqual(
			expect.objectContaining({
				op: "upsert",
				entity: expect.objectContaining({ id }),
			}),
		);
	});
});

describe("Tokens verstecken", () => {
	it("ein verstecktes Token verschwindet bei Spielern und kommt beim Zeigen zurück", async () => {
		const id = randomUUID();
		await act(gm, {
			op: "create",
			kind: "token",
			id,
			data: {
				sceneId,
				assetId: randomUUID(),
				x: 50,
				y: 50,
				size: 1,
				rotation: 0,
				ownerId: null,
				layer: "tokens",
				name: "Lauernder Schatten",
			},
		});
		await p1.next("changes");

		await act(gm, { op: "update", kind: "token", id, patch: { hidden: true } });
		expect((await p1.next("changes")).changes).toEqual([
			expect.objectContaining({ op: "delete", kind: "token", id }),
		]);

		// Während es versteckt ist, sieht der Spieler auch Bewegungen nicht.
		await act(gm, { op: "update", kind: "token", id, patch: { x: 999 } });
		expect((await p1.drain()).filter((m) => m.type === "changes")).toHaveLength(
			0,
		);

		await act(gm, {
			op: "update",
			kind: "token",
			id,
			patch: { hidden: false },
		});
		expect((await p1.next("changes")).changes[0]).toMatchObject({
			op: "upsert",
			entity: { id, data: { x: 999 } },
		});
	});

	it("Spieler können Tokens nicht verstecken", async () => {
		const id = randomUUID();
		await act(gm, {
			op: "create",
			kind: "token",
			id,
			data: {
				sceneId,
				assetId: randomUUID(),
				x: 50,
				y: 50,
				size: 1,
				rotation: 0,
				ownerId: room.p1.id,
				layer: "tokens",
				name: "Eigenes",
			},
		});
		expect(
			await act(p1, {
				op: "update",
				kind: "token",
				id,
				patch: { hidden: true },
			}),
		).toMatchObject({ reason: "forbidden" });
	});
});
