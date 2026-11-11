import { ApiError, api, errorText } from "../api.ts";
import { errorLine, h } from "../dom.ts";
import { t } from "../i18n.ts";
import { navigate } from "../router.ts";
import { storage } from "../storage.ts";
import { brand, ornament, startPage } from "./start.ts";

/** Spieler-Link: Namen wählen und beitreten – oder direkt weiter, wenn schon beigetreten. */
export async function joinView(
	root: HTMLElement,
	linkToken: string,
): Promise<void> {
	const error = errorLine();
	startPage(root, brand("Mistwarden", t("join.checking"), true), error);

	let info: { roomId: string; roomName: string };
	try {
		info = await api.linkInfo(linkToken);
	} catch (err) {
		startPage(
			root,
			brand(
				"Mistwarden",
				err instanceof ApiError && err.code === "not_found"
					? t("join.invalid")
					: errorText(err),
				true,
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
		id: "join-name",
		maxLength: 32,
		autocomplete: "off",
	});
	const submit = h("button", {
		type: "submit",
		textContent: t("join.submit"),
	});
	const form = h(
		"form",
		{ className: "join-form" },
		h("label", { htmlFor: "join-name" }, t("join.nameLabel")),
		name,
		h("p", { className: "hint" }, t("join.nameHint")),
		submit,
	);
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

	startPage(
		root,
		brand(info.roomName, t("join.invited")),
		ornament(),
		form,
		error,
	);
	name.focus();
}
