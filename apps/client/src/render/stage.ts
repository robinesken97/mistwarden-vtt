import type { AssetMeta, GridData } from "@mistwarden/protocol";
import {
	Application,
	Container,
	ImageSource,
	RendererType,
	Sprite,
	Texture,
	type WebGLRenderer,
} from "pixi.js";
import {
	attachGestures,
	browserScheduler,
	GestureRecognizer,
} from "../input/gestures.ts";
import { attachWheelZoom, Camera } from "./camera.ts";
import { GridLayer } from "./grid.ts";
import { TileCache } from "./tile-cache.ts";
import {
	defaultBudgetBytes,
	overviewTile,
	planTiles,
	type Rect,
	type TileRef,
} from "./tiles.ts";
import { type StageToken, TokenLayer, TokenTextures } from "./tokens.ts";

export type { StageToken } from "./tokens.ts";

/** Rückmeldungen der Spielfläche an die Raumansicht. */
export interface StageCallbacks {
	/** Darf dieses Token gerade gezogen werden? */
	canDrag(tokenId: string): boolean;
	/** Antippen: Token auswählen bzw. Auswahl aufheben (null). */
	select(tokenId: string | null): void;
	/** Langes Drücken oder Rechtsklick; Bildschirmposition für ein Menü. */
	context(tokenId: string | null, screen: { x: number; y: number }): void;
	/** Token losgelassen; `free` = ohne Einrasten (Alt-Taste). */
	drop(tokenId: string, world: { x: number; y: number }, free: boolean): void;
}

export interface StageScene {
	/** Wechselt die ID, wird die Kamera neu auf die Szene ausgerichtet. */
	id: string;
	map: AssetMeta | null;
	grid: GridData;
}

export interface Stage {
	setScene(scene: StageScene | null): void;
	/** Tokens der angezeigten Szene in Zeichenreihenfolge. */
	setTokens(tokens: StageToken[]): void;
	/** Mitte des sichtbaren Bereichs in Weltkoordinaten. */
	viewCenter(): { x: number; y: number };
	/** Infos für Fehlersuche und Tests (Texturgröße, Budget, Speicher). */
	info(): StageInfo;
	destroy(): void;
}

export interface StageInfo {
	webgl2: boolean;
	maxTextureSize: number;
	budgetBytes: number;
	usedBytes: number;
	level: number | null;
	tiles: number;
}

/** Fläche ohne Karte: so viele Zellen zeigt die Kamera beim Öffnen. */
const EMPTY_SCENE_CELLS = { cols: 24, rows: 16 };
/** Renderauflösung höchstens 2× (iPad 6 hat genau 2×, mehr kostet nur Speicher). */
const MAX_RESOLUTION = 2;

/**
 * Spielfläche mit PixiJS (nur WebGL, kein WebGPU). Rendert nur bei Änderungen,
 * nicht in einer Dauerschleife – schont Akku und das Referenzgerät.
 */
