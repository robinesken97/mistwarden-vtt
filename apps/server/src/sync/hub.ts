import { randomInt, randomUUID } from "node:crypto";
import {
	type Action,
	AUDIENCE_ALL,
	type Change,
	CLOSE_PROTOCOL,
	CLOSE_UNAUTHORIZED,
	ClientMessageSchema,
	type ErrorCode,
	GM_COLOR,
	type Identity,
	type PlayerData,
	parseDice,
	type RollData,
	rollDice,
	type ServerMessage,
} from "@mistwarden/protocol";
import type { WebSocket, WebSocketServer } from "ws";
import type { Db } from "../db/connection.ts";
import { findSession, getRoom } from "../rooms.ts";
import type { ChangeLog } from "./changelog.ts";
import {
	canSee,
	filterChange,
	type StoredChange,
	toWireEntity,
} from "./visibility.ts";

const HELLO_TIMEOUT_MS = 10_000;
/** Abstand der Protokoll-Pings, mit denen tote Verbindungen erkannt werden. */
const HEARTBEAT_MS = 30_000;
/** Pings pro Verbindung: so viele auf einmal, danach einer je POINTER_REFILL_MS. */
export const POINTER_BURST = 4;
const POINTER_REFILL_MS = 250;

interface Connection {
	ws: WebSocket;
	roomId: string;
	identity: Identity;
	alive: boolean;
	pointer: { tokens: number; at: number };
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

	constructor(db: Db, wss: WebSocketServer, changelog: ChangeLog) {
		this.#db = db;
		this.#wss = wss;
		this.#changelog = changelog;
		wss.on("connection", (ws) => this.#onConnection(ws));
		this.#heartbeat = setInterval(() => this.#checkAlive(), HEARTBEAT_MS);
	}

	/**
	 * Führt eine Aktion serverseitig mit GM-Rechten aus (z. B. beim Anlegen eines
	 * Raums oder Beitritt eines Spielers) und verteilt sie an alle Verbundenen.
	 */
	applySystem(roomId: string, action: Action): void {
		const result = this.#changelog.apply(
			roomId,
			{ role: "gm" },
			randomUUID(),
			action,
		);
		if (result.status === "rejected") {
			throw new Error(`Systemaktion abgelehnt: ${result.reason}`);
		}
		if (result.status === "applied") {
			this.#broadcast(roomId, result.version, result.changes);
		}
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
				conn = this.#hello(ws, msg.token, msg.roomId, msg.lastVersion);
				return;
			}
			if (!conn) {
				sendError(ws, "protocol", "Erst anmelden");
				ws.close(CLOSE_PROTOCOL);
				return;
			}
			switch (msg.type) {
				case "action":
					this.#action(conn, msg.actionId, msg.action);
					return;
				case "roll":
					this.#roll(conn, msg.actionId, msg.formula, msg.hidden);
					return;
				case "pointer":
					this.#pointer(conn, msg.sceneId, msg.x, msg.y);
			}
		});
	}

	#hello(
		ws: WebSocket,
		token: string,
		requestedRoomId: string | undefined,
		lastVersion: number | null,
	): Connection | undefined {
		const session = findSession(this.#db, token);
		// Spieler sind an ihren Raum gebunden; die GM wählt den Raum.
		const roomId = session?.roomId ?? requestedRoomId;
		const room = roomId === undefined ? undefined : getRoom(this.#db, roomId);
		if (
			!session ||
			!room ||
			(requestedRoomId !== undefined && requestedRoomId !== room.id)
		) {
			sendError(
				ws,
				"unauthorized",
				"Sitzung ungültig oder kein Zugang zum Raum",
			);
			ws.close(CLOSE_UNAUTHORIZED);
			return undefined;
		}
		const { identity } = session;
		const version = this.#changelog.version(room.id);
		send(ws, {
			type: "welcome",
			roomId: room.id,
			roomName: room.name,
			identity,
			version,
		});

		const missed =
			lastVersion === null ? null : this.#changelog.since(room.id, lastVersion);
		if (missed === null) {
			const entities = this.#changelog
				.entities(room.id)
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
		const conn: Connection = {
			ws,
			roomId: room.id,
			identity,
			alive: true,
			pointer: { tokens: POINTER_BURST, at: Date.now() },
		};
		let conns = this.#rooms.get(room.id);
		if (!conns) {
			conns = new Set();
			this.#rooms.set(room.id, conns);
		}
		conns.add(conn);
		return conn;
	}

	#action(
		conn: Connection,
		actionId: string,
		action: Action,
		trusted = false,
	): void {
		const result = this.#changelog.apply(
			conn.roomId,
			conn.identity,
			actionId,
			action,
			{ trusted },
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

	/** Würfelt serverseitig mit kryptografischem Zufall und legt den Wurf im Log ab. */
	#roll(
		conn: Connection,
		actionId: string,
		formula: string,
		hidden: boolean,
	): void {
		const parsed = parseDice(formula);
		if (!parsed.ok) {
			send(conn.ws, { type: "reject", actionId, reason: "invalid" });
			return;
		}
		const { terms, total } = rollDice(parsed.terms, (sides) =>
			randomInt(1, sides + 1),
		);
		const data: RollData = {
			authorId: conn.identity.role === "gm" ? null : conn.identity.playerId,
			formula: parsed.formula,
			terms,
			total,
			hidden,
			at: Date.now(),
		};
		this.#action(
			conn,
			actionId,
			{
				op: "create",
				kind: "roll",
				id: randomUUID(),
				data,
				audience: hidden ? { type: "gm" } : AUDIENCE_ALL,
			},
			true,
		);
	}

	/** Verteilt einen Ping an alle, die die Szene sehen; zu viele werden verworfen. */
	#pointer(conn: Connection, sceneId: string, x: number, y: number): void {
		const now = Date.now();
		const bucket = conn.pointer;
		bucket.tokens = Math.min(
			POINTER_BURST,
			bucket.tokens + (now - bucket.at) / POINTER_REFILL_MS,
		);
		bucket.at = now;
		if (bucket.tokens < 1) return;
		bucket.tokens -= 1;

		const scene = this.#changelog.get(conn.roomId, "scene", sceneId);
		if (!scene || !canSee(conn.identity, scene.audience)) return;
		let playerId: string | null = null;
		let color = GM_COLOR;
		if (conn.identity.role === "player") {
			playerId = conn.identity.playerId;
			const player = this.#changelog.get(conn.roomId, "player", playerId);
			color = (player?.data as PlayerData | undefined)?.color ?? GM_COLOR;
		}
		const msg: ServerMessage = {
			type: "pointer",
			sceneId,
			x: Math.round(x),
			y: Math.round(y),
			playerId,
			color,
		};
		for (const other of this.#rooms.get(conn.roomId) ?? []) {
			if (canSee(other.identity, scene.audience)) send(other.ws, msg);
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
