import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	type Action,
	type Identity,
	ROOM_STATE_ID,
	type RoomSummary,
} from "@mistwarden/protocol";
import type { Db } from "./db/connection.ts";

/** Höchstzahl Spieler pro Raum; schützt vor endlosem Beitreten über einen geleakten Link. */
export const MAX_PLAYERS_PER_ROOM = 32;

/** Spielerfarben in Beitrittsreihenfolge. */
const PLAYER_COLORS = [
	"#e4572e",
	"#17bebb",
	"#ffc914",
	"#76b041",
	"#9b5de5",
	"#f15bb5",
	"#2e86ab",
	"#f18f01",
];

/** Führt eine Aktion im Namen des Servers aus (mit GM-Rechten) und verteilt sie. */
export type ApplySystemAction = (roomId: string, action: Action) => void;

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** 256 Bit Zufall, URL-sicher. */
export function generateToken(): string {
	return randomBytes(32).toString("base64url");
}

// --- Sitzungen ---

export function createGmSession(db: Db): string {
	const token = generateToken();
	db.prepare(
		"INSERT INTO sessions (token_hash, role, created_at) VALUES (?, 'gm', ?)",
	).run(hashToken(token), Date.now());
	return token;
}

export function createPlayerSession(
	db: Db,
	roomId: string,
	playerId: string,
): string {
	const token = generateToken();
	db.prepare(
		"INSERT INTO sessions (token_hash, role, room_id, player_id, created_at) VALUES (?, 'player', ?, ?, ?)",
	).run(hashToken(token), roomId, playerId, Date.now());
	return token;
}

export function deleteSession(db: Db, token: string): void {
	db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export interface Session {
	identity: Identity;
	/** Raum der Spieler-Sitzung; null bei der GM (Zugang zu allen Räumen). */
	roomId: string | null;
}

export function findSession(db: Db, token: string): Session | undefined {
	const tokenHash = hashToken(token);
	const row = db
		.prepare<
			[string],
			{ role: string; room_id: string | null; player_id: string | null }
		>("SELECT role, room_id, player_id FROM sessions WHERE token_hash = ?")
		.get(tokenHash);
	if (!row) return undefined;
	db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(
		Date.now(),
		tokenHash,
	);
	if (row.role === "player" && row.room_id && row.player_id) {
		return {
			identity: { role: "player", playerId: row.player_id },
			roomId: row.room_id,
		};
	}
	return { identity: { role: "gm" }, roomId: null };
}

// --- Räume ---

interface RoomRow {
	id: string;
	name: string;
	player_link_token: string;
	created_at: number;
}

function toSummary(r: RoomRow): RoomSummary {
	return {
		id: r.id,
		name: r.name,
		createdAt: r.created_at,
		playerLinkToken: r.player_link_token,
	};
}

/** Legt einen Raum mit einer ersten, aktiven Szene an. */
export function createRoom(
	db: Db,
	apply: ApplySystemAction,
	name: string,
): RoomSummary {
	return db.transaction(() => {
		const id = randomUUID();
		const createdAt = Date.now();
		const token = generateToken();
		db.prepare(
			"INSERT INTO rooms (id, name, player_link_token, created_at) VALUES (?, ?, ?, ?)",
		).run(id, name, token, createdAt);
		const sceneId = randomUUID();
		apply(id, {
			op: "create",
			kind: "scene",
			id: sceneId,
			data: { name: "Szene 1", order: 0 },
		});
		apply(id, {
			op: "create",
			kind: "roomState",
			id: ROOM_STATE_ID,
			data: { activeSceneId: sceneId },
		});
		return { id, name, createdAt, playerLinkToken: token };
	})();
}

export function listRooms(db: Db): RoomSummary[] {
	return db
		.prepare<[], RoomRow>(
			"SELECT id, name, player_link_token, created_at FROM rooms ORDER BY created_at",
		)
		.all()
		.map(toSummary);
}

export function getRoom(db: Db, id: string): RoomSummary | undefined {
	const row = db
		.prepare<[string], RoomRow>(
			"SELECT id, name, player_link_token, created_at FROM rooms WHERE id = ?",
		)
		.get(id);
	return row && toSummary(row);
}

export function findRoomByLink(
	db: Db,
	linkToken: string,
): RoomSummary | undefined {
	const row = db
		.prepare<[string], RoomRow>(
			"SELECT id, name, player_link_token, created_at FROM rooms WHERE player_link_token = ?",
		)
		.get(linkToken);
	return row && toSummary(row);
}

/** Neuer Spieler-Link; der alte wird ungültig. Bestehende Spieler-Sitzungen bleiben erhalten. */
export function regeneratePlayerLink(
	db: Db,
	roomId: string,
): string | undefined {
	const token = generateToken();
	const result = db
		.prepare("UPDATE rooms SET player_link_token = ? WHERE id = ?")
		.run(token, roomId);
	return result.changes > 0 ? token : undefined;
}

// --- Spieler ---

export type JoinResult =
	| { status: "joined"; roomId: string; playerId: string; token: string }
	| { status: "not_found" }
	| { status: "room_full" };

/** Spieler tritt über den Spieler-Link bei: Spieler, Sitzung und Spielerobjekt im Raum. */
export function joinRoom(
	db: Db,
	apply: ApplySystemAction,
	linkToken: string,
	displayName: string,
): JoinResult {
	return db.transaction((): JoinResult => {
		const room = findRoomByLink(db, linkToken);
		if (!room) return { status: "not_found" };
		const count = db
			.prepare<[string], { n: number }>(
				"SELECT COUNT(*) AS n FROM players WHERE room_id = ?",
			)
			.get(room.id)?.n as number;
		if (count >= MAX_PLAYERS_PER_ROOM) return { status: "room_full" };

		const playerId = randomUUID();
		const color = PLAYER_COLORS[count % PLAYER_COLORS.length] as string;
		db.prepare(
			"INSERT INTO players (id, room_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)",
		).run(playerId, room.id, displayName, color, Date.now());
		apply(room.id, {
			op: "create",
			kind: "player",
			id: playerId,
			data: { name: displayName, color },
		});
		const token = createPlayerSession(db, room.id, playerId);
		return { status: "joined", roomId: room.id, playerId, token };
	})();
}
