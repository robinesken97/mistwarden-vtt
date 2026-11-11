// Sitzungs-Tokens im Browser, damit ein Neuladen die Anmeldung übersteht.
// localStorage kann fehlen oder werfen (privater Modus); dann gilt das Token nur bis zum Neuladen.

import { parseAccent, parseTheme, type Theme } from "./theme.ts";

const memory = new Map<string, string>();
const GM_KEY = "mistwarden.gmToken";
const playerKey = (roomId: string) => `mistwarden.player.${roomId}`;
const LAST_ROOM_KEY = "mistwarden.lastPlayerRoom";
// Derselbe Schlüssel steht in index.html, damit das Theme vor dem ersten Zeichnen gilt.
const THEME_KEY = "mistwarden.theme";
const ACCENT_KEY = "mistwarden.accent";

function read(key: string): string | null {
	try {
		return localStorage.getItem(key) ?? memory.get(key) ?? null;
	} catch {
		return memory.get(key) ?? null;
	}
}

function write(key: string, value: string | null): void {
	if (value === null) memory.delete(key);
	else memory.set(key, value);
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// nur im Speicher
	}
}

export const storage = {
	theme: () => parseTheme(read(THEME_KEY)),
	setTheme: (theme: Theme) =>
		write(THEME_KEY, theme === "system" ? null : theme),
	accent: () => parseAccent(read(ACCENT_KEY)),
	setAccent: (accent: string | null) => write(ACCENT_KEY, accent),
	gmToken: () => read(GM_KEY),
	setGmToken: (token: string | null) => write(GM_KEY, token),
	playerToken: (roomId: string) => read(playerKey(roomId)),
	setPlayerToken: (roomId: string, token: string | null) => {
		write(playerKey(roomId), token);
		if (token) write(LAST_ROOM_KEY, roomId);
		else if (read(LAST_ROOM_KEY) === roomId) write(LAST_ROOM_KEY, null);
	},
	/** Raum, dem dieses Gerät zuletzt als Spieler beigetreten ist (Start der PWA). */
	lastPlayerRoom: () => {
		const roomId = read(LAST_ROOM_KEY);
		return roomId && read(playerKey(roomId)) ? roomId : null;
	},
};
