import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};

/** Von Vite mit Inhalts-Hash benannte Dateien ändern sich nie. */
const HASHED = /^\/app\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2|svg|png)$/;

/**
 * Liefert den gebauten Client (apps/client/dist) aus. Unbekannte Pfade ohne Endung
 * bekommen index.html (Routen wie /room/<id>), damit Neuladen und PWA-Start funktionieren.
 */
export function createClientHandler(root: string) {
	const base = normalize(root + sep);
	return async function handle(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<boolean> {
		if (req.method !== "GET" && req.method !== "HEAD") return false;
		let path: string;
		try {
			path = decodeURIComponent(
				new URL(req.url ?? "/", "http://localhost").pathname,
			);
		} catch {
			return false;
		}
		if (path.includes("\0")) return false;
		let file = normalize(join(base, path));
		if (!file.startsWith(base)) return false;
		let info = await stat(file).catch(() => undefined);
		if (!info?.isFile()) {
			// Nur Seitenrouten (ohne Dateiendung) fallen auf index.html zurück.
			if (extname(path) !== "") return false;
			file = join(base, "index.html");
			info = await stat(file).catch(() => undefined);
			if (!info?.isFile()) return false;
		}
		const type = TYPES[extname(file)] ?? "application/octet-stream";
		res.writeHead(200, {
			"content-type": type,
			"content-length": info.size,
			// Ungehashte Dateien (index.html, sw.js, Manifest) immer neu prüfen.
			"cache-control": HASHED.test(path)
				? "public, max-age=31536000, immutable"
				: "no-cache",
			"x-content-type-options": "nosniff",
		});
		if (req.method === "HEAD") res.end();
		else createReadStream(file).pipe(res);
		return true;
	};
}
