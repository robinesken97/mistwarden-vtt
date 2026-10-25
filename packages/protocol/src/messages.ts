import { z } from "zod";
import { MAX_FORMULA_LENGTH } from "./dice.ts";
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
		/** Raum, den die GM betreten will; bei Spielern optional (ergibt sich aus der Sitzung). */
		roomId: IdSchema.optional(),
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
	/** Würfeln: der Client schickt nur die Formel, der Server würfelt und schreibt ins Log. */
	z.object({
		type: z.literal("roll"),
		actionId: IdSchema,
		formula: z.string().max(MAX_FORMULA_LENGTH),
		/** Verdeckt würfeln darf nur die GM. */
		hidden: z.boolean(),
	}),
	/** Flüchtiger Ping auf einer Szene; landet nicht im Änderungslog. */
	z.object({
		type: z.literal("pointer"),
		sceneId: IdSchema,
		x: z.number().min(-100_000).max(100_000),
		y: z.number().min(-100_000).max(100_000),
	}),
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
	| {
			type: "welcome";
			roomId: string;
			roomName: string;
			identity: Identity;
			version: number;
	  }
	| { type: "snapshot"; version: number; entities: Entity[] }
	/** version ist die Raumversion nach diesen Änderungen, auch wenn verdeckte fehlen. */
	| { type: "changes"; version: number; changes: Change[] }
	| { type: "ack"; actionId: string; version: number }
	| { type: "reject"; actionId: string; reason: RejectReason }
	| { type: "error"; code: ErrorCode; message: string }
	| { type: "pong" }
	/** Ping eines Spielers (playerId) oder der GM (null) für alle, die die Szene sehen. */
	| {
			type: "pointer";
			sceneId: string;
			x: number;
			y: number;
			playerId: string | null;
			color: string;
	  };

/** Close-Codes, nach denen der Client nicht automatisch neu verbindet. */
export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_PROTOCOL = 4002;
