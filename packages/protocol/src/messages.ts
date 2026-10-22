import { z } from "zod";
import {
	AudienceSchema,
	type Entity,
	EntityKindSchema,
	IdSchema,
} from "./entities.ts";

export const PROTOCOL_VERSION = 1;

/** Größte erlaubte WebSocket-Nachricht in Bytes. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

const PayloadSchema = z.record(z.string(), z.unknown());

export const ActionSchema = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("create"),
		kind: EntityKindSchema,
		id: IdSchema,
		data: PayloadSchema,
		audience: AudienceSchema.optional(),
	}),
	z.object({
		op: z.literal("update"),
		kind: EntityKindSchema,
		id: IdSchema,
		patch: PayloadSchema.optional(),
		audience: AudienceSchema.optional(),
	}),
	z.object({
		op: z.literal("delete"),
		kind: EntityKindSchema,
		id: IdSchema,
	}),
]);
export type Action = z.infer<typeof ActionSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hello"),
		protocol: z.literal(PROTOCOL_VERSION),
		token: z.string().min(1).max(200),
		/** Zuletzt gesehene Raumversion; null holt den kompletten Stand. */
		lastVersion: z.number().int().nonnegative().nullable(),
	}),
	z.object({
		type: z.literal("action"),
		/** Vom Client vergeben; erneutes Senden nach Reconnect wird erkannt. */
		actionId: IdSchema,
		action: ActionSchema,
	}),
	z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type Identity = { role: "gm" } | { role: "player"; playerId: string };

export type Change =
	| { version: number; op: "upsert"; entity: Entity }
	| { version: number; op: "delete"; kind: Entity["kind"]; id: string };

export type RejectReason = "invalid" | "forbidden" | "not_found" | "exists";

export type ErrorCode =
	| "bad_message"
	| "unauthorized"
	| "protocol"
	| "hello_timeout";

export type ServerMessage =
	| { type: "welcome"; roomId: string; identity: Identity; version: number }
	| { type: "snapshot"; version: number; entities: Entity[] }
	/** version ist die Raumversion nach diesen Änderungen, auch wenn verdeckte fehlen. */
	| { type: "changes"; version: number; changes: Change[] }
	| { type: "ack"; actionId: string; version: number }
	| { type: "reject"; actionId: string; reason: RejectReason }
	| { type: "error"; code: ErrorCode; message: string }
	| { type: "pong" };

/** Close-Codes, nach denen der Client nicht automatisch neu verbindet. */
export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_PROTOCOL = 4002;
