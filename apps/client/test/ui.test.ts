import { describe, expect, it } from "vitest";
import { createPanels } from "../src/ui.ts";

describe("Panels", () => {
	it("zeigt immer nur eines", () => {
		let changes = 0;
		const panels = createPanels(() => changes++);
		const menu = panels.add({ hidden: false });
		const log = panels.add({ hidden: false });
		expect([menu.hidden, log.hidden]).toEqual([true, true]);

		panels.toggle(menu);
		expect([menu.hidden, log.hidden]).toEqual([false, true]);
		panels.toggle(log);
		expect([menu.hidden, log.hidden]).toEqual([true, false]);
		panels.toggle(log);
		expect([menu.hidden, log.hidden]).toEqual([true, true]);
		panels.toggle(menu);
		panels.close();
		expect([menu.hidden, log.hidden]).toEqual([true, true]);
		expect(changes).toBe(5);
	});
});
