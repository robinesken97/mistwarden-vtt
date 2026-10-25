import type { RollTerm } from "./entities.ts";

// Würfelformeln: Summanden mit + und -, jeder entweder eine ganze Zahl oder `NdX`
// mit optionalem `khN`/`klN` (die N höchsten bzw. niedrigsten behalten, ohne N: einen).
// Beispiele: 1d20+5, 4d6kh3, 2d20kl1+1d4-1, d%. Der Client prüft nur, der Server würfelt.

export const MAX_FORMULA_LENGTH = 100;
export const MAX_DICE = 100;
export const MAX_TERMS = 20;
export const MAX_SIDES = 1000;
export const MAX_CONSTANT = 100_000;

export type DiceTerm =
	| {
			type: "dice";
			sign: 1 | -1;
			count: number;
			sides: number;
			keep: { mode: "h" | "l"; n: number } | null;
	  }
	| { type: "const"; sign: 1 | -1; value: number };

export type ParseResult =
	| { ok: true; terms: DiceTerm[]; formula: string }
	| { ok: false; error: string };

const TERM = /^(?:(\d*)d(\d+|%)(?:k([hl])(\d*))?|(\d+))$/;

/** Prüft eine Formel und liefert die Summanden sowie die normierte Schreibweise. */
export function parseDice(input: string): ParseResult {
	if (input.length > MAX_FORMULA_LENGTH) {
		return { ok: false, error: "Formel zu lang" };
	}
	const text = input.replace(/\s+/g, "").toLowerCase();
	if (text === "") return { ok: false, error: "Leere Formel" };

	const parts = text.split(/(?=[+-])/);
	if (parts.length > MAX_TERMS)
		return { ok: false, error: "Zu viele Summanden" };

	const terms: DiceTerm[] = [];
	let dice = 0;
	for (const part of parts) {
		const sign = part.startsWith("-") ? -1 : 1;
		const body = part.replace(/^[+-]/, "");
		const m = TERM.exec(body);
		if (!m) return { ok: false, error: `Unverständlich: ${part}` };
		const [, countText, sidesText, keepMode, keepText, constText] = m;
		if (constText !== undefined) {
			const value = Number(constText);
			if (value > MAX_CONSTANT) return { ok: false, error: "Zahl zu groß" };
			terms.push({ type: "const", sign, value });
			continue;
		}
		const count = countText ? Number(countText) : 1;
		const sides = sidesText === "%" ? 100 : Number(sidesText);
		if (count < 1) return { ok: false, error: "Mindestens ein Würfel" };
		if (sides < 2 || sides > MAX_SIDES) {
			return { ok: false, error: `Würfel mit 2 bis ${MAX_SIDES} Seiten` };
		}
		dice += count;
		if (dice > MAX_DICE) {
			return { ok: false, error: `Höchstens ${MAX_DICE} Würfel` };
		}
		let keep: { mode: "h" | "l"; n: number } | null = null;
		if (keepMode === "h" || keepMode === "l") {
			const n = keepText ? Number(keepText) : 1;
			if (n < 1 || n > count) {
				return { ok: false, error: "Behalten: 1 bis Anzahl der Würfel" };
			}
			keep = { mode: keepMode, n };
		}
		terms.push({ type: "dice", sign, count, sides, keep });
	}
	return { ok: true, terms, formula: formatDice(terms) };
}

/** Normierte Schreibweise, z. B. "4d6kh3+2". */
export function formatDice(terms: DiceTerm[]): string {
	return terms
		.map((t, i) => {
			const sign = t.sign < 0 ? "-" : i === 0 ? "" : "+";
			if (t.type === "const") return `${sign}${t.value}`;
			const keep = t.keep ? `k${t.keep.mode}${t.keep.n}` : "";
			return `${sign}${t.count}d${t.sides}${keep}`;
		})
		.join("");
}

/**
 * Würfelt die Summanden aus. `die(sides)` liefert eine ganze Zahl von 1 bis `sides`;
 * der Server übergibt kryptografischen Zufall, Tests einen festen.
 */
export function rollDice(
	terms: DiceTerm[],
	die: (sides: number) => number,
): { terms: RollTerm[]; total: number } {
	let total = 0;
	const rolled = terms.map((t): RollTerm => {
		if (t.type === "const") {
			total += t.sign * t.value;
			return t;
		}
		const results = Array.from({ length: t.count }, () => die(t.sides));
		const kept = keptMask(results, t.keep);
		for (let i = 0; i < results.length; i++) {
			if (kept[i]) total += t.sign * (results[i] as number);
		}
		return { ...t, results, kept };
	});
	return { terms: rolled, total };
}

/** Welche Ergebnisse zählen; bei Gleichstand gewinnt der frühere Würfel. */
function keptMask(
	results: number[],
	keep: { mode: "h" | "l"; n: number } | null,
): boolean[] {
	if (!keep) return results.map(() => true);
	const order = results
		.map((value, index) => ({ value, index }))
		.sort((a, b) =>
			keep.mode === "h"
				? b.value - a.value || a.index - b.index
				: a.value - b.value || a.index - b.index,
		);
	const mask = results.map(() => false);
	for (const { index } of order.slice(0, keep.n)) mask[index] = true;
	return mask;
}
