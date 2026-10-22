// Raumansicht bis Schritt 3: Verbindungsstatus, aktive Szene, Spielerliste und für die GM
// Szenenverwaltung und Spieler-Link. Ab Schritt 3 kommt hier der PixiJS-Renderer dazu.
import {
	type Action,
	type Entity,
	type PlayerData,
	ROOM_STATE_ID,
	type RoomStateData,
	type SceneData,
} from "@mistwarden/protocol";
import { ApiError, api, errorText, playerLink } from "../api.ts";
import { button, errorLine, h } from "../dom.ts";
import {
	ActionRejected,
	defaultSocketUrl,
	SyncConnection,
} from "../net/connection.ts";
import { navigate } from "../router.ts";
import { storage } from "../storage.ts";

const statusLabel = {
	connecting: "Verbinde …",
	online: "Verbunden",
	offline: "Getrennt – neuer Versuch läuft",
	unauthorized: "Kein Zugang",
} as const;

const rejectText = {
	invalid: "Nicht möglich (z. B. aktive Szene löschen oder verbergen).",
	forbidden: "Keine Berechtigung.",
	not_found: "Nicht gefunden.",
	exists: "Existiert bereits.",
} as const;

/** Liefert eine Aufräumfunktion, die beim Verlassen der Ansicht aufgerufen wird. */
export function roomView(root: HTMLElement, roomId: string): () => void {
	const gmToken = storage.gmToken();
	const token = gmToken ?? storage.playerToken(roomId);
	if (!token) {
		root.replaceChildren(
			h("h1", {}, "Mistwarden"),
			h(
				"p",
				{},
				"Kein Zugang zu diesem Raum. Bitte über den Spieler-Link beitreten.",
			),
		);
		return () => {};
	}

	const conn = new SyncConnection({
		url: defaultSocketUrl(location),
		token,
		...(gmToken ? { roomId } : {}),
	});

	const title = h("h1", {}, "Mistwarden");
	const statusDot = h("span", { className: "dot" });
	const statusText = h("span");
	const roleText = h("span");
	const activeScene = h("p", { className: "active-scene" });
	const players = h("ul", { className: "players" });
	const error = errorLine();
	const gmPanel = h("div");
	const scenes = h("ul");

	const run = (action: Action) => {
		error.show(null);
		conn.send(action).catch((err: unknown) => {
			error.show(
				err instanceof ActionRejected ? rejectText[err.reason] : String(err),
			);
		});
	};

	// --- GM: Szenen und Spieler-Link ---
	const sceneName = h("input", { type: "text", placeholder: "Neue Szene" });
	const sceneHidden = h("input", { type: "checkbox" });
	const sceneForm = h(
		"form",
		{},
		sceneName,
		h("label", {}, sceneHidden, " Nur GM"),
		h("button", { type: "submit" }, "Anlegen"),
	);
	sceneForm.addEventListener("submit", (e) => {
		e.preventDefault();
		const name = sceneName.value.trim();
		if (!name) return;
		sceneName.value = "";
		const order =
			Math.max(-1, ...sceneList().map((s) => (s.data as SceneData).order)) + 1;
		run({
			op: "create",
			kind: "scene",
			id: crypto.randomUUID(),
			data: { name, order },
			audience: sceneHidden.checked ? { type: "gm" } : { type: "all" },
		});
	});

	const linkInput = h("input", { type: "text", readOnly: true });
	const linkBox = h(
		"div",
		{ className: "link-box" },
		linkInput,
		button("Kopieren", async () => {
			linkInput.select();
			await navigator.clipboard?.writeText(linkInput.value).catch(() => {});
		}),
		button(
			"Neu erzeugen",
			async () => {
				if (!gmToken) return;
				if (
					!confirm(
						"Neuen Spieler-Link erzeugen? Der alte Link funktioniert dann nicht mehr; wer schon drin ist, bleibt drin.",
					)
				)
					return;
				try {
					const res = await api.regenerateLink(gmToken, roomId);
					linkInput.value = playerLink(res.playerLinkToken);
				} catch (err) {
					error.show(errorText(err));
				}
			},
			"secondary",
		),
	);

	if (gmToken) {
		gmPanel.append(
			h("h2", {}, "Szenen"),
			scenes,
			sceneForm,
			h("h2", {}, "Spieler-Link"),
			linkBox,
			h(
				"p",
				{ className: "hint" },
				"Diesen Link an die Spieler schicken. Sie treten mit ihrem Namen bei, ohne Account.",
			),
		);
		api
			.rooms(gmToken)
			.then((rooms) => {
				const room = rooms.find((r) => r.id === roomId);
				if (room) linkInput.value = playerLink(room.playerLinkToken);
			})
			.catch((err: unknown) => {
				if (err instanceof ApiError && err.status === 401) leaveAsGm();
			});
	}

	const leave = gmToken
		? button("Zur Raumliste", () => navigate("/"), "secondary")
		: button(
				"Raum verlassen",
				() => {
					if (
						!confirm(
							"Diesen Raum auf diesem Gerät verlassen? Über den Spieler-Link kannst du wieder beitreten.",
						)
					)
						return;
					storage.setPlayerToken(roomId, null);
					conn.stop();
					root.replaceChildren(
						h("h1", {}, "Mistwarden"),
						h("p", {}, "Du hast den Raum verlassen."),
					);
				},
				"secondary",
			);

	root.replaceChildren(
		title,
		h(
			"div",
			{ className: "status" },
			h("span", {}, statusDot, statusText),
			roleText,
		),
		activeScene,
		h("h2", {}, "Spieler"),
		players,
		gmPanel,
		error,
		h("p", {}, leave),
	);

	function leaveAsGm(): void {
		conn.stop();
		storage.setGmToken(null);
		navigate("/", true);
	}

	function entitiesOf(kind: Entity["kind"]): Entity[] {
		return [...conn.entities.values()].filter((e) => e.kind === kind);
	}

	function sceneList(): Entity[] {
		return entitiesOf("scene").sort(
			(a, b) => (a.data as SceneData).order - (b.data as SceneData).order,
		);
	}

	function activeSceneId(): string | null {
		const state = conn.entities.get(`roomState:${ROOM_STATE_ID}`);
		return state ? (state.data as RoomStateData).activeSceneId : null;
	}

	function sceneItem(scene: Entity, active: boolean): HTMLLIElement {
		const data = scene.data as SceneData;
		const hidden = scene.audience?.type === "gm";
		const name = h(
			"span",
			{ className: "name" },
			data.name,
			active ? h("span", { className: "badge" }, "aktiv") : "",
			hidden ? h("span", { className: "badge muted" }, "nur GM") : "",
		);
		if (active) {
			return h(
				"li",
				{},
				name,
				button("Umbenennen", () => rename(scene), "secondary"),
			);
		}
		return h(
			"li",
			{},
			name,
			button("Aktivieren", () => {
				// Die aktive Szene sehen alle: verdeckte Szene vorher aufdecken.
				if (hidden) {
					run({
						op: "update",
						kind: "scene",
						id: scene.id,
						audience: { type: "all" },
					});
				}
				run({
					op: "update",
					kind: "roomState",
					id: ROOM_STATE_ID,
					patch: { activeSceneId: scene.id },
				});
			}),
			button(
				hidden ? "Aufdecken" : "Verbergen",
				() =>
					run({
						op: "update",
						kind: "scene",
						id: scene.id,
						audience: { type: hidden ? "all" : "gm" },
					}),
				"secondary",
			),
			button("Umbenennen", () => rename(scene), "secondary"),
			button(
				"Löschen",
				() => {
					if (confirm(`Szene „${data.name}“ löschen?`)) {
						run({ op: "delete", kind: "scene", id: scene.id });
					}
				},
				"secondary",
			),
		);
	}

	function rename(scene: Entity): void {
		const name = prompt(
			"Neuer Name der Szene",
			(scene.data as SceneData).name,
		)?.trim();
		if (name)
			run({ op: "update", kind: "scene", id: scene.id, patch: { name } });
	}

	function render(): void {
		statusDot.dataset.status = conn.status;
		statusText.textContent = statusLabel[conn.status];
		title.textContent = conn.roomName ?? "Mistwarden";
		document.title = conn.roomName
			? `${conn.roomName} – Mistwarden`
			: "Mistwarden";

		const id = conn.identity;
		const me =
			id?.role === "player"
				? (conn.entities.get(`player:${id.playerId}`)?.data as
						| PlayerData
						| undefined)
				: undefined;
		roleText.textContent = id
			? id.role === "gm"
				? "Spielleitung"
				: `Spieler: ${me?.name ?? "…"}`
			: "";

		const activeId = activeSceneId();
		const active = activeId
			? conn.entities.get(`scene:${activeId}`)
			: undefined;
		activeScene.replaceChildren(
			"Aktive Szene: ",
			h("strong", {}, active ? (active.data as SceneData).name : "–"),
		);

		const playerItems = entitiesOf("player").map((p) => {
			const data = p.data as PlayerData;
			const swatch = h("span", { className: "swatch" });
			swatch.style.background = data.color;
			return h("li", {}, swatch, h("span", { className: "name" }, data.name));
		});
		players.replaceChildren(
			...(playerItems.length
				? playerItems
				: [h("li", { className: "hint" }, "Noch niemand beigetreten.")]),
		);

		if (gmToken) {
			scenes.replaceChildren(
				...sceneList().map((s) => sceneItem(s, s.id === activeId)),
			);
		}

		if (conn.status === "unauthorized") {
			if (gmToken) leaveAsGm();
			else {
				storage.setPlayerToken(roomId, null);
				root.replaceChildren(
					h("h1", {}, "Mistwarden"),
					h(
						"p",
						{},
						"Deine Sitzung ist nicht mehr gültig. Bitte über den Spieler-Link neu beitreten.",
					),
				);
			}
		}
	}

	conn.subscribe(render);
	conn.start();
	render();

	// Safari beendet Verbindungen bei Displaysperre und im Hintergrund.
	const wake = () => {
		if (document.visibilityState === "visible") conn.wake();
	};
	const online = () => conn.wake();
	document.addEventListener("visibilitychange", wake);
	window.addEventListener("pageshow", wake);
	window.addEventListener("online", online);

	return () => {
		conn.stop();
		document.removeEventListener("visibilitychange", wake);
		window.removeEventListener("pageshow", wake);
		window.removeEventListener("online", online);
	};
}
