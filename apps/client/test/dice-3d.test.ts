import type { RollTerm } from "@mistwarden/protocol";
import { describe, expect, it } from "vitest";
import {
	type DieKind,
	dieFaces,
	dot,
	len,
	restPose,
	rot,
	sub,
} from "../src/dice/geometry.ts";
import { MAX_ANIMATED_DICE, planRoll, poseAt } from "../src/dice/plan.ts";

const dice = (sides: number, results: number[]): RollTerm => ({
	type: "dice",
	sign: 1,
	count: results.length,
	sides,
	keep: null,
	results,
	kept: results.map(() => true),
});

describe("Würfelkörper", () => {
	const kinds: DieKind[] = [4, 6, 8, 10, 12, 20];

	it("haben so viele Flächen wie Seiten", () => {
		expect(kinds.map((k) => dieFaces(k, 30).length)).toEqual(kinds);
	});

	it("haben ebene Flächen mit Einheitsnormale nach außen", () => {
		for (const kind of kinds) {
			for (const f of dieFaces(kind, 30)) {
				expect(len(f.n)).toBeCloseTo(1, 6);
				expect(dot(f.n, f.c)).toBeGreaterThan(0);
				for (const p of f.pts) expect(dot(sub(p, f.c), f.n)).toBeCloseTo(0, 6);
			}
		}
	});

	it("legen in der Endlage die Ergebnisfläche nach oben, Zahl aufrecht", () => {
		for (const kind of kinds) {
			for (const f of dieFaces(kind, 30)) {
				const pose = restPose(f);
				const turn = (v: [number, number, number]) =>
					rot(rot(v, pose.axis, pose.ang), [0, 0, 1], pose.gz);
				const n = turn(f.n);
				expect(n[2]).toBeCloseTo(1, 6);
				const up = turn(f.v);
				expect(up[0]).toBeCloseTo(0, 6);
				expect(up[1]).toBeCloseTo(1, 6);
			}
		}
	});
});

describe("Wurfplan", () => {
	it("endet auf dem Serverergebnis", () => {
		const plan = planRoll([dice(20, [17]), dice(6, [3, 6])], "wurf-1");
		expect(plan?.map((d) => [d.kind, d.labels[d.face]])).toEqual([
			[20, "17"],
			[6, "3"],
			[6, "6"],
		]);
	});

	it("zeigt den d100 als Zehner- und Einerwürfel", () => {
		const show = (r: number) =>
			planRoll([dice(100, [r])], "x")?.map((d) => d.labels[d.face]);
		expect(show(73)).toEqual(["70", "3"]);
		expect(show(100)).toEqual(["00", "0"]);
		expect(show(5)).toEqual(["00", "5"]);
	});

	it("ist für denselben Wurf auf jedem Gerät gleich", () => {
		const terms = [dice(8, [2, 5, 8])];
		expect(planRoll(terms, "abc")).toEqual(planRoll(terms, "abc"));
		expect(planRoll(terms, "abc")).not.toEqual(planRoll(terms, "abd"));
	});

	it("animiert nichts ohne passende Würfel oder über der Grenze", () => {
		expect(planRoll([{ type: "const", sign: 1, value: 4 }], "x")).toBeNull();
		expect(planRoll([dice(7, [3])], "x")).toBeNull();
		const many = Array.from({ length: MAX_ANIMATED_DICE + 1 }, () => 1);
		expect(planRoll([dice(6, many)], "x")).toBeNull();
		expect(planRoll([dice(6, many.slice(1))], "x")).toHaveLength(
			MAX_ANIMATED_DICE,
		);
		// Ein d100 zählt als zwei Würfel.
		expect(planRoll([dice(100, many.slice(0, 11))], "x")).toBeNull();
	});

	it("liegt am Ende ruhig am Ziel", () => {
		const [die] = planRoll([dice(6, [4])], "x") ?? [];
		if (!die) throw new Error("kein Plan");
		const end = poseAt(die, 10_000);
		expect(end).toEqual({
			x: die.to.x,
			y: die.to.y,
			z: 0,
			angle: 0,
			done: true,
		});
		expect(poseAt(die, 0).done).toBe(false);
	});
});
