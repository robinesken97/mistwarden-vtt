import { startServer } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const server = await startServer(config);

console.log(
	`Mistwarden läuft auf ${config.host}:${server.port}` +
		(config.publicBaseUrl ? ` (öffentlich: ${config.publicBaseUrl})` : ""),
);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
	if (stopping) return;
	stopping = true;
	console.log(`${signal} empfangen, fahre herunter …`);
	await server.close();
	process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
