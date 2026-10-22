import { randomUUID } from "node:crypto";
import {
	type Action,
	type Audience,
	CLOSE_UNAUTHORIZED,
	PROTOCOL_VERSION,
} from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";

let room: TestRoom;
const clients: RawClient[] = [];

beforeEach(async () => {
	room = await startTestRoom();
});

afterEach(async () => {
	for (const c of clients.splice(0)) c.close();
	await room.close();
});

async function join(token: string, lastVersion: number | null = null) {
	const c = await RawClient.join(room.url, token, lastVersion);
	clients.push(c);
	return c;
}

function act(
	client: RawClient,
	action: Action,
	actionId: string = randomUUID(),
) {
	client.send({ type: "action", actionId, action });
	return client.nextOf(["ack", "reject"]);
}

const createScene = (name: string, audience?: Audience) =>
	({
		op: "create",
		kind: "scene",
		id: randomUUID(),
		data: { name },
		...(audience ? { audience } : {}),
	}) satisfies Action;

describe("Anmeldung", () => {
	it("weist ungültige Sitzungen ab", async () => {
		const c = await RawClient.open(room.url);
		clients.push(c);
		c.send({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token: "falsch",
			lastVersion: null,
		});
		expect((await c.next("error")).code).toBe("unauthorized");
		expect(await c.closed).toBe(CLOSE_UNAUTHORIZED);
	});

	it("nimmt vor der Anmeldung keine Aktionen an", async () => {
		const c = await RawClient.open(room.url);
		clients.push(c);
		c.send({ type: "action", actionId: "a1", action: createScene("X") });
		expect((await c.next("error")).code).toBe("protocol");
	});

	it("beantwortet kaputte Nachrichten mit Fehler, ohne abzustürzen", async () => {
		const gm = await join(room.gm);
		gm.ws.send("kein json");
		expect((await gm.next("error")).code).toBe("bad_message");
		gm.send({
			type: "action",
			actionId: "x",
			action: { op: "create", kind: "drache" },
		});
		expect((await gm.next("error")).code).toBe("bad_message");
		gm.send({ type: "ping" });
		await gm.next("pong");
	});

	it("liefert Identität und leeren Anfangszustand", async () => {
		const c = await RawClient.open(room.url);
		clients.push(c);
		c.send({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token: room.p1.token,
			lastVersion: null,
		});
		const welcome = await c.next("welcome");
		expect(welcome.identity).toEqual({ role: "player", playerId: room.p1.id });
		expect(welcome.roomId).toBe(room.roomId);
		expect(await c.next("snapshot")).toMatchObject({
			version: 0,
			entities: [],
		});
	});
});

describe("Synchronisation", () => {
	it("verteilt eine Änderung der GM an alle Spieler", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const p2 = await join(room.p2.token);

		const action = createScene("Dorf Barovia");
		expect(await act(gm, action)).toMatchObject({ type: "ack", version: 1 });

		for (const c of [gm, p1, p2]) {
			const msg = await c.next("changes");
			expect(msg.version).toBe(1);
			expect(msg.changes).toEqual([
				expect.objectContaining({
					op: "upsert",
					version: 1,
					entity: expect.objectContaining({
						id: action.id,
						data: { name: "Dorf Barovia" },
					}),
				}),
			]);
		}
	});

	it("vergibt fortlaufende Versionen", async () => {
		const gm = await join(room.gm);
		const versions = [];
		for (const name of ["A", "B", "C"]) {
			const ack = await act(gm, createScene(name));
			versions.push(ack.type === "ack" ? ack.version : -1);
		}
		expect(versions).toEqual([1, 2, 3]);
	});

	it("wendet ein erneut gesendetes actionId nur einmal an", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const action = createScene("Einmal");
		expect(await act(gm, action, "dup-1")).toMatchObject({
			type: "ack",
			version: 1,
		});
		expect(await act(gm, action, "dup-1")).toMatchObject({
			type: "ack",
			version: 1,
		});
		await p1.next("changes");
		expect((await p1.drain()).filter((m) => m.type === "changes")).toHaveLength(
			0,
		);
	});

	it("prüft Daten gegen das Schema", async () => {
		const gm = await join(room.gm);
		const bad = { ...createScene("x"), data: { name: "" } } satisfies Action;
		expect(await act(gm, bad)).toMatchObject({
			type: "reject",
			reason: "invalid",
		});
		const extra = {
			...createScene("x"),
			data: { name: "ok", hack: 1 },
		} satisfies Action;
		expect(await act(gm, extra)).toMatchObject({
			type: "reject",
			reason: "invalid",
		});
	});

	it("aktualisiert und löscht", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const scene = createScene("Alt");
		await act(gm, scene);
		await act(gm, {
			op: "update",
			kind: "scene",
			id: scene.id,
			patch: { name: "Neu" },
		});
		await act(gm, { op: "delete", kind: "scene", id: scene.id });
		const changes = [
			...(await p1.next("changes")).changes,
			...(await p1.next("changes")).changes,
			...(await p1.next("changes")).changes,
		];
		expect(changes.map((c) => c.op)).toEqual(["upsert", "upsert", "delete"]);
		expect(changes[1]).toMatchObject({ entity: { data: { name: "Neu" } } });
	});
});

