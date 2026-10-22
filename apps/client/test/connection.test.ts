import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestRoom, type TestRoom } from "../../server/test/helpers.ts";
import { ActionRejected, SyncConnection } from "../src/net/connection.ts";

// Läuft in Node gegen einen echten Server; Node 24 bringt WebSocket global mit.

/** WebSocket, dem man im Test das Gehör abdrehen kann. */
class TestSocket extends WebSocket {
	static instances: TestSocket[] = [];
	deaf = false;

	constructor(url: string | URL, protocols?: string | string[]) {
		super(url, protocols);
		TestSocket.instances.push(this);
		this.addEventListener("message", (e) => {
			if (this.deaf) e.stopImmediatePropagation();
		});
	}

	static last(): TestSocket {
		const s = TestSocket.instances.at(-1);
		if (!s) throw new Error("Kein Socket");
		return s;
	}
}

let room: TestRoom;
const conns: SyncConnection[] = [];

beforeEach(async () => {
	room = await startTestRoom();
});

afterEach(async () => {
	for (const c of conns.splice(0)) c.stop();
	await room.close();
});

function connect(
	token: string,
	opts: Partial<ConstructorParameters<typeof SyncConnection>[0]> = {},
) {
	const c = new SyncConnection({
		url: room.url,
		token,
		// Die GM wählt den Raum; Spieler sind an ihren Raum gebunden.
		...(token === room.gm ? { roomId: room.roomId } : {}),
		maxBackoffMs: 200,
		...opts,
	});
	conns.push(c);
	c.start();
	return c;
}

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("Bedingung nicht erfüllt");
		await new Promise((r) => setTimeout(r, 10));
	}
}

const scene = (name: string) =>
	({
		op: "create",
		kind: "scene",
		id: randomUUID(),
		data: { name, order: 1 },
	}) as const;

/** Namen aller Szenen außer der Anfangsszene „Szene 1“. */
const names = (c: SyncConnection) =>
	[...c.entities.values()]
		.filter((e) => e.kind === "scene" && e.data.name !== "Szene 1")
		.map((e) => e.data.name)
		.sort();

describe("SyncConnection", () => {
	it("spiegelt Änderungen der GM bei den Spielern", async () => {
		const gm = connect(room.gm);
		const p1 = connect(room.p1.token);
		await until(() => gm.status === "online" && p1.status === "online");
		expect(p1.identity).toEqual({ role: "player", playerId: room.p1.id });

		const v = room.baseVersion;
		expect(await gm.send(scene("Burg"))).toBe(v + 1);
		await until(() => names(p1).length === 1);
		expect(names(p1)).toEqual(["Burg"]);
		expect(p1.version).toBe(v + 1);
		expect(p1.roomName).toBe("Testraum");
	});

	it("meldet abgelehnte Aktionen", async () => {
		const p1 = connect(room.p1.token);
		await until(() => p1.status === "online");
		await expect(p1.send(scene("Nein"))).rejects.toBeInstanceOf(ActionRejected);
	});

	it("verbindet nach Abbruch neu und holt Verpasstes nach", async () => {
		const gm = connect(room.gm);
		const p1 = connect(room.p1.token, { WebSocket: TestSocket });
		await until(() => gm.status === "online" && p1.status === "online");
		await gm.send(scene("Vorher"));
		await until(() => names(p1).length === 1);

		TestSocket.last().deaf = true; // nichts mehr verarbeiten, wie bei Displaysperre
		await gm.send(scene("Verpasst"));
		TestSocket.last().close();
		await until(() => p1.status === "offline");
		await until(() => p1.status === "online" && names(p1).length === 2);
		expect(names(p1)).toEqual(["Verpasst", "Vorher"]);
		expect(p1.version).toBe(room.baseVersion + 2);
	});

	it("sendet Aktionen ohne Bestätigung nach Reconnect erneut, ohne Doppelung", async () => {
		const gm = connect(room.gm, { WebSocket: TestSocket });
		await until(() => gm.status === "online");

		// Server wendet die Aktion an, aber das ack geht verloren.
		TestSocket.last().deaf = true;
		const pending = gm.send(scene("Einmal"));
		await new Promise((r) => setTimeout(r, 50));
		TestSocket.last().close();

		expect(await pending).toBe(room.baseVersion + 1);
		expect(names(gm)).toEqual(["Einmal"]);
		expect(gm.version).toBe(room.baseVersion + 1);
	});

	it("hält Aktionen zurück, solange keine Verbindung besteht", async () => {
		const gm = connect(room.gm);
		await until(() => gm.status === "online");
		gm.stop();
		const pending = gm.send(scene("Offline angelegt"));
		gm.start();
		expect(await pending).toBe(room.baseVersion + 1);
		await until(() => names(gm).length === 1);
	});

	it("erkennt stumme Verbindungen und verbindet selbst neu", async () => {
		const gm = connect(room.gm);
		const p1 = connect(room.p1.token, {
			WebSocket: TestSocket,
			staleAfterMs: 300,
			pingEveryMs: 100,
		});
		await until(() => gm.status === "online" && p1.status === "online");

		// Socket bleibt formal offen, liefert aber nichts mehr (typisch für Safari nach dem Aufwachen).
		const dead = TestSocket.last();
		dead.deaf = true;
		await gm.send(scene("Nach dem Verstummen"));
		await until(() => TestSocket.last() !== dead && names(p1).length === 1);
	});

	it("gibt bei ungültiger Sitzung auf", async () => {
		const c = connect("ungueltig");
		await until(() => c.status === "unauthorized");
	});
});
