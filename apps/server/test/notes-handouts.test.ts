import { randomUUID } from "node:crypto";
import type { HandoutData, NoteData } from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";
import { act, createScene, snapshotEntities } from "./step6-helpers.ts";

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

const note = (overrides: Partial<NoteData> = {}): NoteData => ({
	sceneId,
	x: 100,
	y: 200,
	title: "Falltür",
	text: "Geheimtext-Notiz",
	hidden: true,
	...overrides,
});

const handout = (overrides: Partial<HandoutData> = {}): HandoutData => ({
	title: "Brief",
	text: "Geheimtext-Handout",
	assetId: null,
	shownAt: 1,
	...overrides,
});

describe("Notizen", () => {
	it("GM-Notizen erreichen Spieler nie, auch nicht beim Neuladen", async () => {
		const id = randomUUID();
		expect(
			await act(gm, { op: "create", kind: "note", id, data: note() }),
		).toMatchObject({ type: "ack" });
		expect(JSON.stringify(await p1.drain(150))).not.toContain("Geheimtext");
		const fresh = await RawClient.join(room.url, room.p2.token);
		expect(fresh.raw.join("")).not.toContain("Geheimtext");
		fresh.close();
	});

	it("freigegebene Notizen sehen alle; zurückgezogen verschwinden sie", async () => {
		const id = randomUUID();
		await act(gm, { op: "create", kind: "note", id, data: note() });
		await act(gm, { op: "update", kind: "note", id, patch: { hidden: false } });
		expect((await p1.next("changes")).changes[0]).toMatchObject({
			op: "upsert",
			entity: { kind: "note", id, data: { title: "Falltür" } },
		});
		await act(gm, { op: "update", kind: "note", id, patch: { hidden: true } });
		expect((await p1.next("changes")).changes[0]).toMatchObject({
			op: "delete",
			kind: "note",
			id,
		});
	});

	it("Notizen auf verdeckten Szenen bleiben verdeckt", async () => {
		const hidden = await createScene(gm, { type: "gm" });
		await act(gm, {
			op: "create",
			kind: "note",
			id: randomUUID(),
			data: note({ sceneId: hidden, hidden: false }),
		});
		expect(JSON.stringify(await p1.drain(150))).not.toContain("Geheimtext");
	});

	it("Spieler legen keine Notizen an und ändern keine", async () => {
		const id = randomUUID();
		expect(
			await act(p1, {
				op: "create",
				kind: "note",
				id: randomUUID(),
				data: note({ hidden: false }),
			}),
		).toMatchObject({ type: "reject", reason: "forbidden" });
		await act(gm, {
			op: "create",
			kind: "note",
			id,
			data: note({ hidden: false }),
		});
		expect(
			await act(p1, { op: "update", kind: "note", id, patch: { x: 5 } }),
		).toMatchObject({ type: "reject", reason: "forbidden" });
		expect(await act(p1, { op: "delete", kind: "note", id })).toMatchObject({
			type: "reject",
			reason: "forbidden",
		});
	});

	it("Notizen setzen ihre Sichtbarkeit nicht direkt und wechseln nie die Szene", async () => {
		const id = randomUUID();
		expect(
			await act(gm, {
				op: "create",
				kind: "note",
				id,
				data: note({ hidden: false }),
				audience: { type: "all" },
			}),
		).toMatchObject({ type: "reject", reason: "invalid" });
		await act(gm, { op: "create", kind: "note", id, data: note() });
		const other = await createScene(gm, { type: "all" });
		expect(
			await act(gm, {
				op: "update",
				kind: "note",
				id,
				patch: { sceneId: other },
			}),
		).toMatchObject({ type: "reject", reason: "invalid" });
	});
});

describe("Handouts", () => {
	it("ein Entwurf (nur GM) erreicht niemanden", async () => {
		await act(gm, {
			op: "create",
			kind: "handout",
			id: randomUUID(),
			data: handout({ shownAt: null }),
			audience: { type: "gm" },
		});
		for (const c of [p1, p2]) {
			expect(JSON.stringify(await c.drain(100))).not.toContain("Geheimtext");
		}
	});

	it("an einzelne Spieler: nur die Empfänger erhalten es", async () => {
		const id = randomUUID();
		await act(gm, {
			op: "create",
			kind: "handout",
			id,
			data: handout(),
			audience: { type: "players", playerIds: [room.p1.id] },
		});
		expect((await p1.next("changes")).changes[0]).toMatchObject({
			op: "upsert",
			entity: { kind: "handout", id },
		});
		expect(JSON.stringify(await p2.drain(150))).not.toContain("Geheimtext");
		// Spieler erfahren nicht, wer das Handout sonst noch bekommt.
		expect(JSON.stringify(p1.received)).not.toContain('"audience"');

		// Empfänger wechseln: p1 verliert es, p2 bekommt es.
		await act(gm, {
			op: "update",
			kind: "handout",
			id,
			audience: { type: "players", playerIds: [room.p2.id] },
		});
		expect((await p1.next("changes")).changes[0]).toMatchObject({
			op: "delete",
			kind: "handout",
			id,
		});
		expect((await p2.next("changes")).changes[0]).toMatchObject({
			op: "upsert",
			entity: { kind: "handout", id },
		});
		const fresh = await RawClient.join(room.url, room.p1.token);
		expect(fresh.raw.join("")).not.toContain("Geheimtext");
		fresh.close();
	});

	it("braucht Text oder Bild", async () => {
		expect(
			await act(gm, {
				op: "create",
				kind: "handout",
				id: randomUUID(),
				data: handout({ text: "  " }),
			}),
		).toMatchObject({ type: "reject", reason: "invalid" });
	});

	it("Spieler legen keine Handouts an und ändern keine", async () => {
		const id = randomUUID();
		expect(
			await act(p1, { op: "create", kind: "handout", id, data: handout() }),
		).toMatchObject({ type: "reject", reason: "forbidden" });
		await act(gm, { op: "create", kind: "handout", id, data: handout() });
		await p1.next("changes");
		expect(
			await act(p1, {
				op: "update",
				kind: "handout",
				id,
				patch: { shownAt: 2 },
			}),
		).toMatchObject({ type: "reject", reason: "forbidden" });
		expect(await act(p1, { op: "delete", kind: "handout", id })).toMatchObject({
			type: "reject",
			reason: "forbidden",
		});
	});
});