describe("Rechte", () => {
	it("Spieler dürfen keine Szenen anlegen", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		expect(await act(p1, createScene("Fremd"))).toMatchObject({
			type: "reject",
			reason: "forbidden",
		});
		expect((await gm.drain()).filter((m) => m.type === "changes")).toHaveLength(
			0,
		);
	});

	it("Spieler dürfen Szenen weder ändern noch löschen", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const scene = createScene("Schloss");
		await act(gm, scene);
		expect(
			await act(p1, {
				op: "update",
				kind: "scene",
				id: scene.id,
				patch: { name: "Meins" },
			}),
		).toMatchObject({ reason: "forbidden" });
		expect(
			await act(p1, { op: "delete", kind: "scene", id: scene.id }),
		).toMatchObject({
			reason: "forbidden",
		});
	});

	it("verdeckte Objekte gelten für Spieler als nicht vorhanden", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const secret = createScene("Geheim", { type: "gm" });
		await act(gm, secret);
		expect(
			await act(p1, { op: "delete", kind: "scene", id: secret.id }),
		).toMatchObject({
			reason: "not_found",
		});
	});
});

describe("Sichtbarkeit", () => {
	it("schickt verdeckte Objekte nicht an Spieler", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		await act(gm, createScene("Geheimkammer", { type: "gm" }));
		expect((await gm.next("changes")).changes).toHaveLength(1);

		await join(room.p1.token); // neuer Snapshot ebenfalls ohne
		await p1.drain();
		for (const c of clients.slice(1)) {
			expect(c.raw.join("\n")).not.toContain("Geheimkammer");
		}
	});

	it("schickt Objekte nur an die adressierten Spieler", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const p2 = await join(room.p2.token);
		await act(
			gm,
			createScene("Brief an Eins", {
				type: "players",
				playerIds: [room.p1.id],
			}),
		);
		const msg = await p1.next("changes");
		expect(msg.changes[0]).toMatchObject({ op: "upsert" });
		// Spieler erfahren nicht, wer ein Objekt sonst noch sieht.
		expect(
			msg.changes[0]?.op === "upsert" && msg.changes[0].entity.audience,
		).toBeFalsy();
		await p2.drain();
		expect(p2.raw.join("\n")).not.toContain("Brief an Eins");
	});

	it("Aufdecken liefert das Objekt, Verbergen entfernt es beim Spieler", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const scene = createScene("Krypta", { type: "gm" });
		await act(gm, scene);

		await act(gm, {
			op: "update",
			kind: "scene",
			id: scene.id,
			audience: { type: "all" },
		});
		expect((await p1.next("changes")).changes).toEqual([
			expect.objectContaining({
				op: "upsert",
				entity: expect.objectContaining({ id: scene.id }),
			}),
		]);

		await act(gm, {
			op: "update",
			kind: "scene",
			id: scene.id,
			audience: { type: "gm" },
		});
		expect((await p1.next("changes")).changes).toEqual([
			{ version: 3, op: "delete", kind: "scene", id: scene.id },
		]);
	});

	it("Spieler dürfen die Sichtbarkeit nicht ändern", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const scene = createScene("Offen");
		await act(gm, scene);
		expect(
			await act(p1, {
				op: "update",
				kind: "scene",
				id: scene.id,
				audience: { type: "gm" },
			}),
		).toMatchObject({ reason: "forbidden" });
	});
});

describe("Reconnect", () => {
	it("holt nur die fehlenden Änderungen nach", async () => {
		const gm = await join(room.gm);
		await act(gm, createScene("Vorher"));

		const offline = createScene("Während der Displaysperre");
		await act(gm, offline);
		await act(gm, {
			op: "update",
			kind: "scene",
			id: offline.id,
			patch: { name: "Umbenannt" },
		});

		const p1 = await RawClient.open(room.url);
		clients.push(p1);
		p1.send({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token: room.p1.token,
			lastVersion: 1,
		});
		await p1.next("welcome");
		const catchUp = await p1.next("changes");
		expect(catchUp.version).toBe(3);
		expect(catchUp.changes.map((c) => c.version)).toEqual([2, 3]);
	});

	it("filtert beim Nachholen nach Sichtbarkeit, inklusive Verbergen", async () => {
		const gm = await join(room.gm);
		const shown = createScene("Wird verborgen");
		await act(gm, shown);
		await act(gm, createScene("Bleibt geheim", { type: "gm" }));
		await act(gm, {
			op: "update",
			kind: "scene",
			id: shown.id,
			audience: { type: "gm" },
		});

		const p1 = await RawClient.open(room.url);
		clients.push(p1);
		p1.send({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token: room.p1.token,
			lastVersion: 1,
		});
		await p1.next("welcome");
		const catchUp = await p1.next("changes");
		expect(catchUp.changes).toEqual([
			{ version: 3, op: "delete", kind: "scene", id: shown.id },
		]);
		expect(p1.raw.join("\n")).not.toContain("Bleibt geheim");
	});

	it("liefert einen Snapshot bei unbekannter Version", async () => {
		const gm = await join(room.gm);
		await act(gm, createScene("A"));
		const p1 = await RawClient.open(room.url);
		clients.push(p1);
		p1.send({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token: room.p1.token,
			lastVersion: 99,
		});
		await p1.next("welcome");
		const snap = await p1.next("snapshot");
		expect(snap.version).toBe(1);
		expect(snap.entities).toHaveLength(1);
	});

	it("überlebt einen Serverneustart ohne Datenverlust", async () => {
		const gm = await join(room.gm);
		await act(gm, createScene("Persistent"));
		const databasePath = room.server.db.name;
		for (const c of clients.splice(0)) c.close();
		await room.server.close();

		const { startServer } = await import("../src/app.ts");
		const restarted = await startServer({
			host: "127.0.0.1",
			port: 0,
			databasePath,
		});
		room.server = restarted;
		room.url = `ws://127.0.0.1:${restarted.port}/ws`;
		const p1 = await RawClient.open(room.url);
		clients.push(p1);
		p1.send({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token: room.p1.token,
			lastVersion: null,
		});
		await p1.next("welcome");
		const snap = await p1.next("snapshot");
		expect(snap.entities.map((e) => e.data.name)).toEqual(["Persistent"]);
	});
});
