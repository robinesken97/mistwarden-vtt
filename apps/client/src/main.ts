// Entwicklungsansicht für Schritt 1: Anmeldung per Sitzungs-Token, Verbindungsstatus
// und eine Szenenliste zum Prüfen von Sync, Rechten und Reconnect auf allen Geräten.
// Wird ab Schritt 2/3 durch Login, Spieler-Link und den PixiJS-Renderer ersetzt.
import type { Audience, Entity } from "@mistwarden/protocol";
import {
	ActionRejected,
	defaultSocketUrl,
	SyncConnection,
} from "./net/connection.ts";

const TOKEN_KEY = "mistwarden.sessionToken";
const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app fehlt");
const root: HTMLElement = app;

function readToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

function writeToken(token: string | null): void {
	try {
		if (token) localStorage.setItem(TOKEN_KEY, token);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		// Privater Modus: Token gilt dann nur bis zum Neuladen.
	}
}

function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	Object.assign(el, props);
	el.append(...children);
	return el;
}

function showLogin(): void {
	const input = h("input", {
		type: "text",
		placeholder: "Sitzungs-Token",
		autocomplete: "off",
	});
	const form = h(
		"form",
		{},
		input,
		h("button", { type: "submit" }, "Verbinden"),
	);
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const token = input.value.trim();
		if (!token) return;
		writeToken(token);
		connect(token);
	});
	root.replaceChildren(
		h("h1", {}, "Mistwarden"),
		form,
		h("p", { className: "hint" }, "Tokens erzeugt `npm run dev:seed`."),
	);
}

function connect(token: string): void {
	const conn = new SyncConnection({ url: defaultSocketUrl(location), token });

	const statusDot = h("span", { className: "dot" });
	const statusText = h("span");
	const roleText = h("span");
	const versionText = h("span");
	const list = h("ul");
	const gmForm = sceneForm(conn);
	const logout = h(
		"button",
		{ type: "button", className: "secondary" },
		"Abmelden",
	);
	logout.addEventListener("click", () => {
		conn.stop();
		writeToken(null);
		showLogin();
	});

	root.replaceChildren(
		h("h1", {}, "Mistwarden"),
		h(
			"div",
			{ className: "status" },
			h("span", {}, statusDot, statusText),
			roleText,
			versionText,
		),
		h("h2", {}, "Szenen"),
		list,
		gmForm,
		h("p", {}, logout),
	);

	const render = () => {
		statusDot.dataset.status = conn.status;
		statusText.textContent = statusLabel[conn.status];
		const id = conn.identity;
		roleText.textContent = id
			? id.role === "gm"
				? "Rolle: GM"
				: `Rolle: Spieler (${id.playerId.slice(0, 8)})`
			: "";
		versionText.textContent = `Version: ${conn.version ?? "–"}`;
		gmForm.hidden = conn.identity?.role !== "gm";
		const scenes = [...conn.entities.values()]
			.filter((e) => e.kind === "scene")
			.sort((a, b) => a.version - b.version);
		list.replaceChildren(
			...(scenes.length
				? scenes.map((s) => sceneItem(conn, s))
				: [h("li", { className: "hint" }, "Keine Szenen sichtbar.")]),
		);
		if (conn.status === "unauthorized") {
			writeToken(null);
			showLogin();
		}
	};

	conn.subscribe(render);
	conn.start();
	render();

	// Safari beendet Verbindungen bei Displaysperre und im Hintergrund.
	const wake = () => {
		if (document.visibilityState === "visible") conn.wake();
	};
	document.addEventListener("visibilitychange", wake);
	window.addEventListener("pageshow", wake);
	window.addEventListener("online", () => conn.wake());
}

const statusLabel = {
	connecting: "Verbinde …",
	online: "Verbunden",
	offline: "Getrennt – neuer Versuch läuft",
	unauthorized: "Sitzung ungültig",
} as const;

const audienceOptions: [string, Audience][] = [
	["Alle", { type: "all" }],
	["Nur GM", { type: "gm" }],
];

function sceneItem(conn: SyncConnection, scene: Entity): HTMLLIElement {
	const name = h("span", { className: "name" }, String(scene.data.name));
	if (conn.identity?.role !== "gm") return h("li", {}, name);

	const select = h("select");
	for (const [label, audience] of audienceOptions) {
		select.append(
			h("option", {
				value: audience.type,
				textContent: label,
				selected: scene.audience?.type === audience.type,
			}),
		);
	}
	select.addEventListener("change", () => {
		const audience = audienceOptions.find(
			([, a]) => a.type === select.value,
		)?.[1];
		if (audience)
			run(conn.send({ op: "update", kind: "scene", id: scene.id, audience }));
	});
	const remove = h(
		"button",
		{ type: "button", className: "secondary" },
		"Löschen",
	);
	remove.addEventListener("click", () =>
		run(conn.send({ op: "delete", kind: "scene", id: scene.id })),
	);
	return h("li", {}, name, select, remove);
}

function sceneForm(conn: SyncConnection): HTMLFormElement {
	const input = h("input", { type: "text", placeholder: "Neue Szene" });
	const hidden = h("input", { type: "checkbox" });
	const form = h(
		"form",
		{},
		input,
		h("label", {}, hidden, " Nur GM"),
		h("button", { type: "submit" }, "Anlegen"),
	);
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const name = input.value.trim();
		if (!name) return;
		input.value = "";
		run(
			conn.send({
				op: "create",
				kind: "scene",
				id: crypto.randomUUID(),
				data: { name },
				audience: hidden.checked ? { type: "gm" } : { type: "all" },
			}),
		);
	});
	return form;
}

function run(p: Promise<unknown>): void {
	p.catch((err: unknown) => {
		alert(
			err instanceof ActionRejected ? `Abgelehnt: ${err.reason}` : String(err),
		);
	});
}

const token = readToken();
if (token) connect(token);
else showLogin();
