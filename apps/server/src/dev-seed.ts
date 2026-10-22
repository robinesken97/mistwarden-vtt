// Nur für die Entwicklung bis Schritt 2: legt einen Raum mit GM und zwei
// Spielern an und gibt deren Sitzungs-Tokens aus.
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/connection.ts";
import { createPlayer, createRoom, createSession } from "./rooms.ts";

const config = loadConfig();
const db = openDatabase(config.databasePath);

const roomName = process.argv[2] ?? "Testraum";
const roomId = createRoom(db, roomName);
const gm = createSession(db, roomId, { role: "gm" });
const players = [
	["Spieler 1", "#e4572e"],
	["Spieler 2", "#17bebb"],
].map(([name = "", color = ""]) => {
	const playerId = createPlayer(db, roomId, name, color);
	return {
		name,
		token: createSession(db, roomId, { role: "player", playerId }),
	};
});
db.close();

console.log(
	`Raum "${roomName}" angelegt (${roomId}) in ${config.databasePath}\n`,
);
console.log(`GM:        ${gm}`);
for (const p of players) console.log(`${p.name}: ${p.token}`);
