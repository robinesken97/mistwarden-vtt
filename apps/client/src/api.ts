import {
	type ApiErrorCode,
	type AssetMeta,
	assetMetaUrl,
	type GmLoginResponse,
	type JoinResponse,
	type LinkInfoResponse,
	type RoomSummary,
	type SessionResponse,
} from "@mistwarden/protocol";
import { t } from "./i18n.ts";

export class ApiError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode | "network";
	constructor(status: number, code: ApiErrorCode | "network") {
		super(code);
		this.status = status;
		this.code = code;
	}
}

/** Relativ zur aktuellen Seite – keine fest eingebauten Hosts. */
async function call<T>(
	path: string,
	opts: { token?: string | null; body?: unknown } = {},
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: opts.body === undefined ? "GET" : "POST",
			headers: {
				...(opts.body === undefined
					? {}
					: { "content-type": "application/json" }),
				...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
			},
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		});
	} catch {
		throw new ApiError(0, "network");
	}
	const body = (await res.json().catch(() => ({}))) as { error?: ApiErrorCode };
	if (!res.ok) throw new ApiError(res.status, body.error ?? "internal");
	return body as T;
}

/** Lädt ein Bild als Rohdaten hoch; der Server erzeugt daraus die Kachelpyramide. */
async function uploadAsset(
	token: string,
	file: File,
	purpose: AssetMeta["purpose"] = "map",
): Promise<AssetMeta> {
	let res: Response;
	try {
		res = await fetch(`/api/assets?purpose=${purpose}`, {
			method: "POST",
			headers: {
				"content-type": file.type,
				"x-asset-name": encodeURIComponent(file.name.replace(/\.[^.]+$/, "")),
				authorization: `Bearer ${token}`,
			},
			body: file,
		});
	} catch {
		throw new ApiError(0, "network");
	}
	const body = (await res.json().catch(() => ({}))) as { error?: ApiErrorCode };
	if (!res.ok) throw new ApiError(res.status, body.error ?? "internal");
	return body as AssetMeta;
}

const metaCache = new Map<string, Promise<AssetMeta>>();

/** Metadaten eines Bildes (öffentlich, unveränderlich, daher zwischengespeichert). */
export function assetMeta(id: string): Promise<AssetMeta> {
	let meta = metaCache.get(id);
	if (!meta) {
		meta = fetch(assetMetaUrl(id)).then((res) => {
			if (!res.ok) throw new ApiError(res.status, "not_found");
			return res.json() as Promise<AssetMeta>;
		});
		meta.catch(() => metaCache.delete(id));
		metaCache.set(id, meta);
	}
	return meta;
}

export const api = {
	uploadAsset,
	assets: (token: string) => call<AssetMeta[]>("/api/assets", { token }),
	gmLogin: (password: string) =>
		call<GmLoginResponse>("/api/gm/login", { body: { password } }),
	logout: (token: string) => call("/api/logout", { token, body: {} }),
	session: (token: string) => call<SessionResponse>("/api/session", { token }),
	rooms: (token: string) => call<RoomSummary[]>("/api/rooms", { token }),
	createRoom: (token: string, name: string) =>
		call<RoomSummary>("/api/rooms", { token, body: { name } }),
	regenerateLink: (token: string, roomId: string) =>
		call<{ playerLinkToken: string }>(
			`/api/rooms/${encodeURIComponent(roomId)}/player-link`,
			{ token, body: {} },
		),
	/** Raum als Datei (JSON mit Bildern); liefert sie als Blob zum Speichern. */
	async exportRoom(token: string, roomId: string): Promise<Blob> {
		let res: Response;
		try {
			res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/export`, {
				headers: { authorization: `Bearer ${token}` },
			});
		} catch {
			throw new ApiError(0, "network");
		}
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as {
				error?: ApiErrorCode;
			};
			throw new ApiError(res.status, body.error ?? "internal");
		}
		return res.blob();
	},
	/** Exportdatei unverändert hochladen; der Server legt daraus einen neuen Raum an. */
	async importRoom(token: string, file: File): Promise<RoomSummary> {
		let res: Response;
		try {
			res = await fetch("/api/rooms/import", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${token}`,
				},
				body: file,
			});
		} catch {
			throw new ApiError(0, "network");
		}
		const body = (await res.json().catch(() => ({}))) as {
			error?: ApiErrorCode;
		};
		if (!res.ok) throw new ApiError(res.status, body.error ?? "internal");
		return body as RoomSummary;
	},
	linkInfo: (linkToken: string) =>
		call<LinkInfoResponse>("/api/join/info", { body: { linkToken } }),
	join: (linkToken: string, displayName: string) =>
		call<JoinResponse>("/api/join", { body: { linkToken, displayName } }),
};

const ERROR_KEYS = {
	unauthorized: "error.unauthorized",
	too_many_requests: "error.too_many_requests",
	not_found: "error.not_found",
	room_full: "error.room_full",
	network: "error.network",
	bad_request: "error.bad_request",
	unsupported: "error.unsupported",
	too_large: "error.too_large",
	invalid_import: "error.invalid_import",
} as const;

export function errorText(err: unknown): string {
	if (!(err instanceof ApiError)) return String(err);
	return t(
		ERROR_KEYS[err.code as keyof typeof ERROR_KEYS] ?? "error.unexpected",
	);
}

/** Vollständiger Spieler-Link; der Token steht hinter #, damit er in keinem Server-Log landet. */
export function playerLink(linkToken: string): string {
	return `${location.origin}/join#${linkToken}`;
}
