// Gestenerkennung als reine Logik (ohne DOM), damit sie mit künstlichen Zeigerereignissen
// testbar ist. Unterscheidet Tippen, Ziehen, langes Drücken, Zwei-Finger-Pinch und Rechtsklick.

export interface PointerInput {
	id: number;
	x: number;
	y: number;
	/** 0 = links bzw. Touch, 2 = rechts. */
	button: number;
	kind: "mouse" | "touch" | "pen";
	altKey: boolean;
}

export interface GestureHandlers {
	tap(x: number, y: number): void;
	/** Ziehen beginnt an der Stelle, an der der Finger aufgesetzt wurde. */
	dragStart(x: number, y: number): void;
	dragMove(x: number, y: number, altKey: boolean): void;
	dragEnd(x: number, y: number, altKey: boolean): void;
	/** Ziehen wurde durch einen zweiten Finger abgebrochen. */
	dragCancel(): void;
	/** Langes Drücken (Touch) oder Rechtsklick (Maus). */
	context(x: number, y: number): void;
	/** Zwei Finger: Faktor seit dem letzten Aufruf und Verschiebung der Mitte. */
	pinch(
		midX: number,
		midY: number,
		factor: number,
		dx: number,
		dy: number,
	): void;
}

export type Scheduler = (fn: () => void, ms: number) => () => void;

/** Ab dieser Bewegung (Pixel) ist es kein Tippen mehr, sondern Ziehen. */
export const DRAG_THRESHOLD = 6;
/** So lange still halten für langes Drücken. */
export const LONG_PRESS_MS = 500;

type State =
	| { type: "idle" }
	| {
			type: "pressed";
			id: number;
			startX: number;
			startY: number;
			cancelTimer: () => void;
	  }
	| { type: "dragging"; id: number }
	| { type: "longPressed"; id: number }
	| { type: "pinching" }
	/** Nach Pinch oder Abbruch: warten, bis alle Finger weg sind. */
	| { type: "settling" };

export class GestureRecognizer {
	readonly #h: GestureHandlers;
	readonly #schedule: Scheduler;
	readonly #pointers = new Map<number, { x: number; y: number }>();
	#state: State = { type: "idle" };
	#pinch: { distance: number; midX: number; midY: number } | null = null;

	constructor(handlers: GestureHandlers, schedule: Scheduler) {
		this.#h = handlers;
		this.#schedule = schedule;
	}

