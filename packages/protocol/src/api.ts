import { z } from "zod";
import { AudienceSchema, EntityKindSchema, IdSchema } from "./entities.ts";
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
	| "invalid_import"
	| "internal";

export interface ApiErrorResponse {
	error: ApiErrorCode;
}

/** Kennung und Version des Exportformats für Räume. */
export const ROOM_EXPORT_FORMAT = "mistwarden-room";
export const ROOM_EXPORT_VERSION = 1;

/**
 * Raum als Datei: Szenen, Raumzustand, Tokens, Fog, Zeichnungen, Notizen, Handouts und
 * die verwendeten Bilder als Original (Base64). Spieler, Sitzungen und das Würfel-Log
 * gehören nicht dazu. Die Nutzdaten prüft der Server beim Import wie jede Aktion.
 */
export const RoomExportSchema = z.object({
	format: z.literal(ROOM_EXPORT_FORMAT),
	version: z.literal(ROOM_EXPORT_VERSION),
	exportedAt: z.number().int().nonnegative(),
	room: z.object({ name: z.string().trim().min(1).max(100) }),
	entities: z
		.array(
			z.object({
				kind: EntityKindSchema,
				id: IdSchema,
				data: z.record(z.string(), z.unknown()),
				audience: AudienceSchema,
			}),
		)
		.max(100_000),
	assets: z
		.array(
			z.object({
				id: IdSchema,
				name: z.string().max(200),
				purpose: z.enum(["map", "token"]),
				/** Originaldatei als Base64. */
				data: z.string().min(1),
			}),
		)
		.max(10_000),
});
export type RoomExport = z.infer<typeof RoomExportSchema>;
