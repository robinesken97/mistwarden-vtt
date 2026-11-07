import { describe, expect, it } from "vitest";
import { TRACKPAD_STICKY_MS, wheelAction } from "../src/render/camera.ts";

const LONG_AGO = Number.POSITIVE_INFINITY;
const wheel = (deltaY: number, deltaX = 0, deltaMode = 0, ctrlKey = false) => ({
	deltaX,
	deltaY,
	deltaMode,
	ctrlKey,
});

describe("wheelAction", () => {
	it("Pinch (Rad mit ctrlKey) zoomt", () => {
		expect(wheelAction(wheel(3.5, 0, 0, true), LONG_AGO)).toBe("zoom");
		expect(wheelAction(wheel(3.5, 0, 0, true), 10)).toBe("zoom");
	});

	it("Zwei-Finger-Scrollen verschiebt", () => {
		expect(wheelAction(wheel(2), LONG_AGO)).toBe("pan");
		expect(wheelAction(wheel(0.5, 1.5), LONG_AGO)).toBe("pan");
		expect(wheelAction(wheel(0, -7), LONG_AGO)).toBe("pan");
	});

	it("Schwung nach dem Trackpad bleibt Verschieben, auch bei großen Deltas", () => {
		expect(wheelAction(wheel(120), 16)).toBe("pan");
		expect(wheelAction(wheel(120), TRACKPAD_STICKY_MS)).toBe("zoom");
	});

	it("Mausrad am Mac (Safari/Chrome) zoomt, auch direkt nach dem Trackpad", () => {
		expect(wheelAction(wheel(4.000244140625), LONG_AGO)).toBe("zoom");
		expect(wheelAction(wheel(-40.00244140625), 10)).toBe("zoom");
	});

	it("Mausrad in Zeilen/Seiten (Firefox) und grobe Schritte (Windows) zoomen", () => {
		expect(wheelAction(wheel(3, 0, 1), LONG_AGO)).toBe("zoom");
		expect(wheelAction(wheel(1, 0, 2), LONG_AGO)).toBe("zoom");
		expect(wheelAction(wheel(100), LONG_AGO)).toBe("zoom");
		expect(wheelAction(wheel(-120), LONG_AGO)).toBe("zoom");
	});
});
