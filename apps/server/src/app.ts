import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MAX_MESSAGE_BYTES } from "@mistwarden/protocol";
import { WebSocketServer } from "ws";
import { AssetStore } from "./assets/store.ts";
import { syncGmPassword } from "./auth/gm-password.ts";
import { type Db, openDatabase } from "./db/connection.ts";
import { createApi } from "./http/api.ts";
import { createAssetHandler } from "./http/static-assets.ts";
import { ChangeLog } from "./sync/changelog.ts";
import { Hub } from "./sync/hub.ts";

export interface ServerOptions {
	host: string;
	port: number;
	databasePath: string;
	gmPassword: string;
	trustProxy: boolean;
	assetStoragePath: string;
	uploadMaxBytes: number;
}

export interface RunningServer {
	db: Db;
	hub: Hub;
	/** Tatsächlich gebundener Port (relevant bei port 0 in Tests). */
	port: number;
	close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
	const db = openDatabase(opts.databasePath);
	await syncGmPassword(db, opts.gmPassword);
	const assets = new AssetStore(db, opts.assetStoragePath, opts.uploadMaxBytes);
	const serveAssets = createAssetHandler(assets);

	const http = createServer((req, res) => {
		if (req.url === "/healthz") {
			res.writeHead(200, { "content-type": "text/plain" }).end("ok");
			return;
		}
		(async () => {
			if (await serveAssets(req, res)) return;
			if (await api(req, res)) return;
			res.writeHead(404).end();
		})().catch((err: unknown) => {
			console.error(err);
			if (!res.headersSent) res.writeHead(500);
			res.end();
		});
	});

	const wss = new WebSocketServer({
		server: http,
		path: "/ws",
		maxPayload: MAX_MESSAGE_BYTES,
	});
	const hub = new Hub(db, wss, new ChangeLog(db));
	const api = createApi({
		db,
		assets,
		uploadMaxBytes: opts.uploadMaxBytes,
		trustProxy: opts.trustProxy,
		applySystem: (roomId, action) => hub.applySystem(roomId, action),
	});

	await new Promise<void>((resolve, reject) => {
		http.once("error", reject);
		http.listen(opts.port, opts.host, resolve);
	});

	return {
		db,
		hub,
		port: (http.address() as AddressInfo).port,
		async close() {
			hub.close();
			await new Promise<void>((resolve) => wss.close(() => resolve()));
			http.closeAllConnections();
			await new Promise<void>((resolve) => http.close(() => resolve()));
			db.close();
		},
	};
}
