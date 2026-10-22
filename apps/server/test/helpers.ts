import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ClientMessage,
	PROTOCOL_VERSION,
	type RoomSummary,
	type ServerMessage,
} from "@mistwarden/protocol";
import WebSocket from "ws";
import { type RunningServer, startServer } from "../src/app.ts";

export const TEST_GM_PASSWORD = "test-passwort-123";

export interface TestRoom {
	server: RunningServer;
	/** HTTP-Basis, z. B. http://127.0.0.1:1234 */
	http: string;
	/** WebSocket-Adresse */
	url: string;
	dbPath: string;
	roomId: string;
	gm: string;
	p1: { id: string; token: string };
	p2: { id: string; token: string };
	/** Raumversion nach dem Anlegen (Szene, Raumzustand, zwei Spieler). */
	baseVersion: number;
	/** Startet den Server mit derselben Datenbank neu. */
	restart(opts?: { gmPassword?: string }): Promise<void>;
	close(): Promise<void>;
}

export async function startTestServer(
	dbPath: string,
	gmPassword = TEST_GM_PASSWORD,
) {
	return startServer({
		host: "127.0.0.1",
		port: 0,
		databasePath: dbPath,
		gmPassword,
		trustProxy: false,
	});
}

/** JSON-Aufruf der HTTP-API; liefert Status und Antwort. */
export async function api<T = unknown>(
	base: string,
	path: string,
	opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
	const res = await fetch(base + path, {
		method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
		headers: {
			...(opts.body === undefined
				? {}
				: { "content-type": "application/json" }),
			...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
		},
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
	});
	return { status: res.status, body: (await res.json()) as T };
}

/**
 * Server auf freiem Port mit echter SQLite-Datei (WAL). Raum und Spieler entstehen
 * wie im Betrieb über die HTTP-API: GM-Login, Raum anlegen, zwei Spieler treten bei.
 */
export async function startTestRoom(): Promise<TestRoom> {
	const dir = mkdtempSync(join(tmpdir(), "mistwarden-test-"));
	const dbPath = join(dir, "test.sqlite");
	const server = await startTestServer(dbPath);
	const http = `http://127.0.0.1:${server.port}`;

	const login = await api<{ token: string }>(http, "/api/gm/login", {
		body: { password: TEST_GM_PASSWORD },
	});
	const gm = login.body.token;
	const created = await api<RoomSummary>(http, "/api/rooms", {
		token: gm,
		body: { name: "Testraum" },
	});
	const joinAs = async (displayName: string) => {
		const res = await api<{ token: string; playerId: string }>(
			http,
			"/api/join",
			{
				body: { linkToken: created.body.playerLinkToken, displayName },
			},
		);
		return { id: res.body.playerId, token: res.body.token };
	};

	const room: TestRoom = {
		server,
		http,
		url: `ws://127.0.0.1:${server.port}/ws`,
		dbPath,
		roomId: created.body.id,
		gm,
		p1: await joinAs("Eins"),
		p2: await joinAs("Zwei"),
		baseVersion: 4,
		async restart(opts = {}) {
			await room.server.close();
			room.server = await startTestServer(dbPath, opts.gmPassword);
			room.http = `http://127.0.0.1:${room.server.port}`;
			room.url = `ws://127.0.0.1:${room.server.port}/ws`;
		},
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
		opts: { roomId?: string; lastVersion?: number | null } = {},
	): Promise<RawClient> {
		const c = await RawClient.open(url);
		c.hello(token, opts);
		await c.next("welcome");
		await c.nextOf(["snapshot", "changes"]);
		return c;
	}

	hello(
		token: string,
		opts: { roomId?: string; lastVersion?: number | null } = {},
	): void {
		this.send({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token,
			...(opts.roomId ? { roomId: opts.roomId } : {}),
			lastVersion: opts.lastVersion ?? null,
		});
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
