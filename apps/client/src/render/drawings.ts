import type { DrawingData } from "@mistwarden/protocol";
import { Container, Graphics } from "pixi.js";
import { drawingOutline } from "../draw/shapes.ts";

/** Eine Zeichnung, wie die Spielfläche sie zeichnet. */
export interface StageDrawing {
	id: string;
	version: number;
	shape: DrawingData["shape"];
	points: number[];
	color: string;
	width: number;
	/** Darf mit dem Radierer gelöscht werden (eigene bzw. als GM alle)? */
	erasable: boolean;
}

/** Ping, solange er sichtbar ist. */
interface Ping {
	x: number;
	y: number;
	color: string;
	start: number;
}

/** Dauer eines Pings in Millisekunden. */
export const PING_MS = 1600;

/**
 * Ebene „Zeichnungen“: alle Zeichnungen einer Szene in einer Grafik, die nur bei
 * Änderungen neu aufgebaut wird, darüber die Pings.
 */
export class DrawingLayer {
	readonly container = new Container({ label: "drawings" });
	readonly #lines = new Graphics({ label: "drawing-lines" });
	readonly #pings = new Graphics({ label: "pings" });
	#drawings: StageDrawing[] = [];
	#key = "";
	#active: Ping[] = [];

	constructor() {
		this.container.addChild(this.#lines, this.#pings);
	}

	get drawings(): readonly StageDrawing[] {
		return this.#drawings;
	}

	/** Baut die Grafik nur neu, wenn sich Zeichnungen geändert haben. */
	set(drawings: StageDrawing[]): void {
		this.#drawings = drawings;
		const key = drawings
			.map((d) => `${d.id}:${d.version}:${d.erasable}`)
			.join(",");
		if (key === this.#key) return;
		this.#key = key;
		const g = this.#lines.clear();
		for (const d of drawings) strokeDrawing(g, d, d.color, d.width, 0.9);
	}

	ping(x: number, y: number, color: string, now: number): void {
		this.#active.push({ x, y, color, start: now });
	}

	/** Zeichnet die Pings neu; true, solange noch einer läuft. */
	updatePings(now: number, zoom: number): boolean {
		this.#active = this.#active.filter((p) => now - p.start < PING_MS);
		const g = this.#pings.clear();
		for (const p of this.#active) {
			const t = (now - p.start) / PING_MS;
			// Größe auf dem Bildschirm konstant, unabhängig vom Zoom.
			for (const delay of [0, 0.25]) {
				const k = Math.max(0, Math.min(1, (t - delay) / (1 - delay)));
				if (k <= 0) continue;
				g.circle(p.x, p.y, (8 + 42 * k) / zoom).stroke({
					width: 4 / zoom,
					color: p.color,
					alpha: 1 - k,
				});
			}
			g.circle(p.x, p.y, 6 / zoom).fill({ color: p.color, alpha: 1 - t });
		}
		return this.#active.length > 0;
	}

	destroy(): void {
		this.container.destroy({ children: true });
	}
}

/** Strich einer Zeichnung; auch für die Vorschau beim Zeichnen. */
export function strokeDrawing(
	g: Graphics,
	d: Pick<DrawingData, "shape" | "points">,
	color: string,
	width: number,
	alpha: number,
): void {
	const { points, closed } = drawingOutline(d);
	if (points.length < 2) return;
	const [x0 = 0, y0 = 0] = points;
	g.moveTo(x0, y0);
	// Ein einzelner Punkt (Tipp) wird als kurzer Strich sichtbar.
	if (points.length === 4 && points[2] === x0 && points[3] === y0) {
		g.lineTo(x0 + 0.01, y0);
	}
	for (let i = 2; i < points.length; i += 2) {
		g.lineTo(points[i] as number, points[i + 1] as number);
	}
	if (closed) g.closePath();
	g.stroke({ width, color, alpha, cap: "round", join: "round" });
}
