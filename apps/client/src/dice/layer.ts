// Würfelanimation über der Karte: Zeitablauf und Auswahl der Darstellung. Die 3D-Ansicht
// (three.js) wird erst beim ersten Wurf geladen; schlägt sie fehl oder ist „einfach“ gewählt,
// zeichnet die CSS-Ansicht dieselben Körper ohne zweiten WebGL-Kontext.
import { createCssView } from "./css-view.ts";
import type { DiceMode } from "./mode.ts";
import { type PlannedDie, poseAt } from "./plan.ts";

export type Pose = ReturnType<typeof poseAt>;

/** Eine Darstellung der Würfel; Koordinaten relativ zur Mitte der Fläche, y nach unten. */
export interface DiceView {
	build(dice: PlannedDie[], color: string, textColor: string): void;
	frame(poses: Pose[], opacity: number, width: number, height: number): void;
	clear(): void;
	destroy(): void;
}

/** Halber Durchmesser eines Würfels in Pixeln. */
export const DIE_SCALE = 34;
/** So lange bleiben die Würfel liegen, dann blenden sie aus. */
const HOLD_MS = 1800;
const FADE_MS = 400;
/** Nach dieser Ruhezeit gibt die 3D-Ansicht ihren WebGL-Kontext wieder frei. */
const RELEASE_MS = 30_000;

/** Schwarz oder Weiß, je nachdem, was auf `color` (#rrggbb) besser lesbar ist. */
export function readableOn(color: string): string {
	const n = Number.parseInt(color.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#1b1a1d" : "#ffffff";
}

export function createDiceLayer(mode: () => DiceMode) {
	const el = document.createElement("div");
	el.className = "dice-layer";
	el.setAttribute("aria-hidden", "true");
	let view: DiceView | null = null;
	let viewIs3d = false;
	let raf = 0;
	let release: ReturnType<typeof setTimeout> | undefined;
	let run = 0;
	const reduce = window.matchMedia?.(
		"(prefers-reduced-motion: reduce)",
	).matches;

	function drop(): void {
		cancelAnimationFrame(raf);
		view?.destroy();
		view = null;
	}

	async function viewFor(want3d: boolean): Promise<DiceView> {
		if (view && viewIs3d === want3d) return view;
		drop();
		if (want3d) {
			try {
				const { createThreeView } = await import("./three-view.ts");
				view = createThreeView(el);
				viewIs3d = true;
				return view;
			} catch {
				// Kein WebGL oder Laden fehlgeschlagen: einfache Darstellung.
			}
		}
		view = createCssView(el);
		viewIs3d = false;
		return view;
	}

	return {
		el,
		/** Zeigt einen Wurf; ein laufender wird ersetzt. `color` ist die Farbe des Würfelnden. */
		async play(dice: PlannedDie[], color: string): Promise<void> {
			const current = mode();
			if (current === "off") return;
			const id = ++run;
			clearTimeout(release);
			const v = await viewFor(current === "3d");
			if (id !== run) return;
			cancelAnimationFrame(raf);
			v.build(dice, color, readableOn(color));
			// Ohne Bewegung: gleich die Endlage zeigen.
			const start = performance.now() - (reduce ? 10_000 : 0);
			const tick = (now: number) => {
				const ms = now - start;
				const poses = dice.map((d) => poseAt(d, ms));
				const settled = Math.max(...dice.map((d) => d.delay)) + 1300;
				const rest = ms - settled - (reduce ? -10_000 : 0);
				const opacity = Math.max(
					0,
					Math.min(1, 1 - (rest - HOLD_MS) / FADE_MS),
				);
				v.frame(poses, opacity, el.clientWidth, el.clientHeight);
				if (opacity > 0) {
					raf = requestAnimationFrame(tick);
					return;
				}
				v.clear();
				release = setTimeout(drop, RELEASE_MS);
			};
			raf = requestAnimationFrame(tick);
		},
		destroy(): void {
			run++;
			clearTimeout(release);
			drop();
			el.remove();
		},
	};
}
