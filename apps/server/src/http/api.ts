import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ApiErrorCode,
	type AssetMeta,
	CreateRoomRequestSchema,
	GmLoginRequestSchema,
	type GmLoginResponse,
	JoinRequestSchema,
	type JoinResponse,
	type LinkInfoResponse,
	LinkRequestSchema,
	type RoomSummary,
	type SessionResponse,
	UPLOAD_CONTENT_TYPES,
} from "@mistwarden/protocol";
import type { z } from "zod";
import { AssetError, type AssetStore } from "../assets/store.ts";
import { verifyGmPassword } from "../auth/gm-password.ts";
import type { Db } from "../db/connection.ts";
import {
	type ApplySystemAction,
	createGmSession,
	createRoom,
	deleteSession,
	findRoomByLink,
	findSession,
	joinRoom,
	listRooms,
	regeneratePlayerLink,
	type Session,
} from "../rooms.ts";
import { RateLimiter } from "./rate-limit.ts";

const MAX_BODY_BYTES = 16 * 1024;

export interface ApiDeps {
	db: Db;
	applySystem: ApplySystemAction;
	assets: AssetStore;
	uploadMaxBytes: number;
	/** X-Forwarded-For nur auswerten, wenn ein Reverse Proxy davor sitzt. */
	trustProxy: boolean;
}

class HttpError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;
	constructor(status: number, code: ApiErrorCode) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

interface Ctx {
	req: IncomingMessage;
	params: string[];
	body<S extends z.ZodType>(schema: S): Promise<z.infer<S>>;
	session(): Session;
	gm(): Session;
	ip: string;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
	method: string;
	pattern: RegExp;
	handler: Handler;
}

