import { type Action, type Entity, entityKey } from "@mistwarden/protocol";
import { describe, expect, it } from "vitest";
import { History, inverseOf, MAX_HISTORY } from "../src/net/history.ts";

/** Minimaler „Server“: wendet Aktionen auf eine Map an und vergibt Versionen. */
function fakeRoom() {
	const entities = new Map<string, Entity>();
	let version = 0;
	const sent: Action[] = [];
	const apply = (a: Action) => {
		version++;
		const key = entityKey(a.kind, a.id);
		if (a.op === "delete") entities.delete(key);
		else if (a.op === "create") {
			entities.set(key, { kind: a.kind, id: a.id, data: a.data, version });
		} else {
			const before = entities.get(key) as Entity;
			entities.set(key, {
				...before,
				data: { ...before.data, ...a.patch },
				version,
			});
		}
		return version;
	};
	const history = new History({
		get: (key) => entities.get(key),
		send: async (a) => {
			sent.push(a);
			return apply(a);
		},
	});
	return { entities, history, sent, apply };
}

const token = (x: number) => ({ sceneId: "s", x, y: 0 });

describe("Rückgängig/Wiederholen", () => {
	it("macht eine Token-Bewegung rückgängig und wiederholt sie", async () => {
		const room = fakeRoom();
		room.apply({ op: "create", kind: "token", id: "t", data: token(0) });
		await room.history.run({
			op: "update",
			kind: "token",
			id: "t",
			patch: { x: 100 },
		});
		expect(await room.history.undo()).toBe("done");
		expect(room.entities.get("token:t")?.data.x).toBe(0);
		expect(await room.history.redo()).toBe("done");
		expect(room.entities.get("token:t")?.data.x).toBe(100);
	});

	it("Anlegen ↔ Löschen, mit derselben ID und denselben Daten", async () => {
		const room = fakeRoom();
		const data = { sceneId: "s", points: [0, 0, 5, 5] };
		await room.history.run({ op: "create", kind: "drawing", id: "d", data });
		await room.history.undo();
		expect(room.entities.has("drawing:d")).toBe(false);
		await room.history.redo();
		expect(room.entities.get("drawing:d")?.data).toEqual(data);

		await room.history.run({ op: "delete", kind: "drawing", id: "d" });
		await room.history.undo();
		expect(room.entities.get("drawing:d")?.data).toEqual(data);
	});

	it("überschreibt keine fremden Änderungen", async () => {
		const room = fakeRoom();
		room.apply({ op: "create", kind: "token", id: "t", data: token(0) });
		await room.history.run({
			op: "update",
			kind: "token",
			id: "t",
			patch: { x: 100 },
		});
		// Jemand anderes bewegt das Token danach.
		room.apply({ op: "update", kind: "token", id: "t", patch: { x: 300 } });
		expect(await room.history.undo()).toBe("stale");
		expect(room.entities.get("token:t")?.data.x).toBe(300);
		expect(room.history.canUndo).toBe(false);
	});

	it("ignoriert Arten ohne Rückgängig (z. B. Szenen)", async () => {
		const room = fakeRoom();
		await room.history.run({
			op: "create",
			kind: "scene",
			id: "s",
			data: { name: "X", order: 0 },
		});
		expect(room.history.canUndo).toBe(false);
	});

	it("eine neue Aktion leert Wiederholen; der Verlauf ist begrenzt", async () => {
		const room = fakeRoom();
		room.apply({ op: "create", kind: "token", id: "t", data: token(0) });
		for (let i = 1; i <= MAX_HISTORY + 5; i++) {
			await room.history.run({
				op: "update",
				kind: "token",
				id: "t",
				patch: { x: i },
			});
		}
		await room.history.undo();
		expect(room.history.canRedo).toBe(true);
		await room.history.run({
			op: "update",
			kind: "token",
			id: "t",
			patch: { x: 999 },
		});
		expect(room.history.canRedo).toBe(false);
		let undone = 0;
		while ((await room.history.undo()) === "done") undone++;
		expect(undone).toBe(MAX_HISTORY);
	});

	it("schickt beim Wiederherstellen von Szenen-Kindern keine Audience mit", () => {
		const before: Entity = {
			kind: "fog",
			id: "f",
			data: { sceneId: "s" },
			audience: { type: "gm" },
			version: 3,
		};
		expect(inverseOf({ op: "delete", kind: "fog", id: "f" }, before)).toEqual({
			op: "create",
			kind: "fog",
			id: "f",
			data: { sceneId: "s" },
		});
	});
});