	down(p: PointerInput): void {
		// Rechtsklick: sofort Kontextmenü, keine weitere Geste.
		if (p.kind === "mouse" && p.button === 2) {
			this.#h.context(p.x, p.y);
			return;
		}
		if (p.kind === "mouse" && p.button !== 0) return;
		this.#pointers.set(p.id, { x: p.x, y: p.y });

		if (this.#pointers.size === 1 && this.#state.type === "idle") {
			const cancelTimer = this.#schedule(
				() => this.#longPress(p.id),
				LONG_PRESS_MS,
			);
			this.#state = {
				type: "pressed",
				id: p.id,
				startX: p.x,
				startY: p.y,
				cancelTimer,
			};
			return;
		}
		if (this.#pointers.size === 2) {
			if (this.#state.type === "pressed") this.#state.cancelTimer();
			if (this.#state.type === "dragging") this.#h.dragCancel();
			this.#state = { type: "pinching" };
			this.#pinch = this.#pinchState();
		}
	}

	move(p: PointerInput): void {
		const prev = this.#pointers.get(p.id);
		if (!prev) return;
		this.#pointers.set(p.id, { x: p.x, y: p.y });
		const s = this.#state;

		if (s.type === "pressed" && s.id === p.id) {
			if (Math.hypot(p.x - s.startX, p.y - s.startY) < DRAG_THRESHOLD) return;
			s.cancelTimer();
			this.#state = { type: "dragging", id: p.id };
			this.#h.dragStart(s.startX, s.startY);
			this.#h.dragMove(p.x, p.y, p.altKey);
			return;
		}
		if (s.type === "dragging" && s.id === p.id) {
			this.#h.dragMove(p.x, p.y, p.altKey);
			return;
		}
		if (s.type === "pinching" && this.#pointers.size === 2 && this.#pinch) {
			const next = this.#pinchState();
			const factor =
				this.#pinch.distance > 0 ? next.distance / this.#pinch.distance : 1;
			this.#h.pinch(
				next.midX,
				next.midY,
				factor,
				next.midX - this.#pinch.midX,
				next.midY - this.#pinch.midY,
			);
			this.#pinch = next;
		}
	}

	up(p: PointerInput): void {
		if (!this.#pointers.has(p.id)) return;
		this.#pointers.delete(p.id);
		const s = this.#state;
		if (s.type === "pressed" && s.id === p.id) {
			s.cancelTimer();
			this.#h.tap(s.startX, s.startY);
		} else if (s.type === "dragging" && s.id === p.id) {
			this.#h.dragEnd(p.x, p.y, p.altKey);
		}
		this.#settle();
	}

	cancel(p: PointerInput): void {
		if (!this.#pointers.has(p.id)) return;
		this.#pointers.delete(p.id);
		const s = this.#state;
		if (s.type === "pressed") s.cancelTimer();
		if (s.type === "dragging") this.#h.dragCancel();
		this.#settle();
	}

	#settle(): void {
		this.#pinch = null;
		this.#state =
			this.#pointers.size === 0 ? { type: "idle" } : { type: "settling" };
	}

	#longPress(id: number): void {
		const s = this.#state;
		if (s.type !== "pressed" || s.id !== id) return;
		this.#state = { type: "longPressed", id };
		this.#h.context(s.startX, s.startY);
	}

	#pinchState() {
		const [a, b] = [...this.#pointers.values()] as [
			{ x: number; y: number },
			{ x: number; y: number },
		];
		return {
			distance: Math.hypot(a.x - b.x, a.y - b.y),
			midX: (a.x + b.x) / 2,
			midY: (a.y + b.y) / 2,
		};
	}
}

/** Verbindet die Erkennung mit Zeigerereignissen eines Elements. */
export function attachGestures(
	el: HTMLElement,
	recognizer: GestureRecognizer,
): () => void {
	const toInput = (e: PointerEvent): PointerInput => {
		const r = el.getBoundingClientRect();
		return {
			id: e.pointerId,
			x: e.clientX - r.left,
			y: e.clientY - r.top,
			button: e.button,
			kind:
				e.pointerType === "touch"
					? "touch"
					: e.pointerType === "pen"
						? "pen"
						: "mouse",
			altKey: e.altKey,
		};
	};
	const down = (e: PointerEvent) => {
		if (e.button === 0) el.setPointerCapture(e.pointerId);
		recognizer.down(toInput(e));
	};
	const move = (e: PointerEvent) => recognizer.move(toInput(e));
	const up = (e: PointerEvent) => recognizer.up(toInput(e));
	const cancel = (e: PointerEvent) => recognizer.cancel(toInput(e));
	// Browsermenü und Safari-Trackpad-Gesten abfangen.
	const prevent = (e: Event) => e.preventDefault();

	el.style.touchAction = "none";
	el.addEventListener("pointerdown", down);
	el.addEventListener("pointermove", move);
	el.addEventListener("pointerup", up);
	el.addEventListener("pointercancel", cancel);
	el.addEventListener("contextmenu", prevent);
	el.addEventListener("gesturestart", prevent);
	return () => {
		el.removeEventListener("pointerdown", down);
		el.removeEventListener("pointermove", move);
		el.removeEventListener("pointerup", up);
		el.removeEventListener("pointercancel", cancel);
		el.removeEventListener("contextmenu", prevent);
		el.removeEventListener("gesturestart", prevent);
	};
}

export const browserScheduler: Scheduler = (fn, ms) => {
	const t = setTimeout(fn, ms);
	return () => clearTimeout(t);
};
