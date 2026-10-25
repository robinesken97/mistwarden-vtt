import { DEFAULT_MEASURE } from "@mistwarden/protocol";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	RawClient,
	startTestRoom,
	startTestServer,
	type TestRoom,
} from "./helpers.ts";
import { snapshotEntities } from "./step6-helpers.ts";

let room: TestRoom;

beforeEach(async () => {
	room = await startTestRoom();
});

afterEach(async () => {
	await room.close();
});

describe("Migration 005: Messeinstellungen", () => {
	it("trägt bestehenden Szenen und dem Änderungslog die Standardwerte nach", async () => {
		// Stand vor Schritt 6 nachbauen: Szenen ohne `measure`, Schema-Version 4.
		await room.server.close();
		const db = new Database(room.dbPath);
		db.exec(
			"UPDATE entities SET data = json_remove(data, '$.measure') WHERE kind = 'scene'",
		);
		db.exec(
			"UPDATE changes SET data = json_remove(data, '$.measure') WHERE kind = 'scene' AND data IS NOT NULL",
		);
		db.pragma("user_version = 4");
		db.close();

		room.server = await startTestServer(room.dbPath);
		room.url = `ws://127.0.0.1:${room.server.port}/ws`;

		const full = await RawClient.join(room.url, room.p1.token);
		const scene = snapshotEntities(full).find((e) => e.kind === "scene");
		expect(scene?.data.measure).toEqual(DEFAULT_MEASURE);
		full.close();

		const replay = await RawClient.join(room.url, room.p1.token, {
			lastVersion: 0,
		});
		const changes = replay.received.find((m) => m.type === "changes");
		const sceneChange =
			changes?.type === "changes"
				? changes.changes.find(
						(c) => c.op === "upsert" && c.entity.kind === "scene",
					)
				: undefined;
		expect(
			sceneChange?.op === "upsert" && sceneChange.entity.data.measure,
		).toEqual(DEFAULT_MEASURE);
		replay.close();
	});
});
