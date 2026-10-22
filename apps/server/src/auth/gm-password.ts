import type { Db } from "../db/connection.ts";
import { hashPassword, verifyPassword } from "./password.ts";

const KEY = "gm_password_hash";

/**
 * Gleicht das GM-Passwort aus der Umgebung mit dem gespeicherten Hash ab.
 * Ist es neu oder geändert, wird der neue Hash gespeichert und alle
 * bestehenden GM-Sitzungen werden ungültig.
 */
export async function syncGmPassword(db: Db, password: string): Promise<void> {
	const stored = readHash(db);
	if (stored && (await verifyPassword(password, stored))) return;
	const hash = await hashPassword(password);
	db.transaction(() => {
		db.prepare(
			"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
		).run(KEY, hash);
		db.prepare("DELETE FROM sessions WHERE role = 'gm'").run();
	})();
}

export async function verifyGmPassword(
	db: Db,
	password: string,
): Promise<boolean> {
	const stored = readHash(db);
	return stored !== undefined && verifyPassword(password, stored);
}

function readHash(db: Db): string | undefined {
	return db
		.prepare<[string], { value: string }>(
			"SELECT value FROM settings WHERE key = ?",
		)
		.get(KEY)?.value;
}