/** HTTP-API unter /api für Anmeldung und Raumverwaltung. */
export function createApi(deps: ApiDeps) {
	const { db, applySystem } = deps;
	// Login: 5 Versuche pro Minute und IP. Beitreten: 20 pro Minute und IP.
	const loginLimit = new RateLimiter(5, 60_000);
	const joinLimit = new RateLimiter(20, 60_000);

	const routes: Route[] = [];
	const route = (method: string, path: string, handler: Handler) => {
		const pattern = new RegExp(`^${path.replace(/:\w+/g, "([^/]+)")}$`);
		routes.push({ method, pattern, handler });
	};

	route("POST", "/api/gm/login", async (ctx): Promise<GmLoginResponse> => {
		if (!loginLimit.take(ctx.ip)) {
			throw new HttpError(429, "too_many_requests");
		}
		const { password } = await ctx.body(GmLoginRequestSchema);
		if (!(await verifyGmPassword(db, password))) {
			throw new HttpError(401, "unauthorized");
		}
		return { token: createGmSession(db) };
	});

	route("POST", "/api/logout", (ctx) => {
		ctx.session();
		deleteSession(db, bearer(ctx.req) as string);
		return {};
	});

	route("GET", "/api/session", (ctx): SessionResponse => {
		const { identity, roomId } = ctx.session();
		return { identity, roomId };
	});

	route("GET", "/api/rooms", (ctx): RoomSummary[] => {
		ctx.gm();
		return listRooms(db);
	});

	route("POST", "/api/rooms", async (ctx): Promise<RoomSummary> => {
		ctx.gm();
		const { name } = await ctx.body(CreateRoomRequestSchema);
		return createRoom(db, applySystem, name);
	});

	route("POST", "/api/rooms/:id/player-link", (ctx) => {
		ctx.gm();
		const token = regeneratePlayerLink(db, ctx.params[0] as string);
		if (!token) throw new HttpError(404, "not_found");
		return { playerLinkToken: token };
	});

	route("POST", "/api/join/info", async (ctx): Promise<LinkInfoResponse> => {
		if (!joinLimit.take(ctx.ip)) {
			throw new HttpError(429, "too_many_requests");
		}
		const { linkToken } = await ctx.body(LinkRequestSchema);
		const room = findRoomByLink(db, linkToken);
		if (!room) throw new HttpError(404, "not_found");
		return { roomId: room.id, roomName: room.name };
	});

	route("GET", "/api/assets", (ctx): AssetMeta[] => {
		ctx.gm();
		return deps.assets.list();
	});

	// Bild als Rohdaten im Body (kein Formular); Name optional im Header X-Asset-Name.
	route("POST", "/api/assets", async (ctx): Promise<AssetMeta> => {
		ctx.gm();
		const type = ctx.req.headers["content-type"]?.split(";")[0]?.trim();
		if (!UPLOAD_CONTENT_TYPES.includes(type as never)) {
			throw new HttpError(415, "unsupported");
		}
		const length = Number(ctx.req.headers["content-length"]);
		if (length > deps.uploadMaxBytes) throw new HttpError(413, "too_large");
		const rawName = ctx.req.headers["x-asset-name"];
		let name = "Bild";
		try {
			if (typeof rawName === "string") name = decodeURIComponent(rawName);
		} catch {
			// unlesbarer Name: Standard behalten
		}
		try {
			return await deps.assets.ingest(ctx.req, name);
		} catch (err) {
			if (err instanceof AssetError) {
				throw err.code === "unsupported"
					? new HttpError(415, "unsupported")
					: new HttpError(413, "too_large");
			}
			throw err;
		}
	});

	route("POST", "/api/join", async (ctx): Promise<JoinResponse> => {
		if (!joinLimit.take(ctx.ip)) {
			throw new HttpError(429, "too_many_requests");
		}
		const { linkToken, displayName } = await ctx.body(JoinRequestSchema);
		const result = joinRoom(db, applySystem, linkToken, displayName);
		if (result.status === "not_found") throw new HttpError(404, "not_found");
		if (result.status === "room_full") throw new HttpError(409, "room_full");
		return {
			token: result.token,
			roomId: result.roomId,
			playerId: result.playerId,
		};
	});

	/** Beantwortet Anfragen unter /api; false, wenn der Pfad nicht zur API gehört. */
	return async function handle(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<boolean> {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (!url.pathname.startsWith("/api/")) return false;

		const matching = routes.filter((r) => r.pattern.test(url.pathname));
		const match = matching.find((r) => r.method === req.method);
		try {
			if (!match) {
				throw new HttpError(matching.length ? 405 : 404, "not_found");
			}
			const ctx = makeCtx(req, url, match, deps);
			sendJson(res, 200, await match.handler(ctx));
		} catch (err) {
			// Ungelesenen Body (z. B. abgelehnter Upload) nicht abwarten: Verbindung danach schließen.
			if (!req.complete) res.shouldKeepAlive = false;
			if (err instanceof HttpError) {
				sendJson(res, err.status, { error: err.code });
			} else {
				console.error(err);
				sendJson(res, 500, { error: "internal" });
			}
		}
		return true;
	};
}

function makeCtx(
	req: IncomingMessage,
	url: URL,
	route: Route,
	deps: ApiDeps,
): Ctx {
	let session: Session | undefined;
	const ctx: Ctx = {
		req,
		params: (route.pattern.exec(url.pathname) ?? [])
			.slice(1)
			.map(decodeURIComponent),
		ip: clientIp(req, deps.trustProxy),
		async body(schema) {
			const parsed = schema.safeParse(await readJson(req));
			if (!parsed.success) throw new HttpError(400, "bad_request");
			return parsed.data;
		},
		session() {
			const token = bearer(req);
			session ??= token ? findSession(deps.db, token) : undefined;
			if (!session) throw new HttpError(401, "unauthorized");
			return session;
		},
		gm() {
			const s = ctx.session();
			if (s.identity.role !== "gm") throw new HttpError(403, "forbidden");
			return s;
		},
	};
	return ctx;
}

function bearer(req: IncomingMessage): string | undefined {
	const header = req.headers.authorization;
	return header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
	if (trustProxy) {
		const forwarded = req.headers["x-forwarded-for"];
		const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
			?.split(",")[0]
			?.trim();
		if (first) return first;
	}
	return req.socket.remoteAddress ?? "unknown";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	if (!req.headers["content-type"]?.startsWith("application/json")) {
		throw new HttpError(400, "bad_request");
	}
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new HttpError(400, "bad_request");
		chunks.push(chunk as Buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new HttpError(400, "bad_request");
	}
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}
