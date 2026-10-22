import {
	type Action,
	AUDIENCE_ALL,
	type Audience,
	type EntityData,
	type EntityKind,
	entitySchemas,
	type Identity,
	type RejectReason,
} from "@mistwarden/protocol";
import type { Db } from "../db/connection.ts";
import { canWrite } from "./permissions.ts";
import { canSee, type StoredChange, type StoredEntity } from "./visibility.ts";

/** Liegt ein Client weiter zurück, bekommt er den kompletten Stand statt des Logs. */
export const MAX_REPLAY = 1000;

export type ApplyResult =
	| { status: "applied"; version: number; changes: StoredChange[] }
	| { status: "duplicate"; version: number }
	| { status: "rejected"; reason: RejectReason };

interface EntityRow {
	kind: EntityKind;
	id: string;
	data: string;
	audience: string;
	version: number;
}

interface ChangeRow {
	version: number;
	op: "upsert" | "delete";
	kind: EntityKind;
	entity_id: string;
	data: string | null;
	audience: string | null;
	prev_audience: string | null;
}

/**
 * Autoritativer Zustand eines Raums: prüft Aktionen, vergibt fortlaufende
 * Versionsnummern und schreibt Stand und Log in einer Transaktion.
 */
export class ChangeLog {
	readonly #db: Db;
	readonly #stmts;

