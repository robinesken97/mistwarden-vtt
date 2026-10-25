import type { AssetMeta, GridData } from "@mistwarden/protocol";
import {
	Application,
	Container,
	Graphics,
	ImageSource,
	RendererType,
	Sprite,
	Texture,
	type WebGLRenderer,
} from "pixi.js";
import { pointInFog } from "../fog/shapes.ts";
import {
	attachGestures,
	browserScheduler,
	GestureRecognizer,
} from "../input/gestures.ts";
import { attachWheelZoom, Camera } from "./camera.ts";
import { FogLayer, type StageFog } from "./fog.ts";
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

export type { StageFog } from "./fog.ts";
export type { StageToken } from "./tokens.ts";

export interface WorldPoint {
	x: number;
	y: number;
}

/** Angetipptes Objekt. */
export type StageTarget = { kind: "token" | "fog"; id: string };

/** Werkzeug für einen Finger bzw. die linke Maustaste. */
export type StageTool =
	| { type: "select" }
	| { type: "polygon" }
	| { type: "brush"; radius: number };

/** Rückmeldungen der Spielfläche an die Raumansicht. */
export interface StageCallbacks {
	/** Darf dieses Token gerade gezogen werden? */
	canDrag(tokenId: string): boolean;
	/** Antippen: Objekt auswählen bzw. Auswahl aufheben (null). */
	select(target: StageTarget | null): void;
	/** Langes Drücken oder Rechtsklick; Bildschirmposition für ein Menü. */
	context(target: StageTarget | null, screen: { x: number; y: number }): void;
	/** Token losgelassen; `free` = ohne Einrasten (Alt-Taste). */
	drop(tokenId: string, world: WorldPoint, free: boolean): void;
	/** Polygon-Werkzeug: Anzahl gesetzter Punkte hat sich geändert. */
	polygonChanged(points: number): void;
	/** Polygon geschlossen (Tipp auf den ersten Punkt oder finishPolygon). */
	polygonDone(points: WorldPoint[]): void;
	/** Pinselstrich beendet; Radius in Weltkoordinaten. */
	brushDone(stroke: WorldPoint[], radius: number): void;
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
	/** Fog-Formen der angezeigten Szene; `gm` = halbtransparent, ausgeschaltete als Umriss. */
	setFog(fog: StageFog[], gm: boolean): void;
	setTool(tool: StageTool): void;
	/** Polygon-Werkzeug: abschließen, letzten Punkt entfernen, verwerfen. */
	finishPolygon(): void;
	undoPolygonPoint(): void;
	cancelDrawing(): void;
	/** Nebel animieren (kostet Rechenzeit, deshalb abschaltbar). */
	setAnimateFog(on: boolean): void;
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
/** Nebelanimation: Bilder pro Sekunde (Touch-Geräte sparsamer). */
const FOG_FPS_TOUCH = 15;
const FOG_FPS_DESKTOP = 30;
/** So nah (Bildschirmpixel) am ersten Punkt schließt ein Tipp das Polygon. */
const CLOSE_DISTANCE = 18;

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
	// Fog über Karte, Props und Tokens; darüber Notizen, Zeichnungen und die Werkzeug-Vorschau.
	const fogLayer = new FogLayer();
	const preview = new Graphics({ label: "tool-preview" });
	world.addChild(
		mapLayer,
		propsLayer.container,
		tokenLayer.container,
		fogLayer.container,
		new Container({ label: "notes" }),
		new Container({ label: "drawings" }),
		preview,
	);
	app.stage.addChild(world);

	const camera = new Camera();
	const coarse = window.matchMedia("(pointer: coarse)").matches;
	const budgetBytes = defaultBudgetBytes(coarse);
	const fogFrameMs = 1000 / (coarse ? FOG_FPS_TOUCH : FOG_FPS_DESKTOP);
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
	let fog: StageFog[] = [];
	let fogGm = false;
	let animateFog = true;
	let animationTimer: ReturnType<typeof setTimeout> | undefined;
	const startTime = performance.now();
	let tool: StageTool = { type: "select" };
	let polygon: WorldPoint[] = [];
	let stroke: WorldPoint[] | null = null;
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

	const hitToken = (sx: number, sy: number): string | null => {
		const p = camera.screenToWorld(sx, sy);
		return tokenLayer.hitTest(p.x, p.y) ?? propsLayer.hitTest(p.x, p.y);
	};

	/** Tokens haben Vorrang; Fog-Flächen sind nur für die GM antippbar (oberste zuerst). */
	const hitTest = (sx: number, sy: number): StageTarget | null => {
		const token = hitToken(sx, sy);
		if (token) return { kind: "token", id: token };
		if (!fogGm) return null;
		const p = camera.screenToWorld(sx, sy);
		for (let i = fog.length - 1; i >= 0; i--) {
			const f = fog[i] as StageFog;
			if (pointInFog(f.polygons, p)) return { kind: "fog", id: f.id };
		}
		return null;
	};

