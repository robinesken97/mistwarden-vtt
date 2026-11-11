import { describe, expect, it } from "vitest";
import { changeDie, dieCount } from "../src/dice-pool.ts";

describe("Würfelvorrat", () => {
	it("legt Würfel dazu und zählt sie", () => {
		let formula = "";
		for (let i = 0; i < 6; i++) formula = changeDie(formula, 8, 1);
		expect(formula).toBe("6d8");
		expect(dieCount(formula, 8)).toBe(6);
		expect(dieCount(formula, 6)).toBe(0);
	});

	it("reiht neue Würfel vor dem Bonus ein", () => {
		expect(changeDie("6d8+3", 6, 1)).toBe("6d8+1d6+3");
		expect(changeDie("2d6+1d20", 20, 1)).toBe("2d6+2d20");
	});

	it("nimmt Würfel weg, bis keiner mehr da ist", () => {
		expect(changeDie("6d8+3", 8, -1)).toBe("5d8+3");
		expect(changeDie("1d8+3", 8, -1)).toBe("3");
		expect(changeDie("1d8", 8, -1)).toBe("");
		expect(changeDie("2d6", 8, -1)).toBe("2d6");
	});

	it("lässt Würfe mit Behalten-Regel unangetastet", () => {
		expect(changeDie("4d6kh3", 6, 1)).toBe("4d6kh3+1d6");
		expect(dieCount("4d6kh3", 6)).toBe(0);
	});

	it("ersetzt eine unlesbare Formel", () => {
		expect(changeDie("abc", 20, 1)).toBe("1d20");
		expect(changeDie("abc", 20, -1)).toBe("");
	});
});
