import { z } from "zod";

const EnvSchema = z.object({
	HOST: z.string().min(1).default("127.0.0.1"),
	PORT: z.coerce.number().int().min(0).max(65535).default(3000),
	/** Öffentliche Adresse hinter dem Reverse Proxy; keine LAN-Annahmen im Code. */
	PUBLIC_BASE_URL: z.url().optional(),
	DATABASE_PATH: z.string().min(1).default("./data/mistwarden.sqlite"),
});

export interface Config {
	host: string;
	port: number;
	publicBaseUrl: string | undefined;
	databasePath: string;
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
	};
}
