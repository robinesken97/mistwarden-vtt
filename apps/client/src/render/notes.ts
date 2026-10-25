import { Container, Graphics } from "pixi.js";

/** Eine Notiz, wie die Spielfläche sie zeichnet. */
export interface StageNote {
	id: string;
	x: number;
	y: number;
	/** Nur für die GM; sie sieht die Markierung gestrichelt umrandet. */
	hidden: boolean;
	selected: boolean;
	/** Darf gezogen werden (nur die GM). */
	draggable: boolean;
}

/** Radius der Markierung in Bildschirmpixeln (unabhängig vom Zoom). */
const MARKER_PX = 13;
/** Trefferzone in Bildschirmpixeln (Finger brauchen Platz). */
const HIT_PX = 22;

/** Ebene „Notizen“: eine Markierung pro Notiz, Größe auf dem Bildschirm konstant. */
export class NoteLayer {
	readonly container = new Container({ label: "notes" });
	readonly #g = new Graphics({ label: "note-markers" });
	#notes: StageNote[] = [];

	constructor() {
		this.container.addChild(this.#g);
	}

	get notes(): readonly StageNote[] {
		return this.#notes;
	}

	set(notes: StageNote[]): void {
		this.#notes = notes;
	}

	/** Zeichnet alle Markierungen; `moved` ersetzt die Position einer gerade gezogenen Notiz. */
	update(zoom: number, moved: { id: string; x: number; y: number } | null) {
		const g = this.#g.clear();
		const r = MARKER_PX / zoom;
		for (const n of this.#notes) {
			const p = moved?.id === n.id ? moved : n;
			const alpha = n.hidden ? 0.6 : 1;
			g.roundRect(p.x - r, p.y - r, r * 2, r * 2, r * 0.35).fill({
				color: 0xffd23f,
				alpha,
			});
			// Drei Zeilen als Symbol für Text.
			for (const dy of [-0.4, 0, 0.4]) {
				g.moveTo(p.x - r * 0.55, p.y + dy * r)
					.lineTo(p.x + r * 0.55, p.y + dy * r)
					.stroke({ width: 2 / zoom, color: 0x3b3220, alpha });
			}
			if (n.hidden || n.selected) {
				g.roundRect(p.x - r, p.y - r, r * 2, r * 2, r * 0.35).stroke({
					width: (n.selected ? 3 : 2) / zoom,
					color: n.selected ? 0xffffff : 0x5b4b8a,
				});
			}
		}
	}

	/** Oberste Notiz unter dem Punkt (Weltkoordinaten). */
	hitTest(x: number, y: number, zoom: number): string | null {
		const reach = HIT_PX / zoom;
		for (let i = this.#notes.length - 1; i >= 0; i--) {
			const n = this.#notes[i] as StageNote;
			if (Math.abs(n.x - x) <= reach && Math.abs(n.y - y) <= reach) return n.id;
		}
		return null;
	}

	destroy(): void {
		this.container.destroy({ children: true });
	}
}
