import { defineConfig } from "vite";

export default defineConfig({
	build: {
		// Referenzgerät: iPad 6 mit Safari 17.
		target: ["safari17", "es2022"],
		// /assets/ gehört dem Server (Bilder und Kacheln); der Client liegt unter /app/.
		assetsDir: "app",
	},
	server: {
		proxy: {
			"/api": { target: "http://127.0.0.1:3000" },
			"/assets": { target: "http://127.0.0.1:3000" },
			"/ws": { target: "ws://127.0.0.1:3000", ws: true },
		},
	},
});