	constructor(db: Db) {
		this.#db = db;
		this.#stmts = {
			roomVersion: db.prepare<[string], { version: number }>(
				"SELECT version FROM rooms WHERE id = ?",
			),
			bumpVersion: db.prepare<[string], { version: number }>(
				"UPDATE rooms SET version = version + 1 WHERE id = ? RETURNING version",
			),
			findAction: db.prepare<[string, string], { version: number }>(
				"SELECT version FROM changes WHERE room_id = ? AND action_id = ? LIMIT 1",
			),
			getEntity: db.prepare<[string, string, string], EntityRow>(
				"SELECT kind, id, data, audience, version FROM entities WHERE room_id = ? AND kind = ? AND id = ?",
			),
			allEntities: db.prepare<[string], EntityRow>(
				"SELECT kind, id, data, audience, version FROM entities WHERE room_id = ? ORDER BY version",
			),
			upsertEntity: db.prepare(
				`INSERT INTO entities (room_id, kind, id, data, audience, version) VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT (room_id, kind, id) DO UPDATE SET data = excluded.data, audience = excluded.audience, version = excluded.version`,
			),
			deleteEntity: db.prepare(
				"DELETE FROM entities WHERE room_id = ? AND kind = ? AND id = ?",
			),
			insertChange: db.prepare(
				`INSERT INTO changes (room_id, version, action_id, op, kind, entity_id, data, audience, prev_audience, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			),
			oldestChange: db.prepare<[string], { version: number | null }>(
				"SELECT MIN(version) AS version FROM changes WHERE room_id = ?",
			),
			changesSince: db.prepare<[string, number], ChangeRow>(
				"SELECT version, op, kind, entity_id, data, audience, prev_audience FROM changes WHERE room_id = ? AND version > ? ORDER BY version",
			),
		};
	}

	version(roomId: string): number {
		const row = this.#stmts.roomVersion.get(roomId);
		if (!row) throw new Error(`Raum ${roomId} existiert nicht`);
		return row.version;
	}

	apply(
		roomId: string,
		identity: Identity,
		actionId: string,
		action: Action,
	): ApplyResult {
		return this.#db.transaction((): ApplyResult => {
			const done = this.#stmts.findAction.get(roomId, actionId);
			if (done) return { status: "duplicate", version: done.version };

			const row = this.#stmts.getEntity.get(roomId, action.kind, action.id);
			// Was ein Spieler nicht sehen darf, existiert für ihn nicht.
			const before =
				row && canSee(identity, parseAudience(row.audience))
					? { data: parseData(row.data), audience: parseAudience(row.audience) }
					: null;

			let after: { data: EntityData; audience: Audience } | null;
			switch (action.op) {
				case "create": {
					if (row) return { status: "rejected", reason: "exists" };
					const data = entitySchemas[action.kind].safeParse(action.data);
					if (!data.success) return { status: "rejected", reason: "invalid" };
					after = {
						data: data.data,
						audience: action.audience ?? AUDIENCE_ALL,
					};
					break;
				}
				case "update": {
					if (!before) return { status: "rejected", reason: "not_found" };
					if (!action.patch && !action.audience) {
						return { status: "rejected", reason: "invalid" };
					}
					const data = entitySchemas[action.kind].safeParse({
						...before.data,
						...action.patch,
					});
					if (!data.success) return { status: "rejected", reason: "invalid" };
					after = {
						data: data.data,
						audience: action.audience ?? before.audience,
					};
					break;
				}
				case "delete": {
					if (!before) return { status: "rejected", reason: "not_found" };
					after = null;
					break;
				}
			}

			if (!canWrite(identity, action.kind, { op: action.op, before, after })) {
				return { status: "rejected", reason: "forbidden" };
			}

			const bumped = this.#stmts.bumpVersion.get(roomId);
			if (!bumped) throw new Error(`Raum ${roomId} existiert nicht`);
			const version = bumped.version;
			const prevAudience = row ? parseAudience(row.audience) : null;

			if (after) {
				this.#stmts.upsertEntity.run(
					roomId,
					action.kind,
					action.id,
					JSON.stringify(after.data),
					JSON.stringify(after.audience),
					version,
				);
			} else {
				this.#stmts.deleteEntity.run(roomId, action.kind, action.id);
			}
			this.#stmts.insertChange.run(
				roomId,
				version,
				actionId,
				after ? "upsert" : "delete",
				action.kind,
				action.id,
				after ? JSON.stringify(after.data) : null,
				after ? JSON.stringify(after.audience) : null,
				prevAudience ? JSON.stringify(prevAudience) : null,
				Date.now(),
			);

			const change: StoredChange = {
				version,
				op: after ? "upsert" : "delete",
				kind: action.kind,
				entityId: action.id,
				data: after?.data ?? null,
				audience: after?.audience ?? null,
				prevAudience,
			};
			return { status: "applied", version, changes: [change] };
		})();
	}

	/**
	 * Änderungen nach `lastVersion`, oder `null`, wenn der Client den kompletten
	 * Stand braucht (zu weit zurück, Log gekürzt oder Version unbekannt).
	 */
	since(roomId: string, lastVersion: number): StoredChange[] | null {
		const current = this.version(roomId);
		if (lastVersion > current) return null;
		if (current - lastVersion > MAX_REPLAY) return null;
		const oldest = this.#stmts.oldestChange.get(roomId)?.version;
		if (lastVersion < current && oldest != null && oldest > lastVersion + 1) {
			return null;
		}
		return this.#stmts.changesSince.all(roomId, lastVersion).map((r) => ({
			version: r.version,
			op: r.op,
			kind: r.kind,
			entityId: r.entity_id,
			data: r.data === null ? null : parseData(r.data),
			audience: r.audience === null ? null : parseAudience(r.audience),
			prevAudience:
				r.prev_audience === null ? null : parseAudience(r.prev_audience),
		}));
	}

	entities(roomId: string): StoredEntity[] {
		return this.#stmts.allEntities.all(roomId).map((r) => ({
			kind: r.kind,
			id: r.id,
			data: parseData(r.data),
			audience: parseAudience(r.audience),
			version: r.version,
		}));
	}
}

// Die Datenbank enthält nur Werte, die vorher gegen die Schemas geprüft wurden.
function parseData(json: string): EntityData {
	return JSON.parse(json) as EntityData;
}

function parseAudience(json: string): Audience {
	return JSON.parse(json) as Audience;
}
