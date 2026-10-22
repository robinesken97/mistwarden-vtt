import type { RoomSummary } from "@mistwarden/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.ts";
import {
	api,
	RawClient,
	startTestRoom,
	TEST_GM_PASSWORD,
	type TestRoom,
} from "./helpers.ts";

let room: TestRoom;

beforeEach(async () => {
	room = await startTestRoom();
});

afterEach(async () => {
	await room.close();
});

const call = <T = unknown>(path: string, opts?: Parameters<typeof api>[2]) =>
	api<T>(room.http, path, opts);

describe("Passwort-Hashing", () => {
	it("prüft richtige und falsche Passwörter", async () => {
		const hash = await hashPassword("geheim-genug");
		expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
		expect(await verifyPassword("geheim-genug", hash)).toBe(true);
		expect(await verifyPassword("falsch", hash)).toBe(false);
		expect(await verifyPassword("geheim-genug", "kaputt")).toBe(false);
	});
});

describe("GM-Login", () => {
	it("gibt mit richtigem Passwort eine GM-Sitzung aus", async () => {
		const res = await call<{ token: string }>("/api/gm/login", {
			body: { password: TEST_GM_PASSWORD },
		});
		expect(res.status).toBe(200);
		const session = await call("/api/session", { token: res.body.token });
		expect(session.body).toEqual({ identity: { role: "gm" }, roomId: null });
	});

	it("weist falsche Passwörter ab", async () => {
		const res = await call("/api/gm/login", { body: { password: "falsch" } });
		expect(res).toEqual({ status: 401, body: { error: "unauthorized" } });
	});

	it("begrenzt Anmeldeversuche", async () => {
		const statuses = [];
		for (let i = 0; i < 7; i++) {
			const res = await call("/api/gm/login", { body: { password: "x" } });
			statuses.push(res.status);
		}
		// Ein Login lief schon beim Anlegen des Testraums.
		expect(statuses).toEqual([401, 401, 401, 401, 429, 429, 429]);
	});

	it("macht GM-Sitzungen ungültig, wenn sich das Passwort ändert", async () => {
		await room.restart({ gmPassword: TEST_GM_PASSWORD });
		expect((await call("/api/session", { token: room.gm })).status).toBe(200);

		await room.restart({ gmPassword: "ein-ganz-neues-passwort" });
		expect((await call("/api/session", { token: room.gm })).status).toBe(401);
		// Spieler-Sitzungen bleiben gültig.
		expect((await call("/api/session", { token: room.p1.token })).status).toBe(
			200,
		);
	});

	it("Abmelden beendet die Sitzung", async () => {
		expect(
			(await call("/api/logout", { token: room.gm, body: {} })).status,
		).toBe(200);
		expect((await call("/api/session", { token: room.gm })).status).toBe(401);
	});
});

describe("Räume", () => {
	it("nur die GM sieht und legt Räume an", async () => {
		expect((await call("/api/rooms")).status).toBe(401);
		expect((await call("/api/rooms", { token: room.p1.token })).status).toBe(
			403,
		);
		const created = await call<RoomSummary>("/api/rooms", {
			token: room.gm,
			body: { name: "Zweiter Raum" },
		});
		expect(created.status).toBe(200);
		const list = await call<RoomSummary[]>("/api/rooms", { token: room.gm });
		expect(list.body.map((r) => r.name)).toEqual(["Testraum", "Zweiter Raum"]);
	});

	it("prüft Eingaben", async () => {
		const res = await call("/api/rooms", {
			token: room.gm,
			body: { name: "" },
		});
		expect(res).toEqual({ status: 400, body: { error: "bad_request" } });
	});

	it("unbekannte Pfade ergeben 404", async () => {
		expect((await call("/api/gibt-es-nicht")).status).toBe(404);
	});
});

describe("Spieler-Link", () => {
	async function link(): Promise<string> {
		const list = await call<RoomSummary[]>("/api/rooms", { token: room.gm });
		return list.body[0]?.playerLinkToken as string;
	}

	it("zeigt den Raumnamen vor dem Beitreten", async () => {
		const res = await call("/api/join/info", {
			body: { linkToken: await link() },
		});
		expect(res.body).toEqual({ roomId: room.roomId, roomName: "Testraum" });
	});

	it("Beitreten legt einen Spieler an, den alle sehen", async () => {
		const gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
		const res = await call<{ token: string; playerId: string }>("/api/join", {
			body: { linkToken: await link(), displayName: "Drei" },
		});
		expect(res.status).toBe(200);
		const msg = await gm.next("changes");
		expect(msg.changes[0]).toMatchObject({
			op: "upsert",
			entity: { kind: "player", id: res.body.playerId, data: { name: "Drei" } },
		});
		gm.close();
	});

	it("ein neu erzeugter Link macht den alten ungültig", async () => {
		const old = await link();
		const res = await call<{ playerLinkToken: string }>(
			`/api/rooms/${room.roomId}/player-link`,
			{ token: room.gm, body: {} },
		);
		expect(res.body.playerLinkToken).not.toBe(old);
		const withOld = await call("/api/join", {
			body: { linkToken: old, displayName: "Zu spät" },
		});
		expect(withOld.status).toBe(404);
		// Wer schon drin ist, bleibt drin.
		expect((await call("/api/session", { token: room.p1.token })).status).toBe(
			200,
		);
	});

	it("Spieler dürfen keinen neuen Link erzeugen", async () => {
		const res = await call(`/api/rooms/${room.roomId}/player-link`, {
			token: room.p1.token,
			body: {},
		});
		expect(res.status).toBe(403);
	});

	it("unbekannte Links ergeben 404", async () => {
		const res = await call("/api/join", {
			body: { linkToken: "falsch", displayName: "X" },
		});
		expect(res.status).toBe(404);
	});
});
