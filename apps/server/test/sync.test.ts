import { randomUUID } from "node:crypto";
import {
	type Action,
	type Audience,
	CLOSE_UNAUTHORIZED,
	type Entity,
} from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RawClient, startTestRoom, type TestRoom } from "./helpers.ts";

let room: TestRoom;
let v: number;
const clients: RawClient[] = [];

beforeEach(async () => {
	room = await startTestRoom();
	v = room.baseVersion;
});

afterEach(async () => {
	for (const c of clients.splice(0)) c.close();
	await room.close();
});

/** Verbindet als GM (mit Raumwahl) oder Spieler und wartet auf den Anfangszustand. */
async function join(token: string, lastVersion: number | null = null) {
	const roomId = token === room.gm ? room.roomId : undefined;
	const c = await RawClient.join(room.url, token, { roomId, lastVersion });
	clients.push(c);
	return c;
}

/** Öffnet ohne auf den Anfangszustand zu warten (für Tests der Anmeldung selbst). */
async function open() {
	const c = await RawClient.open(room.url);
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
		data: { name, order: 1 },
		...(audience ? { audience } : {}),
	}) satisfies Action;

const names = (entities: Entity[], kind = "scene") =>
	entities.filter((e) => e.kind === kind).map((e) => e.data.name);

describe("Anmeldung", () => {
	it("weist ungültige Sitzungen ab", async () => {
		const c = await open();
		c.hello("falsch");
		expect((await c.next("error")).code).toBe("unauthorized");
		expect(await c.closed).toBe(CLOSE_UNAUTHORIZED);
	});

	it("GM muss einen existierenden Raum angeben", async () => {
		const ohne = await open();
		ohne.hello(room.gm);
		expect(await ohne.closed).toBe(CLOSE_UNAUTHORIZED);
		const falsch = await open();
		falsch.hello(room.gm, { roomId: "gibt-es-nicht" });
		expect(await falsch.closed).toBe(CLOSE_UNAUTHORIZED);
	});

	it("Spieler kommen nur in ihren eigenen Raum", async () => {
		const c = await open();
		c.hello(room.p1.token, { roomId: "anderer-raum" });
		expect(await c.closed).toBe(CLOSE_UNAUTHORIZED);
	});

	it("nimmt vor der Anmeldung keine Aktionen an", async () => {
		const c = await open();
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

	it("liefert Identität, Raumname und Anfangszustand des neuen Raums", async () => {
		const c = await open();
		c.hello(room.p1.token);
		const welcome = await c.next("welcome");
		expect(welcome).toMatchObject({
			identity: { role: "player", playerId: room.p1.id },
			roomId: room.roomId,
			roomName: "Testraum",
			version: v,
		});
		const snap = await c.next("snapshot");
		expect(names(snap.entities)).toEqual(["Szene 1"]);
		expect(names(snap.entities, "player")).toEqual(["Eins", "Zwei"]);
		const state = snap.entities.find((e) => e.kind === "roomState");
		const scene = snap.entities.find((e) => e.kind === "scene");
		expect(state?.data.activeSceneId).toBe(scene?.id);
	});
});

describe("Synchronisation", () => {
	it("verteilt eine Änderung der GM an alle Spieler", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const p2 = await join(room.p2.token);

		const action = createScene("Dorf am Fluss");
		expect(await act(gm, action)).toMatchObject({
			type: "ack",
			version: v + 1,
		});

		for (const c of [gm, p1, p2]) {
			const msg = await c.next("changes");
			expect(msg.version).toBe(v + 1);
			expect(msg.changes).toEqual([
				expect.objectContaining({
					op: "upsert",
					version: v + 1,
					entity: expect.objectContaining({
						id: action.id,
						data: { name: "Dorf am Fluss", order: 1 },
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
		expect(versions).toEqual([v + 1, v + 2, v + 3]);
	});

	it("wendet ein erneut gesendetes actionId nur einmal an", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const action = createScene("Einmal");
		expect(await act(gm, action, "dup-1")).toMatchObject({
			type: "ack",
			version: v + 1,
		});
		expect(await act(gm, action, "dup-1")).toMatchObject({
			type: "ack",
			version: v + 1,
		});
		await p1.next("changes");
		expect((await p1.drain()).filter((m) => m.type === "changes")).toHaveLength(
			0,
		);
	});

	it("prüft Daten gegen das Schema", async () => {
		const gm = await join(room.gm);
		const bad = {
			...createScene("x"),
			data: { name: "", order: 0 },
		} satisfies Action;
		expect(await act(gm, bad)).toMatchObject({
			type: "reject",
			reason: "invalid",
		});
		const extra = {
			...createScene("x"),
			data: { name: "ok", order: 0, hack: 1 },
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
		).toMatchObject({ reason: "forbidden" });
	});

	it("Spieler dürfen weder Szene wechseln noch Spieler ändern", async () => {
		const p1 = await join(room.p1.token);
		expect(
			await act(p1, {
				op: "update",
				kind: "roomState",
				id: "state",
				patch: { activeSceneId: null },
			}),
		).toMatchObject({ reason: "forbidden" });
		expect(
			await act(p1, {
				op: "update",
				kind: "player",
				id: room.p2.id,
				patch: { name: "Gekapert" },
			}),
		).toMatchObject({ reason: "forbidden" });
	});

	it("verdeckte Objekte gelten für Spieler als nicht vorhanden", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const secret = createScene("Geheim", { type: "gm" });
		await act(gm, secret);
		expect(
			await act(p1, { op: "delete", kind: "scene", id: secret.id }),
		).toMatchObject({ reason: "not_found" });
	});
});

describe("Szenenwechsel", () => {
	async function activeSceneOf(c: RawClient): Promise<string> {
		const snap = c.received.find((m) => m.type === "snapshot");
		const state =
			snap?.type === "snapshot"
				? snap.entities.find((e) => e.kind === "roomState")
				: undefined;
		return state?.data.activeSceneId as string;
	}

	const activate = (sceneId: string | null) =>
		({
			op: "update",
			kind: "roomState",
			id: "state",
			patch: { activeSceneId: sceneId },
		}) satisfies Action;

	it("alle Clients folgen dem Szenenwechsel der GM", async () => {
		const gm = await join(room.gm);
		const p1 = await join(room.p1.token);
		const p2 = await join(room.p2.token);
		const scene = createScene("Burg auf dem Felsen");
		await act(gm, scene);
		await p1.next("changes");
		await p2.next("changes");

		const t0 = performance.now();
		expect(await act(gm, activate(scene.id))).toMatchObject({ type: "ack" });
		for (const c of [p1, p2]) {
			const msg = await c.next("changes", 1000);
			expect(msg.changes[0]).toMatchObject({
				op: "upsert",
				entity: { kind: "roomState", data: { activeSceneId: scene.id } },
			});
		}
		expect(performance.now() - t0).toBeLessThan(1000);
	});

	it("verdeckte oder unbekannte Szenen lassen sich nicht aktivieren", async () => {
		const gm = await join(room.gm);
		const secret = createScene("Vorbereitet", { type: "gm" });
		await act(gm, secret);
		expect(await act(gm, activate(secret.id))).toMatchObject({
			reason: "invalid",
		});
		expect(await act(gm, activate("gibt-es-nicht"))).toMatchObject({
			reason: "invalid",
		});
	});

	it("die aktive Szene lässt sich weder löschen noch verbergen", async () => {
		const gm = await join(room.gm);
		const active = await activeSceneOf(gm);
		expect(
			await act(gm, { op: "delete", kind: "scene", id: active }),
		).toMatchObject({ reason: "invalid" });
		expect(
			await act(gm, {
				op: "update",
				kind: "scene",
				id: active,
				audience: { type: "gm" },
			}),
		).toMatchObject({ reason: "invalid" });
		// Umbenennen bleibt erlaubt.
		expect(
			await act(gm, {
				op: "update",
				kind: "scene",
				id: active,
				patch: { name: "Dorf" },
			}),
		).toMatchObject({ type: "ack" });
	});

	it("der Raumzustand lässt sich weder löschen noch doppelt anlegen", async () => {
		const gm = await join(room.gm);
		expect(
			await act(gm, { op: "delete", kind: "roomState", id: "state" }),
		).toMatchObject({ reason: "invalid" });
		expect(
			await act(gm, {
				op: "create",
				kind: "roomState",
				id: "zweiter",
				data: { activeSceneId: null },
			}),
		).toMatchObject({ reason: "invalid" });
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
			{ version: v + 3, op: "delete", kind: "scene", id: scene.id },
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

		const p1 = await open();
		p1.hello(room.p1.token, { lastVersion: v + 1 });
		await p1.next("welcome");
		const catchUp = await p1.next("changes");
		expect(catchUp.version).toBe(v + 3);
		expect(catchUp.changes.map((c) => c.version)).toEqual([v + 2, v + 3]);
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

		const p1 = await open();
		p1.hello(room.p1.token, { lastVersion: v + 1 });
		await p1.next("welcome");
		const catchUp = await p1.next("changes");
		expect(catchUp.changes).toEqual([
			{ version: v + 3, op: "delete", kind: "scene", id: shown.id },
		]);
		expect(p1.raw.join("\n")).not.toContain("Bleibt geheim");
	});

	it("liefert einen Snapshot bei unbekannter Version", async () => {
		const gm = await join(room.gm);
		await act(gm, createScene("A"));
		const p1 = await open();
		p1.hello(room.p1.token, { lastVersion: 999 });
		await p1.next("welcome");
		const snap = await p1.next("snapshot");
		expect(snap.version).toBe(v + 1);
		expect(names(snap.entities)).toEqual(["Szene 1", "A"]);
	});

	it("überlebt einen Serverneustart ohne Datenverlust", async () => {
		const gm = await join(room.gm);
		await act(gm, createScene("Persistent"));
		for (const c of clients.splice(0)) c.close();
		await room.restart();

		const p1 = await join(room.p1.token);
		const snap = p1.received.find((m) => m.type === "snapshot");
		expect(snap?.type === "snapshot" && names(snap.entities)).toEqual([
			"Szene 1",
			"Persistent",
		]);
	});
});
