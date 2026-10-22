export type Route =
	| { name: "home" }
	| { name: "join"; linkToken: string }
	| { name: "room"; roomId: string }
	| { name: "notFound" };

/** Pfade: `/` (GM), `/join#<token>` (Spieler-Link), `/room/<id>` (Raum). */
export function parseRoute(location: Location): Route {
	const path = location.pathname.replace(/\/+$/, "") || "/";
	if (path === "/") return { name: "home" };
	if (path === "/join") {
		return {
			name: "join",
			linkToken: decodeURIComponent(location.hash.slice(1)),
		};
	}
	const room = /^\/room\/([A-Za-z0-9_-]+)$/.exec(path);
	if (room) return { name: "room", roomId: room[1] as string };
	return { name: "notFound" };
}

let onNavigate: () => void = () => {};

export function startRouter(render: () => void): void {
	onNavigate = render;
	window.addEventListener("popstate", render);
	render();
}

export function navigate(path: string, replace = false): void {
	if (replace) history.replaceState(null, "", path);
	else history.pushState(null, "", path);
	onNavigate();
}
