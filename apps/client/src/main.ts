import { h } from "./dom.ts";
import { detectLang, setLang } from "./i18n.ts";
import { parseRoute, startRouter } from "./router.ts";
import { storage } from "./storage.ts";
import { applyAccent, applyTheme } from "./theme.ts";
import { homeView } from "./views/home.ts";
import { joinView } from "./views/join.ts";
import { roomView } from "./views/room.ts";

const lang = storage.lang() ?? detectLang(navigator.language);
setLang(lang);
document.documentElement.lang = lang;
applyTheme(storage.theme());
applyAccent(storage.accent());

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app fehlt");
const root: HTMLElement = app;

let cleanup: () => void = () => {};

startRouter(() => {
	cleanup();
	cleanup = () => {};
	const route = parseRoute(location);
	switch (route.name) {
		case "home":
			homeView(root);
			return;
		case "join":
			void joinView(root, route.linkToken);
			return;
		case "room":
			cleanup = roomView(root, route.roomId);
			return;
		case "notFound":
			root.replaceChildren(
				h("h1", {}, "Mistwarden"),
				h("p", {}, "Diese Seite gibt es nicht."),
			);
	}
});

// Service Worker nur im Build und nur in sicheren Kontexten (HTTPS oder localhost).
if (import.meta.env.PROD && "serviceWorker" in navigator && isSecureContext) {
	navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
		console.warn("Service Worker nicht registriert:", err);
	});
}
