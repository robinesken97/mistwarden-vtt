import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClientHandler } from "../src/http/static-client.ts";

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "mistwarden-dist-"));
	const dist = join(dir, "dist");
	mkdirSync(join(dist, "app"), { recursive: true });
	writeFileSync(join(dist, "index.html"), "<!doctype html>Mistwarden");
	writeFileSync(join(dist, "app", "index-AbCd1234.js"), "console.log(1)");
	writeFileSync(join(dist, "sw.js"), "// sw");
	writeFileSync(join(dir, "geheim.txt"), "nicht ausliefern");
	const handle = createClientHandler(dist);
	server = createServer(async (req, res) => {
		if (!(await handle(req, res))) res.writeHead(404).end();
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise((r) => server.close(r));
	rmSync(dir, { recursive: true, force: true });
});

describe("Auslieferung des Clients", () => {
	it("liefert index.html für Seitenrouten, damit Neuladen und PWA-Start gehen", async () => {
		for (const path of ["/", "/room/abc", "/join"]) {
			const res = await fetch(base + path);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/html");
			expect(res.headers.get("cache-control")).toBe("no-cache");
		}
	});

	it("gehashte Dateien dürfen lange im Cache bleiben, sw.js nicht", async () => {
		const js = await fetch(`${base}/app/index-AbCd1234.js`);
		expect(js.headers.get("content-type")).toContain("text/javascript");
		expect(js.headers.get("cache-control")).toContain("immutable");
		const sw = await fetch(`${base}/sw.js`);
		expect(sw.headers.get("cache-control")).toBe("no-cache");
	});

	it("fehlende Dateien mit Endung sind 404 statt index.html", async () => {
		expect((await fetch(`${base}/app/fehlt.js`)).status).toBe(404);
	});

	it("verlässt nie das Verzeichnis", async () => {
		for (const path of [
			"/../geheim.txt",
			"/%2e%2e/geheim.txt",
			"/app/%2e%2e%2f%2e%2e%2fgeheim.txt",
			"/..%5cgeheim.txt",
		]) {
			const res = await fetch(base + path);
			expect(await res.text()).not.toContain("nicht ausliefern");
		}
	});
});
