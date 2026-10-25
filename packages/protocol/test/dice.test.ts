import { describe, expect, it } from "vitest";
import { MAX_DICE, parseDice, rollDice } from "../src/dice.ts";

/** Fester „Zufall“: liefert die Werte der Reihe nach. */
function fixed(...values: number[]) {
	let i = 0;
	return () => values[i++] ?? 1;
}

function roll(formula: string, ...values: number[]) {
	const parsed = parseDice(formula);
	if (!parsed.ok) throw new Error(parsed.error);
	return rollDice(parsed.terms, fixed(...values));
}

describe("Würfelformeln parsen", () => {
	it("versteht Würfel, Zahlen und Vorzeichen", () => {
		expect(parseDice("1d20+5")).toEqual({
			ok: true,
			formula: "1d20+5",
			terms: [
				{ type: "dice", sign: 1, count: 1, sides: 20, keep: null },
				{ type: "const", sign: 1, value: 5 },
			],
		});
		expect(parseDice(" 2D20 kl1 + d4 - 1 ")).toMatchObject({
			ok: true,
			formula: "2d20kl1+1d4-1",
		});
		expect(parseDice("-3+1d6")).toMatchObject({ ok: true, formula: "-3+1d6" });
	});

	it("normiert kh ohne Zahl und d%", () => {
		expect(parseDice("2d20kh")).toMatchObject({ formula: "2d20kh1" });
		expect(parseDice("d%")).toMatchObject({ formula: "1d100" });
	});

	it.each([
		"",
		"   ",
		"abc",
		"1d20+",
		"1d20++5",
		"--5",
		"1d1",
		"0d6",
		"1d1001",
		"4d6kh5",
		"4d6kh0",
		"1d20*2",
		"1d20 Angriff",
		"200000",
		`${MAX_DICE + 1}d6`,
		"60d6+60d6",
		"x".repeat(101),
		Array.from({ length: 21 }, () => "1").join("+"),
	])("lehnt %j ab", (formula) => {
		expect(parseDice(formula).ok).toBe(false);
	});
});

describe("Würfeln", () => {
	it("summiert Würfel und Zahlen", () => {
		expect(roll("1d20+5", 13).total).toBe(18);
		expect(roll("2d6-1d4-2", 6, 5, 3).total).toBe(6);
	});

	it("behält die höchsten bzw. niedrigsten", () => {
		const high = roll("4d6kh3", 2, 6, 1, 5);
		expect(high.total).toBe(13);
		expect(high.terms[0]).toMatchObject({
			results: [2, 6, 1, 5],
			kept: [true, true, false, true],
		});
		expect(roll("2d20kl1", 17, 4).total).toBe(4);
	});

	it("verwirft bei Gleichstand den späteren Würfel", () => {
		expect(roll("3d6kh2", 4, 4, 4).terms[0]).toMatchObject({
			kept: [true, true, false],
		});
	});

	it("ruft den Zufall mit der Seitenzahl auf", () => {
		const sides: number[] = [];
		const parsed = parseDice("2d8+1d12");
		if (!parsed.ok) throw new Error();
		rollDice(parsed.terms, (s) => {
			sides.push(s);
			return 1;
		});
		expect(sides).toEqual([8, 8, 12]);
	});
});
