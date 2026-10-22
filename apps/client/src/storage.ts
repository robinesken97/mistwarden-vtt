// Sitzungs-Tokens im Browser, damit ein Neuladen die Anmeldung übersteht.
// localStorage kann fehlen oder werfen (privater Modus); dann gilt das Token nur bis zum Neuladen.

const memory = new Map<string, string>();
const GM_KEY = "mistwarden.gmToken";
const playerKey = (roomId: string) => `mistwarden.player.${roomId}`;

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
	gmToken: () => read(GM_KEY),
	setGmToken: (token: string | null) => write(GM_KEY, token),
	playerToken: (roomId: string) => read(playerKey(roomId)),
	setPlayerToken: (roomId: string, token: string | null) =>
		write(playerKey(roomId), token),
};
