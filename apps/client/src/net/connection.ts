import {
	type Action,
	type Change,
	CLOSE_PROTOCOL,
	CLOSE_UNAUTHORIZED,
	type ClientMessage,
	type Entity,
	entityKey,
	type Identity,
	PROTOCOL_VERSION,
	type RejectReason,
	type ServerMessage,
} from "@mistwarden/protocol";

/** So lange darf die Antwort auf den Prüf-Ping nach wake() dauern. */
const PROBE_TIMEOUT_MS = 4000;

export type ConnectionStatus =
	| "connecting"
	| "online"
	| "offline"
	| "unauthorized";

export interface ConnectionOptions {
	url: string;
	token: string;
	/** Raum, den die GM betreten will; bei Spielern ergibt er sich aus der Sitzung. */
	roomId?: string;
	/** Austauschbar für Tests in Node. */
	WebSocket?: typeof WebSocket;
	/** Spätestens nach dieser Stille gilt die Verbindung als tot. */
	staleAfterMs?: number;
	pingEveryMs?: number;
	maxBackoffMs?: number;
}

export class ActionRejected extends Error {
	readonly reason: RejectReason;
	constructor(reason: RejectReason) {
		super(`Aktion abgelehnt: ${reason}`);
		this.reason = reason;
	}
}

interface Pending {
	actionId: string;
	action: Action;
	resolve: (version: number) => void;
	reject: (err: Error) => void;
}

/**
 * Hält die Verbindung zum Server und den daraus gespiegelten Raumzustand.
 *
 * Safari kappt WebSockets bei Displaysperre oder im Hintergrund, oft ohne
 * close-Ereignis. Deshalb: eigene Pings, Totmannschalter, Neuverbindung mit
 * Backoff und `wake()` für visibilitychange/online. Nach jedem Reconnect holt
 * der Client nur die fehlenden Änderungen (ab `version`) und sendet noch nicht
 * bestätigte Aktionen erneut; der Server erkennt Doppelte an der actionId.
 */
export class SyncConnection {
	readonly entities = new Map<string, Entity>();
	version: number | null = null;
	identity: Identity | null = null;
	roomName: string | null = null;
	status: ConnectionStatus = "offline";

