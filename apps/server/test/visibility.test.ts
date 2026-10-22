import type { Identity } from "@mistwarden/protocol";
import { describe, expect, it } from "vitest";
import {
	canSee,
	filterChange,
	type StoredChange,
} from "../src/sync/visibility.ts";

const gm: Identity = { role: "gm" };
const p1: Identity = { role: "player", playerId: "p1" };
const p2: Identity = { role: "player", playerId: "p2" };

const base: StoredChange = {
	version: 7,
	op: "upsert",
	kind: "scene",
	entityId: "s1",
	data: { name: "X" },
	audience: { type: "all" },
	prevAudience: null,
};

describe("canSee", () => {
	it("GM sieht alles", () => {
		expect(canSee(gm, { type: "gm" })).toBe(true);
		expect(canSee(gm, { type: "players", playerIds: [] })).toBe(true);
	});

	it("Spieler sehen nur, was für sie bestimmt ist", () => {
		expect(canSee(p1, { type: "all" })).toBe(true);
		expect(canSee(p1, { type: "gm" })).toBe(false);
		expect(canSee(p1, { type: "players", playerIds: ["p1"] })).toBe(true);
		expect(canSee(p2, { type: "players", playerIds: ["p1"] })).toBe(false);
	});
});

describe("filterChange", () => {
	it("Neues sichtbares Objekt → Upsert, ohne Audience für Spieler", () => {
		const out = filterChange(p1, base);
		expect(out).toMatchObject({
			op: "upsert",
			entity: { id: "s1", version: 7 },
		});
		expect(out?.op === "upsert" && out.entity.audience).toBeUndefined();
		expect(filterChange(gm, base)).toMatchObject({
			entity: { audience: { type: "all" } },
		});
	});

	it("Neues verdecktes Objekt → nichts", () => {
		expect(filterChange(p1, { ...base, audience: { type: "gm" } })).toBeNull();
	});

	it("Sichtbar → verdeckt → Löschen", () => {
		const hidden = {
			...base,
			audience: { type: "gm" },
			prevAudience: { type: "all" },
		} as const;
		expect(filterChange(p1, hidden)).toEqual({
			version: 7,
			op: "delete",
			kind: "scene",
			id: "s1",
		});
	});

	it("Löschen eines nie gesehenen Objekts → nichts", () => {
		const del: StoredChange = {
			...base,
			op: "delete",
			data: null,
			audience: null,
			prevAudience: { type: "gm" },
		};
		expect(filterChange(p1, del)).toBeNull();
		expect(filterChange(gm, del)).toMatchObject({ op: "delete" });
	});
});
