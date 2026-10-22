import { h } from "./dom.ts";
import { parseRoute, startRouter } from "./router.ts";
import { homeView } from "./views/home.ts";
import { joinView } from "./views/join.ts";
import { roomView } from "./views/room.ts";

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
