import {
	type Audience,
	type EntityData,
	type EntityKind,
	type Identity,
	PLAYER_TOKEN_FIELDS,
	ROOM_STATE_ID,
	type RoomStateData,
	type TokenData,
} from "@mistwarden/protocol";

export interface EntityState {
	data: EntityData;
	audience: Audience;
}

export interface WriteRequest {
	op: "create" | "update" | "delete";
	id: string;
	before: EntityState | null;
	after: EntityState | null;
	/** Liest andere Objekte des Raums (ungefiltert), für Regeln über Objektgrenzen hinweg. */
	lookup: (kind: EntityKind, id: string) => EntityState | undefined;
}

/** Ergebnis einer Regel: erlaubt, verboten oder fachlich ungültig. */
export type Verdict = "ok" | "forbidden" | "invalid";

type Rule = (identity: Identity, req: WriteRequest) => Verdict;

const isGm = (identity: Identity) => identity.role === "gm";

/**
 * Schreibrechte und Konsistenzregeln pro Objektart. Lesen regelt die Audience (visibility.ts).
 * Spätere Arten (z. B. Tokens: Spieler bewegen nur eigene) kommen hier dazu.
 */
const rules: Record<EntityKind, Rule> = {
	scene: (identity, req) => {
		if (!isGm(identity)) return "forbidden";
		// Die aktive Szene sehen alle; sie darf weder verschwinden noch verdeckt werden.
		if (req.op !== "create" && activeSceneId(req) === req.id) {
			if (req.op === "delete" || req.after?.audience.type !== "all") {
				return "invalid";
			}
		}
		return "ok";
	},

	roomState: (identity, req) => {
		if (!isGm(identity)) return "forbidden";
		if (req.id !== ROOM_STATE_ID || req.op === "delete") return "invalid";
		if (req.after?.audience.type !== "all") return "invalid";
		const { activeSceneId } = req.after.data as RoomStateData;
		if (activeSceneId !== null) {
			const scene = req.lookup("scene", activeSceneId);
			if (scene?.audience.type !== "all") return "invalid";
		}
		return "ok";
	},

	token: (identity, req) => {
		const before = req.before?.data as TokenData | undefined;
		const after = req.after?.data as TokenData | undefined;
		// Ein Token wechselt nie die Szene.
		if (before && after && before.sceneId !== after.sceneId) return "invalid";
		if (isGm(identity)) return "ok";
		// Spieler: nur eigene Tokens auf der Token-Ebene, nur Position und Drehung.
		if (req.op !== "update" || !before || !after) return "forbidden";
		if (before.ownerId !== identity.playerId || before.layer !== "tokens") {
			return "forbidden";
		}
		const allowed = new Set<string>(PLAYER_TOKEN_FIELDS);
		const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
		for (const key of keys) {
			if (allowed.has(key)) continue;
			const k = key as keyof TokenData;
			if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
				return "forbidden";
			}
		}
		return "ok";
	},

	// Fog zeichnet und schaltet nur die GM; eine Form wechselt nie die Szene.
	fog: (identity, req) => {
		if (!isGm(identity)) return "forbidden";
		const before = req.before?.data as { sceneId: string } | undefined;
		const after = req.after?.data as { sceneId: string } | undefined;
		if (before && after && before.sceneId !== after.sceneId) return "invalid";
		return "ok";
	},

	// Spieler entstehen nur über den Spieler-Link (serverseitig mit GM-Rechten).
	player: (identity, req) => {
		if (!isGm(identity)) return "forbidden";
		if (req.after && req.after.audience.type !== "all") return "invalid";
		return "ok";
	},
};

export function checkWrite(
	identity: Identity,
	kind: EntityKind,
	req: WriteRequest,
): Verdict {
	// Nur die GM legt fest, wer etwas sieht.
	if (identity.role !== "gm" && audienceChanged(req)) return "forbidden";
	return rules[kind](identity, req);
}

function activeSceneId(req: WriteRequest): string | null {
	const state = req.lookup("roomState", ROOM_STATE_ID);
	return state ? (state.data as RoomStateData).activeSceneId : null;
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