	readonly #opts: Required<Omit<ConnectionOptions, "WebSocket" | "roomId">> & {
		roomId: string | undefined;
	};
	readonly #WebSocket: typeof WebSocket;
	readonly #listeners = new Set<() => void>();
	readonly #pending = new Map<string, Pending>();
	#ws: WebSocket | null = null;
	#stopped = true;
	#attempt = 0;
	#reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	#watchdog: ReturnType<typeof setInterval> | undefined;
	#lastReceived = 0;
	#lastPing = 0;
	/** Gesetzt, solange nach wake() auf eine Antwort gewartet wird. */
	#probeSentAt: number | null = null;

	constructor(opts: ConnectionOptions) {
		this.#opts = {
			url: opts.url,
			token: opts.token,
			roomId: opts.roomId,
			staleAfterMs: opts.staleAfterMs ?? 25_000,
			pingEveryMs: opts.pingEveryMs ?? 10_000,
			maxBackoffMs: opts.maxBackoffMs ?? 10_000,
		};
		this.#WebSocket = opts.WebSocket ?? globalThis.WebSocket;
	}

	/** Wird bei jeder Änderung von Status oder Zustand aufgerufen. */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	start(): void {
		if (!this.#stopped) return;
		this.#stopped = false;
		this.#connect();
		this.#watchdog = setInterval(
			() => this.#checkStale(),
			Math.min(2000, this.#opts.pingEveryMs),
		);
	}

	stop(): void {
		this.#stopped = true;
		clearTimeout(this.#reconnectTimer);
		clearInterval(this.#watchdog);
		this.#ws?.close();
		this.#ws = null;
		this.#setStatus("offline");
	}

	/**
	 * Nach Rückkehr aus dem Hintergrund oder Netzwechsel aufrufen: verbindet
	 * sofort neu bzw. prüft eine scheinbar offene Verbindung mit einem Ping.
	 */
	wake(): void {
		if (this.#stopped || this.status === "unauthorized") return;
		if (this.#ws?.readyState === this.#WebSocket.OPEN) {
			this.#probeSentAt ??= Date.now();
			this.#send({ type: "ping" });
			return;
		}
		this.#attempt = 0;
		this.#reconnectNow();
	}

	/** Sendet eine Aktion; löst mit der Raumversion auf, sobald der Server sie bestätigt. */
	send(action: Action): Promise<number> {
		const actionId = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			this.#pending.set(actionId, { actionId, action, resolve, reject });
			if (this.status === "online") {
				this.#send({ type: "action", actionId, action });
			}
		});
	}

	#connect(): void {
		this.#setStatus("connecting");
		const ws = new this.#WebSocket(this.#opts.url);
		this.#ws = ws;
		this.#lastReceived = Date.now();

		ws.onopen = () => {
			this.#send({
				type: "hello",
				protocol: PROTOCOL_VERSION,
				token: this.#opts.token,
				...(this.#opts.roomId ? { roomId: this.#opts.roomId } : {}),
				lastVersion: this.version,
			});
		};
		ws.onmessage = (event) => {
			if (ws !== this.#ws) return;
			this.#lastReceived = Date.now();
			this.#probeSentAt = null;
			this.#handle(JSON.parse(String(event.data)) as ServerMessage);
		};
		ws.onclose = (event) => {
			if (ws !== this.#ws) return;
			this.#ws = null;
			if (event.code === CLOSE_UNAUTHORIZED) {
				this.#stopped = true;
				clearInterval(this.#watchdog);
				this.#setStatus("unauthorized");
				return;
			}
			this.#scheduleReconnect(event.code === CLOSE_PROTOCOL);
		};
	}

	#handle(msg: ServerMessage): void {
		switch (msg.type) {
			case "welcome":
				this.identity = msg.identity;
				this.roomName = msg.roomName;
				return;
			case "snapshot":
				this.entities.clear();
				for (const e of msg.entities) {
					this.entities.set(entityKey(e.kind, e.id), e);
				}
				this.version = msg.version;
				this.#becameOnline();
				return;
			case "changes":
				for (const c of msg.changes) this.#apply(c);
				this.version = Math.max(this.version ?? 0, msg.version);
				if (this.status === "online") this.#emit();
				else this.#becameOnline();
				return;
			case "ack": {
				const p = this.#pending.get(msg.actionId);
				this.#pending.delete(msg.actionId);
				p?.resolve(msg.version);
				return;
			}
			case "reject": {
				const p = this.#pending.get(msg.actionId);
				this.#pending.delete(msg.actionId);
				p?.reject(new ActionRejected(msg.reason));
				return;
			}
			case "error":
				console.warn(`Server: ${msg.code} – ${msg.message}`);
				return;
			case "pong":
				return;
		}
	}

	#apply(c: Change): void {
		if (c.op === "upsert") {
			this.entities.set(entityKey(c.entity.kind, c.entity.id), c.entity);
		} else {
			this.entities.delete(entityKey(c.kind, c.id));
		}
	}

	#becameOnline(): void {
		this.#attempt = 0;
		this.#setStatus("online");
		// Unbestätigte Aktionen in ursprünglicher Reihenfolge erneut senden.
		for (const p of this.#pending.values()) {
			this.#send({ type: "action", actionId: p.actionId, action: p.action });
		}
	}

	#checkStale(): void {
		if (this.#stopped || !this.#ws) return;
		const now = Date.now();
		const probeFailed =
			this.#probeSentAt !== null && now - this.#probeSentAt > PROBE_TIMEOUT_MS;
		if (probeFailed || now - this.#lastReceived > this.#opts.staleAfterMs) {
			this.#reconnectNow();
			return;
		}
		if (
			this.#ws.readyState === this.#WebSocket.OPEN &&
			now - this.#lastPing >= this.#opts.pingEveryMs
		) {
			this.#lastPing = now;
			this.#send({ type: "ping" });
		}
	}

	#reconnectNow(): void {
		const old = this.#ws;
		this.#ws = null;
		if (old) {
			old.onopen = old.onmessage = old.onclose = null;
			old.close();
		}
		this.#probeSentAt = null;
		clearTimeout(this.#reconnectTimer);
		this.#connect();
	}

	#scheduleReconnect(slow: boolean): void {
		if (this.#stopped) return;
		this.#setStatus("offline");
		const base = Math.min(this.#opts.maxBackoffMs, 500 * 2 ** this.#attempt);
		const delay =
			(slow ? this.#opts.maxBackoffMs : base) * (0.5 + Math.random() / 2);
		this.#attempt++;
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
	}

	#send(msg: ClientMessage): void {
		if (this.#ws?.readyState === this.#WebSocket.OPEN) {
			this.#ws.send(JSON.stringify(msg));
		}
	}

	#setStatus(status: ConnectionStatus): void {
		if (this.status === status) return;
		this.status = status;
		this.#emit();
	}

	#emit(): void {
		for (const l of this.#listeners) l();
	}
}

/** WebSocket-Adresse relativ zur aktuellen Seite – keine fest eingebauten Hosts. */
export function defaultSocketUrl(location: Location): string {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${location.host}/ws`;
}
