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

/** Mausrad zoomt um den Mauszeiger (Trackpad-Pinch kommt als Rad mit ctrlKey). */
export function attachWheelZoom(
	el: HTMLElement,
	camera: Camera,
	onChange: () => void,
): () => void {
	const wheel = (e: WheelEvent) => {
		e.preventDefault();
		const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
		const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
		const r = el.getBoundingClientRect();
		camera.zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
		onChange();
	};
	el.addEventListener("wheel", wheel, { passive: false });
	return () => el.removeEventListener("wheel", wheel);
}
