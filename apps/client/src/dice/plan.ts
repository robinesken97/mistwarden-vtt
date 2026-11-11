// Wurfplan: aus dem Serverergebnis wird eine feste Abfolge – welche Würfel fliegen, wohin,
// wie sie sich drehen und auf welcher Fläche sie enden. Alles hängt nur vom Wurf ab, damit
// jedes Gerät denselben Flug zeigt. Keine Darstellung, keine Abhängigkeiten.
import type { RollTerm } from "@mistwarden/protocol";
import { type DieKind, norm, type Vec } from "./geometry.ts";

/** Mehr Würfel in einem Wurf werden nicht animiert; das Ergebnis steht dann nur im Log. */
export const MAX_ANIMATED_DICE = 20;
/** Flugdauer eines Würfels und Abstand zwischen den Starts, in Millisekunden. */
export const FLIGHT_MS = 1300;
const STAGGER_MS = 80;
/** Abstand der Liegeplätze in Pixeln. */
const SPACING = 96;
const PER_ROW = 5;

export interface PlannedDie {
	kind: DieKind;
	/** Beschriftung jeder Fläche. */
	labels: string[];
	/** Index der Fläche, die am Ende oben liegt. */
	face: number;
	/** Start und Ziel relativ zur Mitte der Spielfläche, in Pixeln (y nach unten). */
	from: { x: number; y: number };
	to: { x: number; y: number };
	/** Drehachse des Taumelns und Gesamtwinkel in Radiant. */
	axis: Vec;
	spin: number;
	/** Startverzögerung in Millisekunden. */
	delay: number;
}

const KINDS: readonly number[] = [4, 6, 8, 10, 12, 20];
const numbers = (n: number) =>
	Array.from({ length: n }, (_, i) => String(i + 1));
const TENS = Array.from({ length: 10 }, (_, i) => `${i}0`);
const ONES = Array.from({ length: 10 }, (_, i) => String(i));

/** Würfel eines Ergebnisses: der d100 fliegt als Zehner- und Einerwürfel. */
function diceOf(
	terms: RollTerm[],
): Pick<PlannedDie, "kind" | "labels" | "face">[] {
	const out: Pick<PlannedDie, "kind" | "labels" | "face">[] = [];
	for (const term of terms) {
		if (term.type !== "dice") continue;
		for (const result of term.results) {
			if (term.sides === 100) {
				out.push(
					{ kind: 10, labels: TENS, face: Math.floor((result % 100) / 10) },
					{ kind: 10, labels: ONES, face: result % 10 },
				);
			} else if (KINDS.includes(term.sides)) {
				out.push({
					kind: term.sides as DieKind,
					labels: numbers(term.sides),
					face: result - 1,
				});
			}
		}
	}
	return out;
}

/** Kleiner Zufallsgenerator mit festem Startwert (mulberry32 über einen Zeichenketten-Hash). */
function seeded(seed: string): () => number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	let a = h >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Plan für einen Wurf, oder null, wenn nichts animiert wird (keine passenden Würfel oder
 * mehr als `MAX_ANIMATED_DICE`). `seed` ist die ID des Wurfs.
 */
export function planRoll(terms: RollTerm[], seed: string): PlannedDie[] | null {
	const dice = diceOf(terms);
	if (dice.length === 0 || dice.length > MAX_ANIMATED_DICE) return null;
	const random = seeded(seed);
	const rows = Math.ceil(dice.length / PER_ROW);
	const stagger = Math.min(STAGGER_MS, 600 / dice.length);
	return dice.map((die, i): PlannedDie => {
		const row = Math.floor(i / PER_ROW);
		const inRow = Math.min(PER_ROW, dice.length - row * PER_ROW);
		const to = {
			x: ((i % PER_ROW) - (inRow - 1) / 2) * SPACING + (random() - 0.5) * 14,
			y: (row - (rows - 1) / 2) * SPACING + (random() - 0.5) * 14,
		};
		return {
			...die,
			to,
			// Die Würfel kommen von unten links ins Bild.
			from: { x: to.x - 220, y: to.y + 420 },
			axis: norm([random() - 0.5, random() - 0.5, random() - 0.5]),
			spin: 11 + random() * 5,
			delay: i * stagger,
		};
	});
}

/** Lage eines Würfels zum Zeitpunkt `ms` nach Wurfbeginn. */
export function poseAt(
	die: PlannedDie,
	ms: number,
): { x: number; y: number; z: number; angle: number; done: boolean } {
	const p = Math.max(0, Math.min(1, (ms - die.delay) / FLIGHT_MS));
	const ease = 1 - (1 - p) ** 3;
	return {
		x: die.from.x + (die.to.x - die.from.x) * ease,
		y: die.from.y + (die.to.y - die.from.y) * ease,
		// Ein Bogen, der zum Ende hin flach ausläuft.
		z: Math.sin(Math.min(1, p * 1.25) * Math.PI) * 150 * (1 - p),
		// Das Taumeln klingt aus; bei 0 liegt der Würfel in seiner Endlage.
		angle: (1 - ease) * die.spin,
		done: p >= 1,
	};
}
