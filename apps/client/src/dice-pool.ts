// Würfelvorrat: Die Schnellknöpfe ändern nur die Formel im Eingabefeld.
// Gezählt werden einfache Würfel (ohne kh/kl, positives Vorzeichen); alles andere bleibt stehen.
import { type DiceTerm, formatDice, parseDice } from "@mistwarden/protocol";

type Die = Extract<DiceTerm, { type: "dice" }>;

function plain(term: DiceTerm, sides: number): term is Die {
	return (
		term.type === "dice" &&
		term.sides === sides &&
		!term.keep &&
		term.sign === 1
	);
}

/** Wie viele einfache Würfel mit `sides` Seiten die Formel enthält. */
export function dieCount(formula: string, sides: number): number {
	const parsed = parseDice(formula);
	if (!parsed.ok) return 0;
	return parsed.terms.find((t) => plain(t, sides))?.count ?? 0;
}

/** Legt einen Würfel dazu oder nimmt einen weg. Eine unlesbare Formel wird ersetzt. */
export function changeDie(
	formula: string,
	sides: number,
	delta: 1 | -1,
): string {
	const parsed = parseDice(formula);
	const terms: DiceTerm[] = parsed.ok ? [...parsed.terms] : [];
	const i = terms.findIndex((t) => plain(t, sides));
	if (i >= 0) {
		const term = terms[i] as Die;
		if (term.count + delta <= 0) terms.splice(i, 1);
		else terms[i] = { ...term, count: term.count + delta };
	} else if (delta > 0) {
		// Neue Würfel vor den festen Zahlen einreihen: 6d8+3 wird 6d8+1d6+3.
		const firstConst = terms.findIndex((t) => t.type === "const");
		terms.splice(firstConst < 0 ? terms.length : firstConst, 0, {
			type: "dice",
			sign: 1,
			count: 1,
			sides,
			keep: null,
		});
	}
	return terms.length ? formatDice(terms) : "";
}