	function addPolygonPoint(sx: number, sy: number): void {
		const first = polygon[0];
		if (first && polygon.length >= 3) {
			const firstScreen = {
				x: (first.x - camera.x) * camera.zoom,
				y: (first.y - camera.y) * camera.zoom,
			};
			if (
				Math.hypot(firstScreen.x - sx, firstScreen.y - sy) <= CLOSE_DISTANCE
			) {
				finishPolygon();
				return;
			}
		}
		polygon.push(camera.screenToWorld(sx, sy));
		callbacks.polygonChanged(polygon.length);
		requestRender();
	}

	function finishPolygon(): void {
		const points = polygon;
		polygon = [];
		callbacks.polygonChanged(0);
		if (points.length >= 3) callbacks.polygonDone(points);
		requestRender();
	}

	const recognizer = new GestureRecognizer(
		{
			tap(x, y) {
				if (tool.type === "polygon") return addPolygonPoint(x, y);
				if (tool.type === "brush") {
					callbacks.brushDone([camera.screenToWorld(x, y)], tool.radius);
					return;
				}
				callbacks.select(hitTest(x, y));
			},
			dragStart(x, y) {
				if (tool.type === "brush") {
					stroke = [camera.screenToWorld(x, y)];
					return;
				}
				// Im Polygon-Werkzeug verschiebt Ziehen mit einem Finger die Karte.
				const id = tool.type === "select" ? hitToken(x, y) : null;
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
				if (stroke) {
					stroke.push(camera.screenToWorld(x, y));
					requestRender();
					return;
				}
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
				if (stroke && tool.type === "brush") {
					const done = stroke;
					stroke = null;
					callbacks.brushDone(done, tool.radius);
					requestRender();
					return;
				}
				const done = drag;
				drag = null;
				if (done?.type === "token") {
					callbacks.drop(done.id, { x: done.x, y: done.y }, altKey);
				}
				requestRender();
			},
			dragCancel() {
				drag = null;
				stroke = null;
				requestRender();
			},
			context(x, y) {
				if (tool.type !== "select") return;
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

		// Nebel: Linienbreite in Weltkoordinaten so, dass sie auf dem Bildschirm ~1,5 px misst.
		const seconds = (performance.now() - startTime) / 1000;
		fogLayer.set(fog, fogGm, 1.5 / camera.zoom);
		fogLayer.update(view, scene?.grid.size ?? 100, animateFog ? seconds : 0);
		drawPreview();
		app.render();

		clearTimeout(animationTimer);
		if (animateFog && fogLayer.hasActive) {
			animationTimer = setTimeout(requestRender, fogFrameMs);
		}
	}

	/** Vorschau des Polygons bzw. Pinselstrichs, der gerade entsteht. */
	function drawPreview(): void {
		const g = preview.clear();
		const line = 2 / camera.zoom;
		if (polygon.length > 0) {
			const flat = polygon.flatMap((p) => [p.x, p.y]);
			if (polygon.length >= 3) {
				g.poly(flat).fill({ color: 0x000000, alpha: 0.35 });
			}
			g.poly(flat, false).stroke({ width: line, color: 0xffd23f });
			for (const [i, p] of polygon.entries()) {
				g.circle(p.x, p.y, (i === 0 ? 7 : 4) / camera.zoom).fill({
					color: i === 0 ? 0xffd23f : 0xffffff,
				});
			}
		}
		if (stroke && stroke.length > 0 && tool.type === "brush") {
			const first = stroke[0] as WorldPoint;
			g.moveTo(first.x, first.y);
			for (const p of stroke.slice(1)) g.lineTo(p.x, p.y);
			if (stroke.length === 1) g.lineTo(first.x + 0.01, first.y);
			g.stroke({
				width: tool.radius * 2,
				color: 0x000000,
				alpha: 0.45,
				cap: "round",
				join: "round",
			});
		}
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
		setFog(next, gm) {
			fog = next;
			fogGm = gm;
			requestRender();
		},
		setTool(next) {
			tool = next;
			if (next.type !== "polygon" && polygon.length > 0) {
				polygon = [];
				callbacks.polygonChanged(0);
			}
			stroke = null;
			requestRender();
		},
		finishPolygon,
		undoPolygonPoint() {
			polygon.pop();
			callbacks.polygonChanged(polygon.length);
			requestRender();
		},
		cancelDrawing() {
			polygon = [];
			stroke = null;
			callbacks.polygonChanged(0);
			requestRender();
		},
		setAnimateFog(on) {
			animateFog = on;
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
			clearTimeout(animationTimer);
			fogLayer.destroy();
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