export async function createStage(
	host: HTMLElement,
	callbacks: StageCallbacks,
): Promise<Stage> {
	const resolution = Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION);
	const app = new Application();
	await app.init({
		preference: "webgl",
		resizeTo: host,
		resolution,
		autoDensity: true,
		antialias: false,
		backgroundAlpha: 0,
		autoStart: false,
	});
	if (app.renderer.type !== RendererType.WEBGL) {
		app.destroy(true);
		throw new Error("WebGL wird von diesem Browser nicht unterstützt.");
	}
	const gl = (app.renderer as WebGLRenderer).gl;
	const webgl2 =
		typeof WebGL2RenderingContext !== "undefined" &&
		gl instanceof WebGL2RenderingContext;
	// Maximale Texturgröße abfragen statt annehmen; Kacheln (1024) müssen hineinpassen.
	const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

	const canvas = app.canvas;
	canvas.classList.add("stage-canvas");
	host.append(canvas);

	// Ebenen in fester Reihenfolge (SPEC: Karte, Props, Tokens, Notizen, Zeichnungen).
	const world = new Container({ label: "world" });
	const mapLayer = new Container({ label: "map" });
	const overviewLayer = new Container({ label: "map-overview" });
	const tileLayer = new Container({ label: "map-tiles" });
	const grid = new GridLayer();
	mapLayer.addChild(overviewLayer, tileLayer, grid.mesh);
	const textures = new TokenTextures(() => requestRender());
	const propsLayer = new TokenLayer("props", textures);
	const tokenLayer = new TokenLayer("tokens", textures);
	world.addChild(
		mapLayer,
		propsLayer.container,
		tokenLayer.container,
		new Container({ label: "notes" }),
		new Container({ label: "drawings" }),
	);
	app.stage.addChild(world);

	const camera = new Camera();
	const budgetBytes = defaultBudgetBytes(
		window.matchMedia("(pointer: coarse)").matches,
	);
	const sprites = new Map<string, Sprite>();
	const cache = new TileCache<Texture>({
		budgetBytes,
		load: loadTile,
		onChange: requestRender,
	});

	let scene: StageScene | null = null;
	let lastLevel: number | null = null;
	let lastTileCount = 0;
	let frame = 0;
	let tokens: StageToken[] = [];
	/** Laufender Zug: entweder ein Token oder die Karte (Kamera). */
	let drag:
		| {
				type: "token";
				id: string;
				offsetX: number;
				offsetY: number;
				x: number;
				y: number;
		  }
		| { type: "pan"; lastX: number; lastY: number }
		| null = null;

	const hitTest = (sx: number, sy: number): string | null => {
		const p = camera.screenToWorld(sx, sy);
		return tokenLayer.hitTest(p.x, p.y) ?? propsLayer.hitTest(p.x, p.y);
	};

	const recognizer = new GestureRecognizer(
		{
			tap(x, y) {
				callbacks.select(hitTest(x, y));
			},
			dragStart(x, y) {
				const id = hitTest(x, y);
				const token = id ? tokens.find((t) => t.id === id) : undefined;
				if (id && token && callbacks.canDrag(id)) {
					const p = camera.screenToWorld(x, y);
					drag = {
						type: "token",
						id,
						offsetX: p.x - token.x,
						offsetY: p.y - token.y,
						x: token.x,
						y: token.y,
					};
				} else {
					drag = { type: "pan", lastX: x, lastY: y };
				}
			},
			dragMove(x, y) {
				if (drag?.type === "token") {
					const p = camera.screenToWorld(x, y);
					drag.x = p.x - drag.offsetX;
					drag.y = p.y - drag.offsetY;
				} else if (drag?.type === "pan") {
					camera.panBy(x - drag.lastX, y - drag.lastY);
					drag.lastX = x;
					drag.lastY = y;
				}
				requestRender();
			},
			dragEnd(_x, _y, altKey) {
				const done = drag;
				drag = null;
				if (done?.type === "token") {
					callbacks.drop(done.id, { x: done.x, y: done.y }, altKey);
				}
				requestRender();
			},
			dragCancel() {
				drag = null;
				requestRender();
			},
			context(x, y) {
				callbacks.context(hitTest(x, y), { x, y });
			},
			pinch(midX, midY, factor, dx, dy) {
				camera.panBy(dx, dy);
				camera.zoomAt(midX, midY, factor);
				requestRender();
			},
		},
		browserScheduler,
	);
	const detachGestures = attachGestures(canvas, recognizer);
	const detachWheel = attachWheelZoom(canvas, camera, requestRender);
	app.renderer.on("resize", requestRender);

	function requestRender(): void {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			draw();
		});
	}

	function viewSize() {
		return { width: app.screen.width, height: app.screen.height };
	}

	function sceneBounds(s: StageScene): Rect {
		if (s.map) return { x: 0, y: 0, width: s.map.width, height: s.map.height };
		return {
			x: s.grid.offsetX,
			y: s.grid.offsetY,
			width: s.grid.size * EMPTY_SCENE_CELLS.cols,
			height: s.grid.size * EMPTY_SCENE_CELLS.rows,
		};
	}

	function draw(): void {
		world.scale.set(camera.zoom);
		world.position.set(-camera.x * camera.zoom, -camera.y * camera.zoom);
		const { width, height } = viewSize();
		const view = camera.view(width, height);

		const wantedKeys = new Set<string>();
		if (scene?.map) {
			const map = scene.map;
			const overview = overviewTile(map);
			const plan = planTiles(map, camera.zoom * resolution, view, budgetBytes);
			lastLevel = plan.level;
			lastTileCount = plan.tiles.length;
			const tiles: TileRef[] =
				plan.level === overview.level ? plan.tiles : [overview, ...plan.tiles];
			cache.want(tiles);
			placeTile(overview, overviewLayer);
			wantedKeys.add(overview.key);
			for (const tile of plan.tiles) {
				if (placeTile(tile, tileLayer)) wantedKeys.add(tile.key);
			}
		} else {
			cache.want([]);
			lastLevel = null;
			lastTileCount = 0;
		}
		for (const [key, sprite] of sprites) {
			if (!wantedKeys.has(key) || !cache.get(key)) {
				sprite.destroy();
				sprites.delete(key);
			}
		}

		// Tokens; ein gerade gezogenes Token folgt dem Finger.
		const shown =
			drag?.type === "token"
				? tokens.map((t) =>
						drag?.type === "token" && t.id === drag.id
							? { ...t, x: drag.x, y: drag.y }
							: t,
					)
				: tokens;
		propsLayer.set(shown.filter((t) => t.layer === "props"));
		tokenLayer.set(shown.filter((t) => t.layer === "tokens"));

		// Grid über der Karte; ohne Karte über dem sichtbaren Bereich.
		const area = scene?.map ? sceneBounds(scene) : view;
		grid.update(scene?.grid ?? null, area, resolution);
		app.render();
	}

	/** Zeigt eine geladene Kachel an; false, solange sie noch lädt. */
	function placeTile(tile: TileRef, layer: Container): boolean {
		const texture = cache.get(tile.key);
		if (!texture) return false;
		let sprite = sprites.get(tile.key);
		if (!sprite) {
			sprite = new Sprite(texture);
			sprites.set(tile.key, sprite);
			layer.addChild(sprite);
		}
		sprite.position.set(tile.world.x, tile.world.y);
		sprite.setSize(tile.world.width, tile.world.height);
		return true;
	}

	async function loadTile(tile: TileRef) {
		const res = await fetch(tile.url);
		if (!res.ok) throw new Error(`Kachel ${tile.url}: ${res.status}`);
		const bitmap = await createImageBitmap(await res.blob());
		const texture = new Texture({
			source: new ImageSource({ resource: bitmap, scaleMode: "linear" }),
		});
		return {
			value: texture,
			bytes: tile.bytes,
			release() {
				// Sprite zuerst entfernen, dann Grafik- und Bildspeicher freigeben.
				sprites.get(tile.key)?.destroy();
				sprites.delete(tile.key);
				texture.destroy(true);
				bitmap.close();
			},
		};
	}

	return {
		setScene(next) {
			const refit =
				next !== null &&
				(scene?.id !== next.id || scene.map?.id !== next.map?.id);
			if (scene?.map?.id !== next?.map?.id) {
				for (const sprite of sprites.values()) sprite.destroy();
				sprites.clear();
			}
			scene = next;
			if (refit && next) {
				const { width, height } = viewSize();
				camera.fit(sceneBounds(next), width, height);
			}
			requestRender();
		},
		setTokens(next) {
			tokens = next;
			// Token verschwunden (gelöscht, verborgen): laufenden Zug beenden.
			const dragged = drag?.type === "token" ? drag.id : null;
			if (dragged && !next.some((t) => t.id === dragged)) drag = null;
			requestRender();
		},
		viewCenter() {
			const { width, height } = viewSize();
			return camera.screenToWorld(width / 2, height / 2);
		},
		info: () => ({
			webgl2,
			maxTextureSize,
			budgetBytes,
			usedBytes: cache.usedBytes,
			level: lastLevel,
			tiles: lastTileCount,
		}),
		destroy() {
			cancelAnimationFrame(frame);
			detachGestures();
			detachWheel();
			cache.destroy();
			propsLayer.destroy();
			tokenLayer.destroy();
			textures.destroy();
			grid.destroy();
			app.destroy(true, { children: true });
		},
	};
}
