import {
	type Audience,
	type DrawingData,
	type EntityData,
	type EntityKind,
	type Identity,
	isSceneChild,
	PLAYER_TOKEN_FIELDS,
	type PlayerData,
	ROOM_STATE_ID,
	type RollData,
	type RoomStateData,
	type TokenData,
} from "@mistwarden/protocol";
import { canSee } from "./visibility.ts";

export interface EntityState {
	data: EntityData;
	audience: Audience;
}

export interface WriteRequest {
	op: "create" | "update" | "delete";
	id: string;
	before: EntityState | null;
	after: EntityState | null;
	/** Vom Server selbst erzeugter Stand (z. B. ein ausgewürfelter Wurf), nicht vom Client. */
	trusted: boolean;
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

	// Zeichnen dürfen alle auf Szenen, die sie sehen; Spieler nur in eigener Farbe
	// und nur eigene Zeichnungen löschen. Zeichnungen werden nicht verändert, nur ersetzt.
	drawing: (identity, req) => {
		const before = req.before?.data as DrawingData | undefined;
		const after = req.after?.data as DrawingData | undefined;
		if (before && after && before.sceneId !== after.sceneId) return "invalid";
		if (isGm(identity)) return "ok";
		if (req.op === "update") return "forbidden";
		const data = (after ?? before) as DrawingData;
		if (data.ownerId !== identity.playerId) return "forbidden";
		if (req.op === "create") {
			if (!req.after || !canSee(identity, req.after.audience)) {
				return "forbidden";
			}
			const player = req.lookup("player", identity.playerId);
			const color = (player?.data as PlayerData | undefined)?.color;
			if (color?.toLowerCase() !== data.color.toLowerCase()) {
				return "forbidden";
			}
		}
		return "ok";
	},

	// Würfe legt nur der Server an (aus der Formel des Clients); löschen darf die GM.
	roll: (identity, req) => {
		if (req.op === "delete") return isGm(identity) ? "ok" : "forbidden";
		if (req.op !== "create" || !req.trusted || !req.after) return "forbidden";
		const roll = req.after.data as RollData;
		const author = isGm(identity) ? null : identity.playerId;
		if (roll.authorId !== author) return "forbidden";
		if (roll.hidden && !isGm(identity)) return "forbidden";
		const expected = roll.hidden ? "gm" : "all";
		if (req.after.audience.type !== expected) return "invalid";
		return "ok";
	},

	// Notizen schreibt nur die GM; eine Notiz wechselt nie die Szene.
	note: (identity, req) => {
		if (!isGm(identity)) return "forbidden";
		const before = req.before?.data as { sceneId: string } | undefined;
		const after = req.after?.data as { sceneId: string } | undefined;
		if (before && after && before.sceneId !== after.sceneId) return "invalid";
		return "ok";
	},

	// Handouts verteilt nur die GM; die Audience bestimmt die Empfänger.
	handout: (identity) => (isGm(identity) ? "ok" : "forbidden"),

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
	// Nur die GM legt fest, wer etwas sieht. Bei Szenen-Kindern leitet der Server
	// die Sichtbarkeit selbst ab; bei Würfen folgt sie aus `hidden` (Regel unten).
	if (
		identity.role !== "gm" &&
		!isSceneChild(kind) &&
		!req.trusted &&
		audienceChanged(req)
	) {
		return "forbidden";
	}
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
