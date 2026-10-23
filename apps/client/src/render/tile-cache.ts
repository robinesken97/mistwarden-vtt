import type { TileRef } from "./tiles.ts";

/** Geladene Kachel; `release` gibt Grafik- und Bildspeicher frei. */
export interface LoadedTile<T> {
	value: T;
	bytes: number;
	release(): void;
}

export type TileLoader<T> = (tile: TileRef) => Promise<LoadedTile<T>>;

interface Entry<T> {
	tile: TileRef;
	loaded?: LoadedTile<T>;
	loading: boolean;
	failed: boolean;
	lastUsed: number;
}

/**
 * Lädt Kacheln nacheinander (begrenzte Parallelität, keine Speicherspitzen beim Dekodieren)
 * und hält höchstens `budgetBytes` im Speicher. Zuerst fliegen Kacheln, die nicht mehr
 * gebraucht werden und am längsten nicht zu sehen waren.
 */
export class TileCache<T> {
	readonly #entries = new Map<string, Entry<T>>();
	readonly #queue: string[] = [];
	readonly #load: TileLoader<T>;
	readonly #budget: number;
	readonly #concurrency: number;
	readonly #onChange: () => void;
	#active = 0;
	#clock = 0;
	#wanted = new Set<string>();
	#destroyed = false;

	constructor(opts: {
		load: TileLoader<T>;
		budgetBytes: number;
		concurrency?: number;
		onChange: () => void;
	}) {
		this.#load = opts.load;
		this.#budget = opts.budgetBytes;
		this.#concurrency = opts.concurrency ?? 2;
		this.#onChange = opts.onChange;
	}

	get usedBytes(): number {
		let sum = 0;
		for (const e of this.#entries.values()) sum += e.loaded?.bytes ?? 0;
		return sum;
	}

	/** Setzt die aktuell benötigten Kacheln (wichtigste zuerst) und stößt das Laden an. */
	want(tiles: TileRef[]): void {
		const tick = ++this.#clock;
		this.#wanted = new Set(tiles.map((t) => t.key));
		this.#queue.length = 0;
		for (const tile of tiles) {
			let entry = this.#entries.get(tile.key);
			if (!entry) {
				entry = { tile, loading: false, failed: false, lastUsed: tick };
				this.#entries.set(tile.key, entry);
			}
			entry.lastUsed = tick;
			if (!entry.loaded && !entry.loading && !entry.failed) {
				this.#queue.push(tile.key);
			}
		}
		this.#evict();
		this.#pump();
	}

	get(key: string): T | undefined {
		return this.#entries.get(key)?.loaded?.value;
	}

	destroy(): void {
		this.#destroyed = true;
		for (const e of this.#entries.values()) e.loaded?.release();
		this.#entries.clear();
		this.#queue.length = 0;
	}

	#pump(): void {
		while (this.#active < this.#concurrency && this.#queue.length > 0) {
			const key = this.#queue.shift() as string;
			const entry = this.#entries.get(key);
			if (!entry || entry.loaded || entry.loading) continue;
			entry.loading = true;
			this.#active++;
			this.#load(entry.tile)
				.then((loaded) => {
					if (this.#destroyed || this.#entries.get(key) !== entry) {
						loaded.release();
						return;
					}
					entry.loaded = loaded;
					this.#evict();
					this.#onChange();
				})
				.catch(() => {
					entry.failed = true;
				})
				.finally(() => {
					entry.loading = false;
					this.#active--;
					if (!this.#destroyed) this.#pump();
				});
		}
	}

	#evict(): void {
		let used = this.usedBytes;
		if (used <= this.#budget) return;
		const candidates = [...this.#entries.entries()]
			.filter(([key, e]) => e.loaded && !this.#wanted.has(key))
			.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
		for (const [key, e] of candidates) {
			if (used <= this.#budget) break;
			used -= e.loaded?.bytes ?? 0;
			e.loaded?.release();
			this.#entries.delete(key);
		}
		// Nicht geladene, nicht mehr benötigte Einträge aufräumen.
		for (const [key, e] of this.#entries) {
			if (!e.loaded && !e.loading && !this.#wanted.has(key)) {
				this.#entries.delete(key);
			}
		}
	}
}
