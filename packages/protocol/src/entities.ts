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

/**
 * Messen pro Szene: `perCell` Einheiten pro Feld. Diagonalen auf Quadraten:
 * - equal: jede Diagonale zählt ein Feld
 * - alternating: abwechselnd ein und zwei Felder (1-2-1)
 * - euclidean: Luftlinie in Feldern
 * Auf Hex-Grids gilt immer die Hex-Distanz.
 */
export const MeasureSchema = z.strictObject({
	perCell: z.number().positive().max(10_000),
	unit: z.string().trim().min(1).max(8),
	diagonal: z.enum(["equal", "alternating", "euclidean"]),
});
export type MeasureData = z.infer<typeof MeasureSchema>;

export const DEFAULT_MEASURE: MeasureData = {
	perCell: 5,
	unit: "ft",
	diagonal: "equal",
};

export const SceneSchema = z.strictObject({
	name: z.string().trim().min(1).max(100),
	/** Reihenfolge in der Szenenliste. */
	order: z.number().int().min(0).max(1_000_000_000),
	/** Asset-ID des Kartenbilds oder null für eine leere Szene. */
	map: IdSchema.nullable().default(null),
	grid: GridSchema.default(DEFAULT_GRID),
	measure: MeasureSchema.default(DEFAULT_MEASURE),
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

/** Höchstzahl Koordinaten (x und y zählen einzeln) pro Zeichnung. */
export const MAX_DRAWING_COORDS = 4000;

/** Farbe der GM für Pings und als Vorgabe beim Zeichnen. */
export const GM_COLOR = "#e0b050";

const ColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * Zeichnung auf einer Szene. `points` ist eine flache Liste [x0, y0, x1, y1, …];
 * bei Linie, Rechteck und Ellipse genau Anfangs- und Endpunkt (Ecken bzw. umschließendes Rechteck).
 * Spieler zeichnen nur in ihrer eigenen Farbe.
 */
export const DrawingSchema = z
	.strictObject({
		sceneId: IdSchema,
		/** Spieler, dem die Zeichnung gehört; null = GM. */
		ownerId: IdSchema.nullable(),
		color: ColorSchema,
		shape: z.enum(["free", "line", "rect", "ellipse"]),
		points: z
			.array(z.number().int().min(-100_000).max(100_000))
			.min(4)
			.max(MAX_DRAWING_COORDS)
			.refine((p) => p.length % 2 === 0, "gerade Anzahl Koordinaten"),
		width: z.number().min(1).max(100),
	})
	.refine(
		(d) => d.shape === "free" || d.points.length === 4,
		"Formen haben genau zwei Punkte",
	);
export type DrawingData = z.infer<typeof DrawingSchema>;

/** Ein Summand eines Würfelwurfs, wie ihn der Server ausgewürfelt hat. */
export const RollTermSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("dice"),
		sign: z.union([z.literal(1), z.literal(-1)]),
		count: z.number().int().min(1).max(100),
		sides: z.number().int().min(2).max(1000),
		keep: z
			.strictObject({
				mode: z.enum(["h", "l"]),
				n: z.number().int().min(1).max(100),
			})
			.nullable(),
		results: z.array(z.number().int().min(1).max(1000)).max(100),
		/** Pro Ergebnis: zählt es zur Summe (false = durch kh/kl verworfen)? */
		kept: z.array(z.boolean()).max(100),
	}),
	z.strictObject({
		type: z.literal("const"),
		sign: z.union([z.literal(1), z.literal(-1)]),
		value: z.number().int().min(0).max(100_000),
	}),
]);
export type RollTerm = z.infer<typeof RollTermSchema>;

/**
 * Würfelwurf im Log des Raums. Entsteht nur auf dem Server (Clients schicken die Formel);
 * verdeckte Würfe haben die Audience `gm` und erreichen Spieler nie.
 */
export const RollSchema = z.strictObject({
	/** Würfelnder Spieler; null = GM. */
	authorId: IdSchema.nullable(),
	formula: z.string().min(1).max(100),
	terms: z.array(RollTermSchema).min(1).max(20),
	total: z.number().int(),
	hidden: z.boolean(),
	/** Serverzeit in Millisekunden. */
	at: z.number().int().nonnegative(),
});
export type RollData = z.infer<typeof RollSchema>;

/** So viele Würfe behält der Server pro Raum; ältere fallen aus dem Log. */
export const MAX_ROLLS = 200;

export const EntityKindSchema = z.enum([
	"scene",
	"roomState",
	"player",
	"token",
	"fog",
	"drawing",
	"roll",
]);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/** Schema der Nutzdaten pro Objektart; der Server prüft jeden Stand dagegen. */
export const entitySchemas: Record<EntityKind, z.ZodType<EntityData>> = {
	scene: SceneSchema,
	roomState: RoomStateSchema,
	player: PlayerSchema,
	token: TokenSchema,
	fog: FogSchema,
	drawing: DrawingSchema,
	roll: RollSchema,
};

/** Objektarten, deren Sichtbarkeit aus ihrer Szene folgt. */
export const SCENE_CHILD_KINDS: readonly EntityKind[] = [
	"token",
	"fog",
	"drawing",
];

export function isSceneChild(kind: EntityKind): boolean {
	return SCENE_CHILD_KINDS.includes(kind);
}

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
