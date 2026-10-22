import type { RoomSummary } from "@mistwarden/protocol";
import { ApiError, api, errorText } from "../api.ts";
import { button, errorLine, h } from "../dom.ts";
import { navigate } from "../router.ts";
import { storage } from "../storage.ts";

/** Startseite der GM: Login oder Raumliste. */
export function homeView(root: HTMLElement): void {
	const token = storage.gmToken();
	if (token) roomsView(root, token);
	else loginView(root);
}

function loginView(root: HTMLElement): void {
	const password = h("input", {
		type: "password",
		placeholder: "GM-Passwort",
		autocomplete: "current-password",
	});
	const submit = h("button", { type: "submit", textContent: "Anmelden" });
	const error = errorLine();
	const form = h("form", {}, password, submit);
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		submit.disabled = true;
		error.show(null);
		try {
			const { token } = await api.gmLogin(password.value);
			storage.setGmToken(token);
			roomsView(root, token);
		} catch (err) {
			error.show(errorText(err));
			submit.disabled = false;
		}
	});
	root.replaceChildren(
		h("h1", {}, "Mistwarden"),
		h(
			"p",
			{ className: "hint" },
			"Anmeldung für die Spielleitung. Spieler treten über ihren Link bei.",
		),
		form,
		error,
	);
	password.focus();
}

async function roomsView(root: HTMLElement, token: string): Promise<void> {
	const list = h("ul");
	const error = errorLine();
	const name = h("input", {
		type: "text",
		placeholder: "Name des neuen Raums",
	});
	const create = h(
		"form",
		{},
		name,
		h("button", { type: "submit" }, "Raum anlegen"),
	);
	create.addEventListener("submit", async (e) => {
		e.preventDefault();
		if (!name.value.trim()) return;
		try {
			const room = await api.createRoom(token, name.value.trim());
			navigate(`/room/${room.id}`);
		} catch (err) {
			handle(err);
		}
	});
	const logout = button(
		"Abmelden",
		async () => {
			await api.logout(token).catch(() => {});
			storage.setGmToken(null);
			loginView(root);
		},
		"secondary",
	);

	root.replaceChildren(
		h("h1", {}, "Mistwarden"),
		h("h2", {}, "Räume"),
		list,
		create,
		error,
		h("p", {}, logout),
	);

	function handle(err: unknown): void {
		if (err instanceof ApiError && err.status === 401) {
			storage.setGmToken(null);
			loginView(root);
			return;
		}
		error.show(errorText(err));
	}

	try {
		const rooms = await api.rooms(token);
		list.replaceChildren(
			...(rooms.length
				? rooms.map(roomItem)
				: [h("li", { className: "hint" }, "Noch keine Räume.")]),
		);
	} catch (err) {
		handle(err);
	}
}

function roomItem(room: RoomSummary): HTMLLIElement {
	return h(
		"li",
		{},
		h("span", { className: "name" }, room.name),
		button("Öffnen", () => navigate(`/room/${room.id}`)),
	);
}
