// Service Worker von Mistwarden: hält die App-Hülle (HTML, JS, CSS, Icons) vor, damit die
// PWA vom Home-Bildschirm auch bei wackligem WLAN sofort startet. Spielstand, API,
// WebSocket und Kartenkacheln laufen immer über das Netz (der Server ist autoritativ;
// Kacheln im Cache würden den knappen Speicher des iPad 6 füllen).
const CACHE = "mistwarden-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(SHELL))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws"))
		return;
	if (url.pathname.startsWith("/assets/")) return;

	// Seiten: erst Netz (immer aktuell), offline die zuletzt geladene Hülle.
	if (req.mode === "navigate") {
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(CACHE).then((c) => c.put("/", copy));
					}
					return res;
				})
				.catch(() => caches.match("/").then((r) => r ?? Response.error())),
		);
		return;
	}

	// Gebaute Dateien unter /app/ tragen einen Inhalts-Hash: einmal laden, dann aus dem Cache.
	if (url.pathname.startsWith("/app/") || url.pathname.startsWith("/icons/")) {
		event.respondWith(
			caches.match(req).then(
				(hit) =>
					hit ??
					fetch(req).then((res) => {
						if (res.ok) {
							const copy = res.clone();
							caches.open(CACHE).then((c) => c.put(req, copy));
						}
						return res;
					}),
			),
		);
	}
});
