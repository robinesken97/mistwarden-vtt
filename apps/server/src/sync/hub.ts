import {
	type Action,
	type Change,
	CLOSE_PROTOCOL,
	CLOSE_UNAUTHORIZED,
	ClientMessageSchema,
	type ErrorCode,
	type Identity,
	type ServerMessage,
} from "@mistwarden/protocol";
import type { WebSocket, WebSocketServer } from "ws";
import type { Db } from "../db/connection.ts";
import { findSession } from "../rooms.ts";
import { ChangeLog } from "./changelog.ts";
import {
	canSee,
	filterChange,
	type StoredChange,
	toWireEntity,
} from "./visibility.ts";

const HELLO_TIMEOUT_MS = 10_000;
/** Abstand der Protokoll-Pings, mit denen tote Verbindungen erkannt werden. */
const HEARTBEAT_MS = 30_000;

interface Connection {
	ws: WebSocket;
	roomId: string;
	identity: Identity;
	alive: boolean;
}

/**
 * Verwaltet die WebSocket-Verbindungen aller Räume: Anmeldung per Sitzungs-Token,
 * Nachholen nach Reconnect, Annahme von Aktionen und gefilterte Verteilung.
 */
export class Hub {
	readonly #changelog: ChangeLog;
	readonly #db: Db;
	readonly #rooms = new Map<string, Set<Connection>>();
	readonly #heartbeat: NodeJS.Timeout;
	readonly #wss: WebSocketServer;

	constructor(db: Db, wss: WebSocketServer) {
		this.#db = db;
		this.#wss = wss;
		this.#changelog = new ChangeLog(db);
		wss.on("connection", (ws) => this.#onConnection(ws));
		this.#heartbeat = setInterval(() => this.#checkAlive(), HEARTBEAT_MS);
	}

	close(): void {
		clearInterval(this.#heartbeat);
		for (const ws of this.#wss.clients) ws.terminate();
	}

	#onConnection(ws: WebSocket): void {
		let conn: Connection | undefined;
		const helloTimer = setTimeout(() => {
			sendError(ws, "hello_timeout", "Keine Anmeldung erhalten");
			ws.close(CLOSE_PROTOCOL);
		}, HELLO_TIMEOUT_MS);

		ws.on("pong", () => {
			if (conn) conn.alive = true;
		});
		ws.on("close", () => {
			clearTimeout(helloTimer);
			if (conn) this.#rooms.get(conn.roomId)?.delete(conn);
		});
		ws.on("error", () => ws.terminate());
		ws.on("message", (raw, isBinary) => {
			const parsed = isBinary ? null : parseJson(raw.toString());
			const result = ClientMessageSchema.safeParse(parsed);
			if (!result.success) {
				sendError(ws, "bad_message", "Ungültige Nachricht");
				return;
			}
			const msg = result.data;

			if (msg.type === "ping") {
				send(ws, { type: "pong" });
				return;
			}
			if (msg.type === "hello") {
				if (conn) {
					sendError(ws, "protocol", "Bereits angemeldet");
					return;
				}
				clearTimeout(helloTimer);
				conn = this.#hello(ws, msg.token, msg.lastVersion);
				return;
			}
			if (!conn) {
				sendError(ws, "protocol", "Erst anmelden");
				ws.close(CLOSE_PROTOCOL);
				return;
			}
			this.#action(conn, msg.actionId, msg.action);
		});
	}

	#hello(
		ws: WebSocket,
		token: string,
		lastVersion: number | null,
	): Connection | undefined {
		const session = findSession(this.#db, token);
		if (!session) {
			sendError(ws, "unauthorized", "Sitzung ungültig");
			ws.close(CLOSE_UNAUTHORIZED);
			return undefined;
		}
		const { roomId, identity } = session;
		const version = this.#changelog.version(roomId);
		send(ws, { type: "welcome", roomId, identity, version });

		const missed =
			lastVersion === null ? null : this.#changelog.since(roomId, lastVersion);
		if (missed === null) {
			const entities = this.#changelog
				.entities(roomId)
				.filter((e) => canSee(identity, e.audience))
				.map((e) => toWireEntity(identity, e));
			send(ws, { type: "snapshot", version, entities });
		} else {
			send(ws, {
				type: "changes",
				version,
				changes: filterAll(identity, missed),
			});
		}

		// Alles synchron: zwischen Nachholen und Registrieren kann keine Änderung durchrutschen.
		const conn: Connection = { ws, roomId, identity, alive: true };
		let room = this.#rooms.get(roomId);
		if (!room) {
			room = new Set();
			this.#rooms.set(roomId, room);
		}
		room.add(conn);
		return conn;
	}

	#action(conn: Connection, actionId: string, action: Action): void {
		const result = this.#changelog.apply(
			conn.roomId,
			conn.identity,
			actionId,
			action,
		);
		switch (result.status) {
			case "rejected":
				send(conn.ws, { type: "reject", actionId, reason: result.reason });
				return;
			case "duplicate":
				// Erneut gesendet nach Reconnect; die Änderung kam bereits beim Nachholen an.
				send(conn.ws, { type: "ack", actionId, version: result.version });
				return;
			case "applied":
				this.#broadcast(conn.roomId, result.version, result.changes);
				send(conn.ws, { type: "ack", actionId, version: result.version });
		}
	}

	#broadcast(roomId: string, version: number, changes: StoredChange[]): void {
		for (const conn of this.#rooms.get(roomId) ?? []) {
			const visible = filterAll(conn.identity, changes);
			if (visible.length > 0) {
				send(conn.ws, { type: "changes", version, changes: visible });
			}
		}
	}

	#checkAlive(): void {
		for (const room of this.#rooms.values()) {
			for (const conn of room) {
				if (!conn.alive) {
					conn.ws.terminate();
					continue;
				}
				conn.alive = false;
				conn.ws.ping();
			}
		}
	}
}

function filterAll(identity: Identity, changes: StoredChange[]): Change[] {
	return changes.flatMap((c) => filterChange(identity, c) ?? []);
}

function send(ws: WebSocket, msg: ServerMessage): void {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, code: ErrorCode, message: string): void {
	send(ws, { type: "error", code, message });
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
