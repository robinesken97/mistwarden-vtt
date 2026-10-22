import { defineConfig } from "vite";

export default defineConfig({
	build: {
		// Referenzgerät: iPad 6 mit Safari 17.
		target: ["safari17", "es2022"],
	},
	server: {
		proxy: {
			"/ws": { target: "ws://127.0.0.1:3000", ws: true },
		},
	},
});
