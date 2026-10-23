import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AssetStore } from "../assets/store.ts";

const META = /^\/assets\/([0-9a-f-]{36})\/meta\.json$/;
const TILE =
	/^\/assets\/([0-9a-f-]{36})\/(\d{1,2})\/(\d{1,4})_(\d{1,4})\.webp$/;

/**
 * Liefert Metadaten und Kacheln aus – ohne Anmeldung, geschützt durch die zufällige
 * Asset-ID. Originale werden nie ausgeliefert. Kacheln ändern sich nie: langes Caching.
 */
export function createAssetHandler(assets: AssetStore) {
	return async function handle(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<boolean> {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		if (!path.startsWith("/assets/")) return false;
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405).end();
			return true;
		}

		const meta = META.exec(path);
		if (meta) {
			const asset = assets.get(meta[1] as string);
			if (!asset) return notFound(res);
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "public, max-age=31536000, immutable",
			});
			res.end(req.method === "HEAD" ? undefined : JSON.stringify(asset));
			return true;
		}

		const tile = TILE.exec(path);
		const file =
			tile &&
			assets.tilePath(
				tile[1] as string,
				Number(tile[2]),
				Number(tile[3]),
				Number(tile[4]),
			);
		if (!file) return notFound(res);
		const info = await stat(file).catch(() => undefined);
		if (!info?.isFile()) return notFound(res);
		res.writeHead(200, {
			"content-type": "image/webp",
			"content-length": info.size,
			"cache-control": "public, max-age=31536000, immutable",
		});
		if (req.method === "HEAD") res.end();
		else createReadStream(file).pipe(res);
		return true;
	};
}

function notFound(res: ServerResponse): true {
	res.writeHead(404, { "cache-control": "no-store" }).end();
	return true;
}
