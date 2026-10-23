import { randomUUID } from "node:crypto";
import {
	type AssetMeta,
	assetMetaUrl,
	levelCount,
	levelSize,
	tileGrid,
	tileUrl,
} from "@mistwarden/protocol";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	api,
	RawClient,
	startTestRoom,
	TEST_UPLOAD_MAX_BYTES,
	type TestRoom,
} from "./helpers.ts";

// Testbilder werden erzeugt – keine echten Karten im Repository.

let room: TestRoom;

beforeEach(async () => {
	room = await startTestRoom();
});

afterEach(async () => {
	await room.close();
});

async function testImage(
	width: number,
	height: number,
	format: "png" | "jpeg" | "webp" = "png",
): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: "#4a6" },
	})
		.toFormat(format)
		.toBuffer();
}

async function upload(
	body: Buffer | string,
	opts: { token?: string; type?: string; name?: string } = {},
) {
	const res = await fetch(`${room.http}/api/assets`, {
		method: "POST",
		headers: {
			"content-type": opts.type ?? "image/png",
			authorization: `Bearer ${opts.token ?? room.gm}`,
			...(opts.name ? { "x-asset-name": encodeURIComponent(opts.name) } : {}),
		},
		body,
	});
	return { status: res.status, body: (await res.json()) as AssetMeta };
}

describe("Kachelmathematik", () => {
	it("halbiert bis eine Kachel reicht", () => {
		expect(levelCount(1024, 800)).toBe(1);
		expect(levelCount(1025, 10)).toBe(2);
		expect(levelCount(5000, 3000)).toBe(4);
		expect(levelSize({ width: 5000, height: 3000 }, 3)).toEqual({
			width: 625,
			height: 375,
		});
		expect(tileGrid({ width: 5000, height: 3000, tileSize: 1024 }, 0)).toEqual({
			cols: 5,
			rows: 3,
		});
	});
});

describe("Upload", () => {
	it("erzeugt eine Kachelpyramide und liefert sie aus", async () => {
		const res = await upload(await testImage(3000, 2000), {
			name: "Höhle Nord",
		});
		expect(res.status).toBe(200);
		const meta = res.body;
		expect(meta).toMatchObject({
			name: "Höhle Nord",
			width: 3000,
			height: 2000,
			tileSize: 1024,
			levels: 3,
		});

		const metaRes = await fetch(room.http + assetMetaUrl(meta.id));
		expect(await metaRes.json()).toEqual(meta);

		// Jede Kachel jeder Stufe existiert und hat die erwartete Größe.
		for (let level = 0; level < meta.levels; level++) {
			const { cols, rows } = tileGrid(meta, level);
			const size = levelSize(meta, level);
			for (let x = 0; x < cols; x++) {
				for (let y = 0; y < rows; y++) {
					const tile = await fetch(room.http + tileUrl(meta.id, level, x, y));
					expect(tile.status).toBe(200);
					expect(tile.headers.get("content-type")).toBe("image/webp");
					expect(tile.headers.get("cache-control")).toContain("immutable");
					const dims = await sharp(
						Buffer.from(await tile.arrayBuffer()),
					).metadata();
					expect(dims.width).toBe(Math.min(1024, size.width - x * 1024));
					expect(dims.height).toBe(Math.min(1024, size.height - y * 1024));
				}
			}
			const outside = await fetch(room.http + tileUrl(meta.id, level, cols, 0));
			expect(outside.status).toBe(404);
		}
		expect((await fetch(room.http + tileUrl(meta.id, 3, 0, 0))).status).toBe(
			404,
		);

		const list = await api<AssetMeta[]>(room.http, "/api/assets", {
			token: room.gm,
		});
		expect(list.body.map((a) => a.id)).toEqual([meta.id]);
	});

	it("liefert das Original nie aus", async () => {
		const { body: meta } = await upload(await testImage(200, 100, "jpeg"), {
			type: "image/jpeg",
		});
		for (const path of ["original.jpg", "upload", "tiles.dzi", "../assets"]) {
			const res = await fetch(`${room.http}/assets/${meta.id}/${path}`);
			expect(res.status).toBe(404);
		}
	});

	it("nur die GM darf hochladen", async () => {
		const img = await testImage(10, 10);
		expect((await upload(img, { token: room.p1.token })).status).toBe(403);
		expect((await upload(img, { token: "falsch" })).status).toBe(401);
	});

	it("weist falsche Typen und Nicht-Bilder ab", async () => {
		expect((await upload("hallo", { type: "text/plain" })).status).toBe(415);
		expect((await upload("kein bild", { type: "image/png" })).status).toBe(415);
		// GIF ist nicht erlaubt, auch wenn der Content-Type lügt.
		const gif = await sharp({
			create: { width: 4, height: 4, channels: 3, background: "#000" },
		})
			.gif()
			.toBuffer();
		expect((await upload(gif, { type: "image/png" })).status).toBe(415);
	});

	it("weist zu große Dateien ab", async () => {
		const big = Buffer.alloc(TEST_UPLOAD_MAX_BYTES + 1);
		const res = await upload(big).catch(() => ({ status: 413 }));
		expect(res.status).toBe(413);
	});
});

describe("Karte und Grid in der Szene", () => {
	it("neue Szenen bekommen Standard-Grid und keine Karte", async () => {
		const gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
		const snap = gm.received.find((m) => m.type === "snapshot");
		const scene =
			snap?.type === "snapshot"
				? snap.entities.find((e) => e.kind === "scene")
				: undefined;
		expect(scene?.data).toMatchObject({
			map: null,
			grid: {
				type: "square",
				size: 100,
				offsetX: 0,
				offsetY: 0,
				visible: true,
			},
		});
		gm.close();
	});

	it("GM setzt Karte und Grid, Spieler erhalten es; ungültige Grids werden abgewiesen", async () => {
		const { body: meta } = await upload(await testImage(100, 100));
		const gm = await RawClient.join(room.url, room.gm, { roomId: room.roomId });
		const p1 = await RawClient.join(room.url, room.p1.token);
		const snap = gm.received.find((m) => m.type === "snapshot");
		const sceneId =
			snap?.type === "snapshot"
				? snap.entities.find((e) => e.kind === "scene")?.id
				: undefined;

		const grid = {
			type: "hexPointy",
			size: 70,
			offsetX: 12,
			offsetY: -5,
			visible: true,
		};
		gm.send({
			type: "action",
			actionId: randomUUID(),
			action: {
				op: "update",
				kind: "scene",
				id: sceneId,
				patch: { map: meta.id, grid },
			},
		});
		expect(await gm.nextOf(["ack", "reject"])).toMatchObject({ type: "ack" });
		const change = await p1.next("changes");
		expect(change.changes[0]).toMatchObject({
			entity: { data: { map: meta.id, grid } },
		});

		gm.send({
			type: "action",
			actionId: randomUUID(),
			action: {
				op: "update",
				kind: "scene",
				id: sceneId,
				patch: { grid: { ...grid, size: 0 } },
			},
		});
		expect(await gm.nextOf(["ack", "reject"])).toMatchObject({
			type: "reject",
			reason: "invalid",
		});
		gm.close();
		p1.close();
	});
});
