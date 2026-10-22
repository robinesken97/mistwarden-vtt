import { readdirSync, readFileSync } from "node:fs";
import type { Db } from "./connection.ts";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

/**
 * Wendet alle SQL-Dateien `NNN_name.sql` an, deren Nummer größer ist als
 * PRAGMA user_version. Jede Migration läuft in einer eigenen Transaktion.
 */
export function migrate(db: Db): void {
	const current = db.pragma("user_version", { simple: true }) as number;
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => /^\d{3}_.+\.sql$/.test(f))
		.sort();

	for (const file of files) {
		const number = Number.parseInt(file.slice(0, 3), 10);
		if (number <= current) continue;
		const sql = readFileSync(new URL(file, MIGRATIONS_DIR), "utf8");
		db.transaction(() => {
			db.exec(sql);
			db.pragma(`user_version = ${number}`);
		})();
	}
}
