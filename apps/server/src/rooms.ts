import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Identity } from "@mistwarden/protocol";
import type { Db } from "./db/connection.ts";

// Anlegen von Räumen und Sitzungen. Login und Spieler-Link (Schritt 2) bauen
// darauf auf; bis dahin erzeugt `npm run dev:seed` die Sitzungen.

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** 256 Bit Zufall, URL-sicher. */
export function generateToken(): string {
	return randomBytes(32).toString("base64url");
}

export function createRoom(db: Db, name: string): string {
	const id = randomUUID();
	db.prepare("INSERT INTO rooms (id, name, created_at) VALUES (?, ?, ?)").run(
		id,
		name,
		Date.now(),
	);
	return id;
}

export function createPlayer(
	db: Db,
	roomId: string,
	displayName: string,
	color: string,
): string {
	const id = randomUUID();
	db.prepare(
		"INSERT INTO players (id, room_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)",
	).run(id, roomId, displayName, color, Date.now());
	return id;
}

/** Legt eine Sitzung an und gibt das Klartext-Token zurück (wird nur gehasht gespeichert). */
export function createSession(
	db: Db,
	roomId: string,
	identity: Identity,
): string {
	const token = generateToken();
	db.prepare(
		"INSERT INTO sessions (token_hash, room_id, role, player_id, created_at) VALUES (?, ?, ?, ?, ?)",
	).run(
		hashToken(token),
		roomId,
		identity.role,
		identity.role === "player" ? identity.playerId : null,
		Date.now(),
	);
	return token;
}

export interface Session {
	roomId: string;
	identity: Identity;
}

export function findSession(db: Db, token: string): Session | undefined {
	const tokenHash = hashToken(token);
	const row = db
		.prepare<
			[string],
			{ room_id: string; role: string; player_id: string | null }
		>("SELECT room_id, role, player_id FROM sessions WHERE token_hash = ?")
		.get(tokenHash);
	if (!row) return undefined;
	db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(
		Date.now(),
		tokenHash,
	);
	const identity: Identity =
		row.role === "gm" || row.player_id === null
			? { role: "gm" }
			: { role: "player", playerId: row.player_id };
	return { roomId: row.room_id, identity };
}
