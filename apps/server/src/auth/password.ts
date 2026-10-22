import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const argon2Async = promisify(argon2);

// OWASP-Empfehlung für Argon2id: 19 MiB Speicher, 2 Durchläufe, Parallelität 1.
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };

/** Hash im PHC-Format: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>` (Base64 ohne Padding). */
export async function hashPassword(password: string): Promise<string> {
	const nonce = randomBytes(16);
	const tag = await argon2Async("argon2id", {
		...PARAMS,
		message: password,
		nonce,
	});
	const { memory: m, passes: t, parallelism: p } = PARAMS;
	return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(nonce)}$${b64(tag)}`;
}

export async function verifyPassword(
	password: string,
	phc: string,
): Promise<boolean> {
	const match =
		/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
			phc,
		);
	if (!match) return false;
	const [, m, t, p, salt, hash] = match;
	const expected = Buffer.from(hash as string, "base64");
	const actual = await argon2Async("argon2id", {
		memory: Number(m),
		passes: Number(t),
		parallelism: Number(p),
		tagLength: expected.length,
		message: password,
		nonce: Buffer.from(salt as string, "base64"),
	});
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function b64(buf: Buffer): string {
	return buf.toString("base64").replace(/=+$/, "");
}
