import { ApiError, api, errorText } from "../api.ts";
import { errorLine, h } from "../dom.ts";
import { navigate } from "../router.ts";
import { storage } from "../storage.ts";

/** Spieler-Link: Namen wählen und beitreten – oder direkt weiter, wenn schon beigetreten. */
export async function joinView(
	root: HTMLElement,
	linkToken: string,
): Promise<void> {
	const error = errorLine();
	root.replaceChildren(
		h("h1", {}, "Mistwarden"),
		h("p", { className: "hint" }, "Link wird geprüft …"),
		error,
	);

	let info: { roomId: string; roomName: string };
	try {
		info = await api.linkInfo(linkToken);
	} catch (err) {
		root.replaceChildren(
			h("h1", {}, "Mistwarden"),
			h(
				"p",
				{},
				err instanceof ApiError && err.code === "not_found"
					? "Dieser Spieler-Link ist ungültig oder wurde erneuert. Bitte die Spielleitung um den aktuellen Link."
					: errorText(err),
			),
		);
		return;
	}

	// Schon beigetreten (z. B. Link erneut geöffnet): bestehende Sitzung weiterverwenden.
	const existing = storage.playerToken(info.roomId);
	if (existing) {
		const session = await api.session(existing).catch(() => null);
		if (session?.roomId === info.roomId) {
			navigate(`/room/${info.roomId}`, true);
			return;
		}
		storage.setPlayerToken(info.roomId, null);
	}

	const name = h("input", {
		type: "text",
		placeholder: "Dein Name",
		maxLength: 32,
		autocomplete: "off",
	});
	const submit = h("button", { type: "submit", textContent: "Beitreten" });
	const form = h("form", {}, name, submit);
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		if (!name.value.trim()) return;
		submit.disabled = true;
		error.show(null);
		try {
			const res = await api.join(linkToken, name.value.trim());
			storage.setPlayerToken(res.roomId, res.token);
			navigate(`/room/${res.roomId}`, true);
		} catch (err) {
			error.show(errorText(err));
			submit.disabled = false;
		}
	});

	root.replaceChildren(
		h("h1", {}, "Mistwarden"),
		h("p", {}, "Beitreten zu ", h("strong", {}, info.roomName)),
		form,
		error,
	);
	name.focus();
}
