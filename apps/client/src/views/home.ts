import type { RoomSummary } from "@mistwarden/protocol";
import { ApiError, api, errorText } from "../api.ts";
import { button, errorLine, h } from "../dom.ts";
import { navigate } from "../router.ts";
import { storage } from "../storage.ts";

/** Startseite: Raumliste der GM, sonst der letzte Raum als Spieler, sonst Login. */
export function homeView(root: HTMLElement): void {
	const token = storage.gmToken();
	if (token) {
		roomsView(root, token);
		return;
	}
	// Start vom Home-Bildschirm: Spieler landen direkt in ihrem Raum.
	const lastRoom = storage.lastPlayerRoom();
	if (lastRoom) {
		navigate(`/room/${lastRoom}`, true);
		return;
	}
	loginView(root);
}

/**
 * Spieler-Link einfügen: Eine Web-App vom Home-Bildschirm hat auf dem iPad eigenen
 * Speicher und keine Adresszeile; so kommen Spieler auch dort in ihren Raum.
 */
function joinByLink(): HTMLElement {
	const link = h("input", {
		type: "url",
		placeholder: "Spieler-Link einfügen",
		autocomplete: "off",
	});
	const error = errorLine();
	const form = h(
		"form",
		{},
		link,
		h("button", { type: "submit" }, "Beitreten"),
	);
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const value = link.value.trim();
		const hash = value.includes("#")
			? value.slice(value.indexOf("#") + 1)
			: value;
		if (!/^[A-Za-z0-9_-]{16,200}$/.test(hash)) {
			error.show("Das sieht nicht wie ein Spieler-Link aus.");
			return;
		}
		navigate(`/join#${hash}`);
	});
	return h("div", {}, h("h2", {}, "Als Spieler beitreten"), form, error);
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
		joinByLink(),
	);
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

	const importFile = h("input", {
		type: "file",
		accept: ".json,application/json",
		hidden: true,
	});
	const importStatus = h("p", { className: "hint", hidden: true });
	const importButton = button(
		"Raum importieren",
		() => importFile.click(),
		"secondary",
	);
	importFile.addEventListener("change", async () => {
		const file = importFile.files?.[0];
		importFile.value = "";
		if (!file) return;
		importButton.disabled = true;
		importStatus.hidden = false;
		importStatus.textContent = `„${file.name}“ wird importiert …`;
		try {
			const room = await api.importRoom(token, file);
			navigate(`/room/${room.id}`);
		} catch (err) {
			importStatus.hidden = true;
			handle(err);
		} finally {
			importButton.disabled = false;
		}
	});

	root.replaceChildren(
		h("h1", {}, "Mistwarden"),
		h("h2", {}, "Räume"),
		list,
		create,
		h("p", {}, importButton),
		importFile,
		importStatus,
		h(
			"p",
			{ className: "hint" },
			"Ein Import legt einen neuen Raum an. Spieler treten dort neu bei; Tokens und Zeichnungen gehören danach der Spielleitung.",
		),
		error,
		h("p", {}, logout),
	);

	async function exportRoom(room: RoomSummary): Promise<void> {
		error.show(null);
		try {
			const blob = await api.exportRoom(token, room.id);
			const url = URL.createObjectURL(blob);
			const a = h("a", { href: url, download: `${fileName(room.name)}.json` });
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
			button("Exportieren", () => void exportRoom(room), "secondary"),
		);
	}

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

/** Dateiname aus dem Raumnamen, ohne Zeichen, die Dateisysteme nicht mögen. */
function fileName(name: string): string {
	const date = new Date().toISOString().slice(0, 10);
	const safe = name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "raum";
	return `${safe}-${date}`;
}
