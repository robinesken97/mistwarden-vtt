import { z } from "zod";

const EnvSchema = z.object({
	HOST: z.string().min(1).default("127.0.0.1"),
	PORT: z.coerce.number().int().min(0).max(65535).default(3000),
	/** Öffentliche Adresse hinter dem Reverse Proxy; keine LAN-Annahmen im Code. */
	PUBLIC_BASE_URL: z.url().optional(),
	DATABASE_PATH: z.string().min(1).default("./data/mistwarden.sqlite"),
	/** Ablage für Originale und Kacheln, z. B. ein Bind-Mount auf das NAS. */
	ASSET_STORAGE_PATH: z.string().min(1).default("./data/assets"),
	UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(2000).default(200),
	/** Pflicht, ohne Standardwert. Wird beim Start als Argon2-Hash gespeichert. */
	GM_PASSWORD: z
		.string({ error: "GM_PASSWORD muss gesetzt sein" })
		.min(10, "GM_PASSWORD muss mindestens 10 Zeichen lang sein"),
	/** true, wenn ein Reverse Proxy davor sitzt (Client-IP aus X-Forwarded-For für die Ratenbegrenzung). */
	TRUST_PROXY: z.stringbool().default(false),
});

export interface Config {
	host: string;
	port: number;
	publicBaseUrl: string | undefined;
	databasePath: string;
	assetStoragePath: string;
	uploadMaxBytes: number;
	gmPassword: string;
	trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const result = EnvSchema.safeParse(env);
	if (!result.success) {
		throw new Error(
			`Ungültige Konfiguration:\n${z.prettifyError(result.error)}`,
		);
	}
	const e = result.data;
	return {
		host: e.HOST,
		port: e.PORT,
		publicBaseUrl: e.PUBLIC_BASE_URL,
		databasePath: e.DATABASE_PATH,
		assetStoragePath: e.ASSET_STORAGE_PATH,
		uploadMaxBytes: e.UPLOAD_MAX_MB * 1024 * 1024,
		gmPassword: e.GM_PASSWORD,
		trustProxy: e.TRUST_PROXY,
	};
}
