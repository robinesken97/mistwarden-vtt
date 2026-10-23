import { z } from "zod";
import type { Identity } from "./messages.ts";

// HTTP-API für Anmeldung und Raumverwaltung. Alles Spielgeschehen läuft über den WebSocket.
// Authentifizierung per `Authorization: Bearer <Sitzungs-Token>`.

export const GmLoginRequestSchema = z.object({
	password: z.string().min(1).max(200),
});
export interface GmLoginResponse {
	token: string;
}

export const CreateRoomRequestSchema = z.object({
	name: z.string().trim().min(1).max(100),
});

export interface RoomSummary {
	id: string;
	name: string;
	createdAt: number;
	/** Geheimer Teil des Spieler-Links: `<Basis-URL>/join#<playerLinkToken>`. */
	playerLinkToken: string;
}

export const LinkRequestSchema = z.object({
	linkToken: z.string().min(1).max(200),
});
export interface LinkInfoResponse {
	roomId: string;
	roomName: string;
}

export const JoinRequestSchema = LinkRequestSchema.extend({
	displayName: z.string().trim().min(1).max(32),
});
export interface JoinResponse {
	token: string;
	roomId: string;
	playerId: string;
}

export interface SessionResponse {
	identity: Identity;
	/** Bei Spielern der Raum der Sitzung; die GM hat Zugang zu allen Räumen. */
	roomId: string | null;
}

export type ApiErrorCode =
	| "bad_request"
	| "unauthorized"
	| "forbidden"
	| "not_found"
	| "too_many_requests"
	| "room_full"
	| "unsupported"
	| "too_large"
	| "internal";

export interface ApiErrorResponse {
	error: ApiErrorCode;
}
