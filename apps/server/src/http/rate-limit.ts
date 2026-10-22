/**
 * Einfache Ratenbegrenzung im Speicher: höchstens `limit` Versuche pro Schlüssel
 * (z. B. Client-IP) innerhalb von `windowMs`. Reicht für eine Installation mit einem Prozess.
 */
export class RateLimiter {
	readonly #limit: number;
	readonly #windowMs: number;
	readonly #hits = new Map<string, { count: number; resetAt: number }>();

	constructor(limit: number, windowMs: number) {
		this.#limit = limit;
		this.#windowMs = windowMs;
	}

	/** Zählt einen Versuch; false, wenn das Limit erreicht ist. */
	take(key: string, now = Date.now()): boolean {
		let entry = this.#hits.get(key);
		if (!entry || entry.resetAt <= now) {
			entry = { count: 0, resetAt: now + this.#windowMs };
			this.#hits.set(key, entry);
			if (this.#hits.size > 10_000) this.#sweep(now);
		}
		entry.count++;
		return entry.count <= this.#limit;
	}

	#sweep(now: number): void {
		for (const [key, entry] of this.#hits) {
			if (entry.resetAt <= now) this.#hits.delete(key);
		}
	}
}
