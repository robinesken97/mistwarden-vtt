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
 * Maus und Touch: ein Finger bzw. gedrückte Maus verschiebt, zwei Finger zoomen,
 * Mausrad zoomt um den Mauszeiger (Trackpad-Pinch kommt als Rad mit ctrlKey).
 * In Schritt 4 entscheidet ein Treffer-Test vorab, ob ein Token gezogen wird.
 */
export function attachCameraControls(
	el: HTMLElement,
	camera: Camera,
	onChange: () => void,
): () => void {
	const pointers = new Map<number, { x: number; y: number }>();
	let pinch: { distance: number; mid: { x: number; y: number } } | null = null;

	const local = (e: { clientX: number; clientY: number }) => {
		const r = el.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};

	const pinchState = () => {
		const [a, b] = [...pointers.values()] as [
			{ x: number; y: number },
			{ x: number; y: number },
		];
		return {
			distance: Math.hypot(a.x - b.x, a.y - b.y),
			mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
		};
	};

	const down = (e: PointerEvent) => {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		el.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, local(e));
		pinch = pointers.size === 2 ? pinchState() : null;
	};

	const move = (e: PointerEvent) => {
		const prev = pointers.get(e.pointerId);
		if (!prev) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pointers.size === 1) {
			camera.panBy(p.x - prev.x, p.y - prev.y);
		} else if (pointers.size === 2 && pinch) {
			const next = pinchState();
			camera.panBy(next.mid.x - pinch.mid.x, next.mid.y - pinch.mid.y);
			if (pinch.distance > 0) {
				camera.zoomAt(next.mid.x, next.mid.y, next.distance / pinch.distance);
			}
			pinch = next;
		} else {
			return;
		}
		onChange();
	};

	const up = (e: PointerEvent) => {
		pointers.delete(e.pointerId);
		pinch = pointers.size === 2 ? pinchState() : null;
	};

	const wheel = (e: WheelEvent) => {
		e.preventDefault();
		const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
		const delta = e.deltaY * unit;
		const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
		const p = local(e);
		camera.zoomAt(p.x, p.y, factor);
		onChange();
	};

	// Safari: eigene Trackpad-Gesten abfangen, sonst zoomt die ganze Seite.
	const gesture = (e: Event) => e.preventDefault();
	// Rechtsklick ist ab Schritt 4 belegt (Ping, Kontextmenü), nicht das Browsermenü.
	const contextmenu = (e: Event) => e.preventDefault();

	el.style.touchAction = "none";
	el.addEventListener("pointerdown", down);
	el.addEventListener("pointermove", move);
	el.addEventListener("pointerup", up);
	el.addEventListener("pointercancel", up);
	el.addEventListener("wheel", wheel, { passive: false });
	el.addEventListener("gesturestart", gesture);
	el.addEventListener("contextmenu", contextmenu);

	return () => {
		el.removeEventListener("pointerdown", down);
		el.removeEventListener("pointermove", move);
		el.removeEventListener("pointerup", up);
		el.removeEventListener("pointercancel", up);
		el.removeEventListener("wheel", wheel);
		el.removeEventListener("gesturestart", gesture);
		el.removeEventListener("contextmenu", contextmenu);
	};
}
