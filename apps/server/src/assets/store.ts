import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type AssetMeta, levelCount, TILE_SIZE } from "@mistwarden/protocol";
import sharp from "sharp";
import type { Db } from "../db/connection.ts";

/** Größte erlaubte Kantenlänge; schützt vor Dekompressionsbomben. */
export const MAX_EDGE = 30_000;
const WEBP_QUALITY = 82;
const FORMATS: Record<string, string> = {
	jpeg: "jpg",
	png: "png",
	webp: "webp",
};

// Kein Bildcache in libvips: Karten werden einmal verarbeitet, nicht wiederholt gelesen.
sharp.cache(false);

export class AssetError extends Error {
	readonly code: "too_large" | "unsupported" | "too_many_pixels";
	constructor(code: AssetError["code"]) {
		super(code);
		this.code = code;
	}
}

interface AssetRow {
	id: string;
	name: string;
	width: number;
	height: number;
	tile_size: number;
	levels: number;
	created_at: number;
}

function toMeta(r: AssetRow): AssetMeta {
	return {
		id: r.id,
		name: r.name,
		width: r.width,
		height: r.height,
		tileSize: r.tile_size,
		levels: r.levels,
		createdAt: r.created_at,
	};
}

/**
 * Nimmt Bilder entgegen und legt sie als Kachelpyramide ab:
 * `<root>/<id>/original.<ext>` (wird nie ausgeliefert) und `<root>/<id>/tiles/<stufe>/<x>_<y>.webp`.
 * Uploads werden nacheinander verarbeitet, damit große Karten den Speicher nicht sprengen.
 */
export class AssetStore {
	readonly #root: string;
	readonly #db: Db;
	readonly #maxBytes: number;
	#queue: Promise<unknown> = Promise.resolve();

	constructor(db: Db, root: string, maxBytes: number) {
		this.#db = db;
		this.#root = root;
		this.#maxBytes = maxBytes;
	}

	/** Liest den Upload in eine temporäre Datei, prüft ihn und erzeugt die Kacheln. */
	async ingest(input: Readable, name: string): Promise<AssetMeta> {
		const id = randomUUID();
		const dir = join(this.#root, id);
		const upload = join(dir, "upload");
		await mkdir(dir, { recursive: true });
		try {
			await this.#receive(input, upload);
			const run = this.#queue.then(() => this.#process(id, dir, upload, name));
			this.#queue = run.catch(() => {});
			return await run;
		} catch (err) {
			await rm(dir, { recursive: true, force: true });
			throw err;
		}
	}

	get(id: string): AssetMeta | undefined {
		const row = this.#db
			.prepare<[string], AssetRow>("SELECT * FROM assets WHERE id = ?")
			.get(id);
		return row && toMeta(row);
	}

	list(): AssetMeta[] {
		return this.#db
			.prepare<[], AssetRow>("SELECT * FROM assets ORDER BY created_at DESC")
			.all()
			.map(toMeta);
	}

	/** Pfad einer Kachel (Stufe 0 = volle Auflösung) oder undefined, wenn es sie nicht gibt. */
	tilePath(
		id: string,
		level: number,
		x: number,
		y: number,
	): string | undefined {
		const meta = this.get(id);
		if (!meta || level < 0 || level >= meta.levels) return undefined;
		// Deep-Zoom-Ablage von libvips: 0 ist die gröbste Stufe.
		const dzLevel = meta.levels - 1 - level;
		return join(
			this.#root,
			id,
			"tiles_files",
			String(dzLevel),
			`${x}_${y}.webp`,
		);
	}

	async #receive(input: Readable, path: string): Promise<void> {
		let size = 0;
		const limit = this.#maxBytes;
		await pipeline(
			input,
			async function* (source: AsyncIterable<Buffer>) {
				for await (const chunk of source) {
					size += chunk.length;
					if (size > limit) throw new AssetError("too_large");
					yield chunk;
				}
			},
			createWriteStream(path),
		);
	}

	async #process(
		id: string,
		dir: string,
		upload: string,
		name: string,
	): Promise<AssetMeta> {
		// Dateityp aus dem Inhalt, nicht aus Endung oder Content-Type.
		const meta = await sharp(upload, { limitInputPixels: false })
			.metadata()
			.catch(() => {
				throw new AssetError("unsupported");
			});
		const ext = meta.format ? FORMATS[meta.format] : undefined;
		if (!ext || !meta.width || !meta.height)
			throw new AssetError("unsupported");
		// EXIF-Drehung berücksichtigen: Breite und Höhe nach dem Aufrichten.
		const rotated = (meta.orientation ?? 1) >= 5;
		const width = rotated ? meta.height : meta.width;
		const height = rotated ? meta.width : meta.height;
		if (width > MAX_EDGE || height > MAX_EDGE) {
			throw new AssetError("too_many_pixels");
		}

		// Neu kodieren statt Originale auszuliefern; Metadaten (EXIF, GPS) fallen dabei weg.
		await sharp(upload, { limitInputPixels: MAX_EDGE * MAX_EDGE })
			.autoOrient()
			.webp({ quality: WEBP_QUALITY })
			.tile({ size: TILE_SIZE, overlap: 0, depth: "onetile", layout: "dz" })
			.toFile(join(dir, "tiles"));

		const levels = levelCount(width, height, TILE_SIZE);
		const written = await readdir(join(dir, "tiles_files"));
		if (written.filter((f) => /^\d+$/.test(f)).length !== levels) {
			throw new Error(
				`Unerwartete Kachelstufen für ${id}: ${written.join(",")}`,
			);
		}
		await rename(upload, join(dir, `original.${ext}`));

		const row: AssetRow = {
			id,
			name: name.slice(0, 200) || "Bild",
			width,
			height,
			tile_size: TILE_SIZE,
			levels,
			created_at: Date.now(),
		};
		this.#db
			.prepare(
				`INSERT INTO assets (id, name, width, height, tile_size, levels, original_ext, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				row.id,
				row.name,
				width,
				height,
				TILE_SIZE,
				levels,
				ext,
				row.created_at,
			);
		return toMeta(row);
	}
}
