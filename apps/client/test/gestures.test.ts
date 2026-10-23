import { describe, expect, it } from "vitest";
import {
	GestureRecognizer,
	LONG_PRESS_MS,
	type PointerInput,
	type Scheduler,
} from "../src/input/gestures.ts";

/** Künstliche Uhr: Timer laufen nur, wenn der Test die Zeit vorstellt. */
function fakeClock() {
	let now = 0;
	const timers: { at: number; fn: () => void; active: boolean }[] = [];
	const schedule: Scheduler = (fn, ms) => {
		const t = { at: now + ms, fn, active: true };
		timers.push(t);
		return () => {
			t.active = false;
		};
	};
	return {
		schedule,
		advance(ms: number) {
			now += ms;
			for (const t of timers) {
				if (t.active && t.at <= now) {
					t.active = false;
					t.fn();
				}
			}
		},
	};
}

function setup() {
	const clock = fakeClock();
	const log: string[] = [];
	const g = new GestureRecognizer(
		{
			tap: (x, y) => log.push(`tap ${x},${y}`),
			dragStart: (x, y) => log.push(`dragStart ${x},${y}`),
			dragMove: (x, y) => log.push(`dragMove ${x},${y}`),
			dragEnd: (x, y, alt) => log.push(`dragEnd ${x},${y}${alt ? " alt" : ""}`),
			dragCancel: () => log.push("dragCancel"),
			context: (x, y) => log.push(`context ${x},${y}`),
			pinch: (_mx, _my, f) => log.push(`pinch ${f.toFixed(2)}`),
		},
		clock.schedule,
	);
	return { g, clock, log };
}

const touch = (id: number, x: number, y: number): PointerInput => ({
	id,
	x,
	y,
	button: 0,
	kind: "touch",
	altKey: false,
});

describe("Gestenerkennung", () => {
	it("kurzes Tippen ohne Bewegung ist ein Tap", () => {
		const { g, log } = setup();
		g.down(touch(1, 10, 10));
		g.move(touch(1, 12, 11)); // kleines Zittern
		g.up(touch(1, 12, 11));
		expect(log).toEqual(["tap 10,10"]);
	});

	it("Bewegung über der Schwelle wird zum Ziehen ab dem Aufsetzpunkt", () => {
		const { g, log } = setup();
		g.down(touch(1, 10, 10));
		g.move(touch(1, 30, 10));
		g.move(touch(1, 50, 20));
		g.up(touch(1, 50, 20));
		expect(log).toEqual([
			"dragStart 10,10",
			"dragMove 30,10",
			"dragMove 50,20",
			"dragEnd 50,20",
		]);
	});

	it("still halten löst langes Drücken aus, danach kein Tap", () => {
		const { g, clock, log } = setup();
		g.down(touch(1, 40, 40));
		clock.advance(LONG_PRESS_MS);
		g.up(touch(1, 40, 40));
		expect(log).toEqual(["context 40,40"]);
	});

	it("kein langes Drücken, wenn vorher gezogen wurde", () => {
		const { g, clock, log } = setup();
		g.down(touch(1, 0, 0));
		g.move(touch(1, 20, 0));
		clock.advance(LONG_PRESS_MS * 2);
		g.up(touch(1, 20, 0));
		expect(log).not.toContain("context 0,0");
	});

	it("ein zweiter Finger bricht das Ziehen ab und zoomt", () => {
		const { g, log } = setup();
		g.down(touch(1, 100, 100));
		g.move(touch(1, 120, 100));
		g.down(touch(2, 200, 100));
		g.move(touch(2, 240, 100)); // Abstand 120 → 120 + 40 = 160 … Faktor
		g.up(touch(2, 240, 100));
		g.move(touch(1, 300, 300)); // nach dem Pinch: kein neues Ziehen
		g.up(touch(1, 300, 300));
		expect(log).toEqual([
			"dragStart 100,100",
			"dragMove 120,100",
			"dragCancel",
			"pinch 1.50",
		]);
	});

	it("Rechtsklick ist sofort ein Kontextmenü, Alt beim Loslassen wird gemeldet", () => {
		const { g, log } = setup();
		g.down({ id: 1, x: 5, y: 5, button: 2, kind: "mouse", altKey: false });
		const mouse = (x: number, alt = false): PointerInput => ({
			id: 2,
			x,
			y: 0,
			button: 0,
			kind: "mouse",
			altKey: alt,
		});
		g.down(mouse(0));
		g.move(mouse(30));
		g.up(mouse(30, true));
		expect(log).toEqual([
			"context 5,5",
			"dragStart 0,0",
			"dragMove 30,0",
			"dragEnd 30,0 alt",
		]);
	});

	it("abgebrochene Zeiger (pointercancel) beenden das Ziehen sauber", () => {
		const { g, log } = setup();
		g.down(touch(1, 0, 0));
		g.move(touch(1, 50, 0));
		g.cancel(touch(1, 50, 0));
		g.down(touch(3, 0, 0));
		g.up(touch(3, 0, 0));
		expect(log).toEqual([
			"dragStart 0,0",
			"dragMove 50,0",
			"dragCancel",
			"tap 0,0",
		]);
	});
});
