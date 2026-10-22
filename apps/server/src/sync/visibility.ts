import type {
	Audience,
	Change,
	Entity,
	EntityData,
	EntityKind,
	Identity,
} from "@mistwarden/protocol";

export function canSee(identity: Identity, audience: Audience): boolean {
	if (identity.role === "gm") return true;
	switch (audience.type) {
		case "all":
			return true;
		case "gm":
			return false;
		case "players":
			return audience.playerIds.includes(identity.playerId);
	}
}

/** Eine Änderung, wie sie im Log steht – vor der Filterung pro Empfänger. */
export interface StoredChange {
	version: number;
	op: "upsert" | "delete";
	kind: EntityKind;
	entityId: string;
	data: EntityData | null;
	audience: Audience | null;
	prevAudience: Audience | null;
}

export interface StoredEntity {
	kind: EntityKind;
	id: string;
	data: EntityData;
	audience: Audience;
	version: number;
}

export function toWireEntity(identity: Identity, e: StoredEntity): Entity {
	const entity: Entity = {
		kind: e.kind,
		id: e.id,
		data: e.data,
		version: e.version,
	};
	if (identity.role === "gm") entity.audience = e.audience;
	return entity;
}

/**
 * Übersetzt eine Änderung in das, was dieser Empfänger erfahren darf:
 * - sichtbar nach der Änderung → Upsert mit vollem Stand,
 * - vorher sichtbar, jetzt nicht (verborgen oder gelöscht) → Löschen,
 * - nie sichtbar → nichts. So erreicht kein verdecktes Objekt einen Spieler.
 */
export function filterChange(
	identity: Identity,
	c: StoredChange,
): Change | null {
	const wasVisible =
		c.prevAudience !== null && canSee(identity, c.prevAudience);
	if (
		c.op === "upsert" &&
		c.data &&
		c.audience &&
		canSee(identity, c.audience)
	) {
		return {
			version: c.version,
			op: "upsert",
			entity: toWireEntity(identity, {
				kind: c.kind,
				id: c.entityId,
				data: c.data,
				audience: c.audience,
				version: c.version,
			}),
		};
	}
	if (wasVisible) {
		return { version: c.version, op: "delete", kind: c.kind, id: c.entityId };
	}
	return null;
}
