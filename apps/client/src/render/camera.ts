import type { Rect } from "./tiles.ts";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

/**
 * Kamera: Bildschirm = (Welt − Position) × Zoom.
 * Position ist der Weltpunkt in der linken oberen Ecke des Bildschirms.
 */
export class Camera {
	x = 0;
	y = 0;
	zoom = 1;

	screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
	}

	/** Zoomt um einen Bildschirmpunkt, der dabei an Ort und Stelle bleibt. */
	zoomAt(sx: number, sy: number, factor: number): void {
		const before = this.screenToWorld(sx, sy);
		this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
		this.x = before.x - sx / this.zoom;
		this.y = before.y - sy / this.zoom;
	}

	panBy(dxScreen: number, dyScreen: number): void {
		this.x -= dxScreen / this.zoom;
		this.y -= dyScreen / this.zoom;
	}

	/** Zeigt ein Weltrechteck vollständig und zentriert, mit etwas Rand. */
	fit(rect: Rect, viewWidth: number, viewHeight: number, margin = 0.05): void {
		const zoom = Math.min(
			viewWidth / (rect.width * (1 + 2 * margin)),
			viewHeight / (rect.height * (1 + 2 * margin)),
		);
		this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
		this.x = rect.x + rect.width / 2 - viewWidth / 2 / this.zoom;
		this.y = rect.y + rect.height / 2 - viewHeight / 2 / this.zoom;
	}

	view(viewWidth: number, viewHeight: number): Rect {
		return {
			x: this.x,
			y: this.y,
			width: viewWidth / this.zoom,
			height: viewHeight / this.zoom,
		};
	}
}

/**
 * Kleinster Schritt eines klassischen Mausrads am Mac in Safari und Chrome:
 * Zeilen-Delta von macOS (Vielfache von 0,1000061) × 40 Pixel pro Zeile.
 */
const MAC_WHEEL_STEP = 4.000244140625;
/** So lange nach einem Trackpad-Ereignis gelten weitere (Schwung-)Ereignisse als Trackpad. */
export const TRACKPAD_STICKY_MS = 300;

/**
 * Trackpad-Scrollen oder Mausrad? Der Browser sagt es nicht direkt, deshalb:
 * - Pinch kommt als Rad mit ctrlKey und zoomt immer.
 * - deltaMode Zeile/Seite (Firefox) oder Vielfache von MAC_WHEEL_STEP sind ein Mausrad.
 * - deltaX ≠ 0 kann nur ein Trackpad (bzw. Shift+Rad, s. o. schon als Rad erkannt).
 * - Kurz nach einem Trackpad-Ereignis bleibt es Trackpad, auch bei großen Schwung-Deltas.
 * - Sonst: grobe ganze Schritte (Windows: 100 bzw. 120) sind ein Mausrad, feine ein Trackpad.
 */
export function wheelAction(
	e: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">,
	msSinceTrackpad: number,
): "zoom" | "pan" {
	if (e.ctrlKey || e.deltaMode !== 0) return "zoom";
	if (e.deltaX % MAC_WHEEL_STEP === 0 && e.deltaY % MAC_WHEEL_STEP === 0) {
		return "zoom";
	}
	if (e.deltaX !== 0 || msSinceTrackpad < TRACKPAD_STICKY_MS) return "pan";
	return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50
		? "zoom"
		: "pan";
}

/**
 * Trackpad: zwei Finger verschieben, Pinch zoomt. Mausrad zoomt.
 * Gezoomt wird immer um den Mauszeiger.
 */
export function attachWheelZoom(
	el: HTMLElement,
	camera: Camera,
	onChange: () => void,
): () => void {
	let lastTrackpad = Number.NEGATIVE_INFINITY;
	const wheel = (e: WheelEvent) => {
		e.preventDefault();
		if (wheelAction(e, e.timeStamp - lastTrackpad) === "pan") {
			lastTrackpad = e.timeStamp;
			camera.panBy(-e.deltaX, -e.deltaY);
			onChange();
			return;
		}
		const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
		const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
		const r = el.getBoundingClientRect();
		camera.zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
		onChange();
	};
	el.addEventListener("wheel", wheel, { passive: false });
	return () => el.removeEventListener("wheel", wheel);
}
