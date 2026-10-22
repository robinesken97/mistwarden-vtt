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

// Szenen werden in Schritt 2 um Grid, Karte usw. erweitert.
export const SceneSchema = z.strictObject({
	name: z.string().trim().min(1).max(100),
});

export const EntityKindSchema = z.enum(["scene"]);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/** Schema der Nutzdaten pro Objektart; der Server prüft jeden Stand dagegen. */
export const entitySchemas: Record<EntityKind, z.ZodType<EntityData>> = {
	scene: SceneSchema,
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
