import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ClientMessage,
	PROTOCOL_VERSION,
	type ServerMessage,
} from "@mistwarden/protocol";
import WebSocket from "ws";
import {
	createPlayer,
	createRoom,
	createSession,
	type RunningServer,
	startServer,
} from "../src/app.ts";

export interface TestRoom {
	server: RunningServer;
	url: string;
	roomId: string;
	gm: string;
	p1: { id: string; token: string };
	p2: { id: string; token: string };
	close(): Promise<void>;
}

/** Server auf freiem Port mit echter SQLite-Datei (WAL) und einem Raum: GM + 2 Spieler. */
export async function startTestRoom(): Promise<TestRoom> {
	const dir = mkdtempSync(join(tmpdir(), "mistwarden-test-"));
	const server = await startServer({
		host: "127.0.0.1",
		port: 0,
		databasePath: join(dir, "test.sqlite"),
	});
	const { db } = server;
	const roomId = createRoom(db, "Testraum");
	const gm = createSession(db, roomId, { role: "gm" });
	const player = (name: string) => {
		const id = createPlayer(db, roomId, name, "#888888");
		return {
			id,
			token: createSession(db, roomId, { role: "player", playerId: id }),
		};
	};
	const room: TestRoom = {
		server,
		url: `ws://127.0.0.1:${server.port}/ws`,
		roomId,
		gm,
		p1: player("Eins"),
		p2: player("Zwei"),
		async close() {
			await room.server.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
	return room;
}

/** Roh-Client fürs Protokoll: zeichnet alle Nachrichten auf und wartet gezielt auf sie. */
export class RawClient {
	readonly received: ServerMessage[] = [];
	readonly raw: string[] = [];
	readonly ws: WebSocket;
	/** Noch nicht per next/nextOf/drain abgeholte Nachrichten. */
	#unread: ServerMessage[] = [];
	#waiters: (() => void)[] = [];
	closed: Promise<number>;

	private constructor(url: string) {
		this.ws = new WebSocket(url);
		this.ws.on("message", (data) => {
			const text = data.toString();
			this.raw.push(text);
			const msg = JSON.parse(text) as ServerMessage;
			this.received.push(msg);
			this.#unread.push(msg);
			for (const w of this.#waiters.splice(0)) w();
		});
		this.closed = new Promise((resolve) => this.ws.on("close", resolve));
	}

	static async open(url: string): Promise<RawClient> {
		const c = new RawClient(url);
		await new Promise((resolve, reject) => {
			c.ws.once("open", resolve);
			c.ws.once("error", reject);
		});
		return c;
	}

	/** Öffnet, meldet sich an und wartet auf den Anfangszustand (snapshot/changes). */
	static async join(
		url: string,
		token: string,
		lastVersion: number | null = null,
	): Promise<RawClient> {
		const c = await RawClient.open(url);
		c.send({ type: "hello", protocol: PROTOCOL_VERSION, token, lastVersion });
		await c.next("welcome");
		await c.nextOf(["snapshot", "changes"]);
		return c;
	}

	send(msg: ClientMessage | Record<string, unknown>): void {
		this.ws.send(JSON.stringify(msg));
	}

	next<T extends ServerMessage["type"]>(
		type: T,
		timeoutMs = 2000,
	): Promise<Extract<ServerMessage, { type: T }>> {
		return this.nextOf([type], timeoutMs) as Promise<
			Extract<ServerMessage, { type: T }>
		>;
	}

	/** Älteste noch nicht abgeholte Nachricht eines der Typen; andere bleiben liegen. */
	async nextOf(
		types: ServerMessage["type"][],
		timeoutMs = 2000,
	): Promise<ServerMessage> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const i = this.#unread.findIndex((m) => types.includes(m.type));
			if (i >= 0) return this.#unread.splice(i, 1)[0] as ServerMessage;
			const remaining = deadline - Date.now();
			if (remaining <= 0)
				throw new Error(`Keine Nachricht vom Typ ${types.join("/")}`);
			await new Promise<void>((resolve) => {
				const t = setTimeout(resolve, remaining);
				this.#waiters.push(() => {
					clearTimeout(t);
					resolve();
				});
			});
		}
	}

	/** Wartet kurz und liefert alles, was in der Zeit ankam. */
	async drain(ms = 100): Promise<ServerMessage[]> {
		await new Promise((r) => setTimeout(r, ms));
		return this.#unread.splice(0);
	}

	close(): void {
		this.ws.close();
	}
}
