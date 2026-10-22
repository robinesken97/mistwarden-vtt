import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MAX_MESSAGE_BYTES } from "@mistwarden/protocol";
import { WebSocketServer } from "ws";
import { type Db, openDatabase } from "./db/connection.ts";
import { Hub } from "./sync/hub.ts";

export interface ServerOptions {
	host: string;
	port: number;
	databasePath: string;
}

export interface RunningServer {
	db: Db;
	/** Tatsächlich gebundener Port (relevant bei port 0 in Tests). */
	port: number;
	close(): Promise<void>;
}

export { createPlayer, createRoom, createSession } from "./rooms.ts";

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
	const db = openDatabase(opts.databasePath);

	const http = createServer((req, res) => {
		if (req.url === "/healthz") {
			res.writeHead(200, { "content-type": "text/plain" }).end("ok");
			return;
		}
		res.writeHead(404).end();
	});

	const wss = new WebSocketServer({
		server: http,
		path: "/ws",
		maxPayload: MAX_MESSAGE_BYTES,
	});
	const hub = new Hub(db, wss);

	await new Promise<void>((resolve, reject) => {
		http.once("error", reject);
		http.listen(opts.port, opts.host, resolve);
	});

	return {
		db,
		port: (http.address() as AddressInfo).port,
		async close() {
			hub.close();
			await new Promise<void>((resolve) => wss.close(() => resolve()));
			await new Promise<void>((resolve) => http.close(() => resolve()));
			db.close();
		},
	};
}
