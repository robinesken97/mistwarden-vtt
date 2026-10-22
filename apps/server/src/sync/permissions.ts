import type {
	Audience,
	EntityData,
	EntityKind,
	Identity,
} from "@mistwarden/protocol";

export interface WriteRequest {
	op: "create" | "update" | "delete";
	before: { data: EntityData; audience: Audience } | null;
	after: { data: EntityData; audience: Audience } | null;
}

type Rule = (identity: Identity, req: WriteRequest) => boolean;

const gmOnly: Rule = (identity) => identity.role === "gm";

/**
 * Schreibrechte pro Objektart. Lesen regelt die Audience (visibility.ts).
 * Spätere Arten (z. B. Tokens: Spieler bewegen nur eigene) kommen hier dazu.
 */
const rules: Record<EntityKind, Rule> = {
	scene: gmOnly,
};

export function canWrite(
	identity: Identity,
	kind: EntityKind,
	req: WriteRequest,
): boolean {
	// Nur die GM legt fest, wer etwas sieht.
	if (identity.role !== "gm" && audienceChanged(req)) return false;
	return rules[kind](identity, req);
}

function audienceChanged(req: WriteRequest): boolean {
	if (req.op === "create") return req.after?.audience.type !== "all";
	if (req.op === "update") {
		return (
			JSON.stringify(req.before?.audience) !==
			JSON.stringify(req.after?.audience)
		);
	}
	return false;
}
