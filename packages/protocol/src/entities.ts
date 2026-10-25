import { z } from "zod";

/** IDs werden vom Client erzeugt (crypto.randomUUID) und serverseitig geprüft. */
export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * Wer ein Objekt sehen darf. Die GM sieht immer alles.
 * Objekte, die ein Spieler nicht sehen darf, werden an ihn gar nicht ausgeliefert.
 */
export const AudienceSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("all") }),
	z.object({ type: z.literal("gm") }),
	z.object({
		type: z.literal("players"),
		playerIds: z.array(IdSchema).max(64),
	}),
]);
export type Audience = z.infer<typeof AudienceSchema>;

export const AUDIENCE_ALL: Audience = { type: "all" };

/** Höchstzahl Koordinaten (x und y zählen einzeln) pro Fog-Form. */
export const MAX_FOG_COORDS = 40_000;

/**
 * Grid in Kartenpixeln (Stufe 0 der Karte). Die Karte liegt fest im Ursprung;
 * das Grid wird an die Karte angepasst, nicht umgekehrt.
 * - square: Quadrate mit Kantenlänge `size`
 * - hexPointy: Hexfelder mit Spitze oben, Breite `size`
 * - hexFlat: Hexfelder mit flacher Oberseite, Höhe `size`
 */
export const GridSchema = z.strictObject({
	type: z.enum(["square", "hexPointy", "hexFlat"]),
	size: z.number().min(8).max(2000),
	offsetX: z.number().min(-4000).max(4000),
	offsetY: z.number().min(-4000).max(4000),
	visible: z.boolean(),
});
export type GridData = z.infer<typeof GridSchema>;

export const DEFAULT_GRID: GridData = {
	type: "square",
	size: 100,
	offsetX: 0,
	offsetY: 0,
	visible: true,
};

export const SceneSchema = z.strictObject({
	name: z.string().trim().min(1).max(100),
	/** Reihenfolge in der Szenenliste. */
	order: z.number().int().min(0).max(1_000_000_000),
	/** Asset-ID des Kartenbilds oder null für eine leere Szene. */
	map: IdSchema.nullable().default(null),
	grid: GridSchema.default(DEFAULT_GRID),
});
export type SceneData = z.infer<typeof SceneSchema>;

/** Genau ein Objekt pro Raum mit der ID ROOM_STATE_ID. */
export const RoomStateSchema = z.strictObject({
	/** Szene, die alle Spieler sehen. Muss existieren und für alle sichtbar sein. */
	activeSceneId: IdSchema.nullable(),
});
export type RoomStateData = z.infer<typeof RoomStateSchema>;
export const ROOM_STATE_ID = "state";

/** Spieler eines Raums; die ID ist die Spieler-ID der Sitzung. */
export const PlayerSchema = z.strictObject({
	name: z.string().trim().min(1).max(32),
	color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type PlayerData = z.infer<typeof PlayerSchema>;

/**
 * Token oder Prop auf einer Szene. Position ist der Mittelpunkt in Kartenpixeln,
 * Größe in Grid-Feldern. Die Sichtbarkeit leitet der Server aus Szene und `hidden` ab.
 */
export const TokenSchema = z.strictObject({
	sceneId: IdSchema,
	assetId: IdSchema,
	x: z.number().min(-100_000).max(100_000),
	y: z.number().min(-100_000).max(100_000),
	size: z
		.number()
		.min(0.25)
		.max(10)
		.refine((n) => Number.isInteger(n * 4), "Vielfaches von 0,25"),
	rotation: z.number().min(0).lt(360),
	/** Spieler, der das Token bewegen darf; null = nur die GM. */
	ownerId: IdSchema.nullable(),
	layer: z.enum(["props", "tokens"]),
	name: z.string().trim().max(40),
	/** Für Spieler unsichtbar (Schritt 7); verdeckte Szenen verbergen ihre Tokens ohnehin. */
	hidden: z.boolean().default(false),
});
export type TokenData = z.infer<typeof TokenSchema>;

/** Felder, die Spieler an eigenen Tokens ändern dürfen. */
export const PLAYER_TOKEN_FIELDS = ["x", "y", "rotation"] as const;

/** Ring als flache Koordinatenliste [x0, y0, x1, y1, …] in ganzen Kartenpixeln. */
const RingSchema = z
	.array(z.number().int().min(-100_000).max(100_000))
	.min(6)
	.max(MAX_FOG_COORDS)
	.refine((r) => r.length % 2 === 0, "gerade Anzahl Koordinaten");

export const FogPolygonSchema = z.strictObject({
	outer: RingSchema,
	holes: z.array(RingSchema).max(500),
});
export type FogPolygon = z.infer<typeof FogPolygonSchema>;

/**
 * Fog-Form: deckt ab, solange `active` ist; Aufdecken = ausschalten.
 * Nur Polygone, nie Pixelmasken – dynamischer Fog, .dd2vtt und Auto-Fog bauen darauf auf.
 */
export const FogSchema = z
	.strictObject({
		sceneId: IdSchema,
		polygons: z.array(FogPolygonSchema).min(1).max(500),
		active: z.boolean(),
		source: z.enum(["hand", "import", "auto"]),
		name: z.string().trim().max(40).default(""),
	})
	.refine(
		(f) =>
			f.polygons.reduce(
				(n, p) =>
					n + p.outer.length + p.holes.reduce((m, h) => m + h.length, 0),
				0,
			) <= MAX_FOG_COORDS,
		"zu viele Punkte",
	);
export type FogData = z.infer<typeof FogSchema>;

export const EntityKindSchema = z.enum([
	"scene",
	"roomState",
	"player",
	"token",
	"fog",
]);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/** Schema der Nutzdaten pro Objektart; der Server prüft jeden Stand dagegen. */
export const entitySchemas: Record<EntityKind, z.ZodType<EntityData>> = {
	scene: SceneSchema,
	roomState: RoomStateSchema,
	player: PlayerSchema,
	token: TokenSchema,
	fog: FogSchema,
};

export type EntityData = Record<string, unknown>;

/** Ein Objekt, wie es über die Leitung geht. */
export interface Entity {
	kind: EntityKind;
	id: string;
	data: EntityData;
	/** Nur für die GM enthalten; Spieler erfahren nicht, wer ein Objekt sonst noch sieht. */
	audience?: Audience;
	version: number;
}

export function entityKey(kind: EntityKind, id: string): string {
	return `${kind}:${id}`;
}
