import { randomUUID } from "node:crypto";
import { MAX_ROLLS, type RollData } from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";
import { act } from "./step6-helpers.ts";

let room: TestRoom;
let gm: RawClient;
let p1: RawClient;
let p2: RawClient;

beforeEach(async () => {
	room = await startTestRoom();
	gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
	p1 = await RawClient.join(room.url, room.p1.token);
	p2 = await RawClient.join(room.url, room.p2.token);
});

afterEach(async () => {
	for (const c of [gm, p1, p2]) c.close();
	await room.close();
});

function roll(
	client: RawClient,
	formula: string,
	hidden = false,
	actionId = randomUUID(),
) {
	client.send({ type: "roll", actionId, formula, hidden });
	return client.nextOf(["ack", "reject"]);
}

describe("Würfeln", () => {
	it("der Server würfelt, alle sehen den Wurf eines Spielers", async () => {
		expect(await roll(p1, "4d6 kh3 + 2")).toMatchObject({ type: "ack" });
		for (const c of [gm, p1, p2]) {
			const msg = await c.next("changes");
			const entity =
				msg.changes[0]?.op === "upsert" ? msg.changes[0].entity : null;
			expect(entity?.kind).toBe("roll");
			const data = entity?.data as RollData;
			expect(data).toMatchObject({
				authorId: room.p1.id,
				formula: "4d6kh3+2",
				hidden: false,
			});
			const dice = data.terms[0];
			if (dice?.type !== "dice") throw new Error("Würfel fehlen");
			expect(dice.results).toHaveLength(4);
			expect(dice.results.every((r) => r >= 1 && r <= 6)).toBe(true);
			const kept = dice.results.filter((_, i) => dice.kept[i]);
			expect(kept).toHaveLength(3);
			expect(data.total).toBe(kept.reduce((a, b) => a + b, 0) + 2);
		}
	});

	it("lehnt ungültige Formeln ab", async () => {
		expect(await roll(p1, "1d20*2")).toMatchObject({
			type: "reject",
			reason: "invalid",
		});
	});

	it("verdeckte Würfe der GM erreichen Spieler nie, auch nicht beim Nachholen", async () => {
		expect(await roll(gm, "1d20+3", true)).toMatchObject({ type: "ack" });
		const gmMsg = await gm.next("changes");
		expect(gmMsg.changes[0]).toMatchObject({
			op: "upsert",
			entity: { kind: "roll", data: { hidden: true, authorId: null } },
		});
		const seen = await p1.drain(150);
		expect(JSON.stringify(seen)).not.toContain("1d20+3");

		// Neu verbinden mit komplettem Stand und mit Nachholen ab Version 0.
		const fresh = await RawClient.join(room.url, room.p2.token);
		const replay = await RawClient.join(room.url, room.p2.token, {
			lastVersion: room.baseVersion,
		});
		for (const c of [fresh, replay]) {
			expect(c.raw.join("")).not.toContain('"roll"');
			c.close();
		}
	});

	it("offene Würfe der GM sehen alle", async () => {
		expect(await roll(gm, "1d8", false)).toMatchObject({ type: "ack" });
		const msg = await p1.next("changes");
		expect(msg.changes[0]).toMatchObject({
			op: "upsert",
			entity: { kind: "roll", data: { authorId: null, hidden: false } },
		});
	});

	it("Spieler dürfen nicht verdeckt würfeln", async () => {
		expect(await roll(p1, "1d20", true)).toMatchObject({
			type: "reject",
			reason: "forbidden",
		});
	});

	it("Würfe lassen sich nicht direkt anlegen oder ändern", async () => {
		const data: RollData = {
			authorId: room.p1.id,
			formula: "1d20",
			terms: [
				{
					type: "dice",
					sign: 1,
					count: 1,
					sides: 20,
					keep: null,
					results: [20],
					kept: [true],
				},
			],
			total: 20,
			hidden: false,
			at: 0,
		};
		for (const c of [p1, gm]) {
			expect(
				await act(c, { op: "create", kind: "roll", id: randomUUID(), data }),
			).toMatchObject({ type: "reject", reason: "forbidden" });
		}
		await roll(p1, "1d20");
		const msg = await p1.next("changes");
		const id = msg.changes[0]?.op === "upsert" ? msg.changes[0].entity.id : "";
		expect(
			await act(p1, { op: "update", kind: "roll", id, patch: { total: 20 } }),
		).toMatchObject({ type: "reject", reason: "forbidden" });
		expect(await act(p1, { op: "delete", kind: "roll", id })).toMatchObject({
			type: "reject",
			reason: "forbidden",
		});
		expect(await act(gm, { op: "delete", kind: "roll", id })).toMatchObject({
			type: "ack",
		});
	});

	it("erneut gesendete Würfe werden nicht doppelt gewürfelt", async () => {
		const actionId = randomUUID();
		const first = await roll(p1, "1d20", false, actionId);
		const again = await roll(p1, "1d20", false, actionId);
		expect(again).toEqual(first);
		const changes = (await p2.drain(150)).filter((m) => m.type === "changes");
		expect(changes).toHaveLength(1);
	});

	it(`behält höchstens ${MAX_ROLLS} Würfe`, async () => {
		for (let i = 0; i < MAX_ROLLS + 2; i++) {
			expect(await roll(gm, "1d4", i % 2 === 0)).toMatchObject({ type: "ack" });
		}
		const fresh = await RawClient.join(room.url, room.gm, {
			roomId: room.roomId,
		});
		const snap = fresh.received.find((m) => m.type === "snapshot");
		const rolls =
			snap?.type === "snapshot"
				? snap.entities.filter((e) => e.kind === "roll")
				: [];
		expect(rolls).toHaveLength(MAX_ROLLS);
		fresh.close();
	});
});
