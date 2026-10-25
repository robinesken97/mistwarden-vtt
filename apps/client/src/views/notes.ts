// Notizen auf der Karte: die GM setzt, verschiebt, bearbeitet und gibt sie frei;
// alle können freigegebene Notizen antippen und lesen.
import type { Action, Entity, NoteData } from "@mistwarden/protocol";
import { button, h } from "../dom.ts";
import type { SyncConnection } from "../net/connection.ts";
import type { StageNote, WorldPoint } from "../render/stage.ts";
import type { Card } from "./card.ts";

export interface NoteToolsContext {
	conn: SyncConnection;
	isGm: boolean;
	run(action: Action): Promise<number | undefined>;
	displayedScene(): Entity | undefined;
	viewCenter(): WorldPoint | null;
	card: Card;
	changed(): void;
}

export function createNoteTools(ctx: NoteToolsContext) {
	let selectedId: string | null = null;

	function sceneNotes(): Entity[] {
		const scene = ctx.displayedScene();
		if (!scene) return [];
		return [...ctx.conn.entities.values()]
			.filter(
				(e) => e.kind === "note" && (e.data as NoteData).sceneId === scene.id,
			)
			.sort((a, b) => a.version - b.version);
	}

	function stageNotes(): StageNote[] {
		return sceneNotes().map((e) => {
			const n = e.data as NoteData;
			return {
				id: e.id,
				x: n.x,
				y: n.y,
				hidden: n.hidden,
				selected: e.id === selectedId,
				draggable: ctx.isGm,
			};
		});
	}

	function byId(id: string): Entity | undefined {
		return ctx.conn.entities.get(`note:${id}`);
	}

	function select(id: string | null): void {
		selectedId = id && byId(id) ? id : null;
		if (selectedId) open(selectedId);
		else if (ctx.card.owner()?.startsWith("note:")) ctx.card.hide();
		ctx.changed();
	}

	function open(id: string): void {
		const e = byId(id);
		if (!e) return;
		const n = e.data as NoteData;
		if (!ctx.isGm) {
			ctx.card.show(
				`note:${id}`,
				h("h2", {}, n.title || "Notiz"),
				h("p", { className: "card-text" }, n.text),
			);
			return;
		}
		const title = h("input", {
			type: "text",
			value: n.title,
			maxLength: 60,
			placeholder: "Titel",
		});
		const text = h("textarea", {
			value: n.text,
			maxLength: 4000,
			rows: 6,
			placeholder: "Text der Notiz",
		});
		const visible = h("input", { type: "checkbox", checked: !n.hidden });
		ctx.card.show(
			`note:${id}`,
			h("h2", {}, "Notiz"),
			title,
			text,
			h("label", {}, visible, " Für Spieler sichtbar"),
			h(
				"div",
				{ className: "row" },
				button("Speichern", () => {
					ctx.run({
						op: "update",
						kind: "note",
						id,
						patch: {
							title: title.value.trim().slice(0, 60),
							text: text.value.slice(0, 4000),
							hidden: !visible.checked,
						},
					});
					select(null);
				}),
				button(
					"Löschen",
					() => {
						if (!confirm("Notiz löschen?")) return;
						ctx.run({ op: "delete", kind: "note", id });
						select(null);
					},
					"secondary",
				),
			),
		);
		title.focus();
	}

	async function create(): Promise<void> {
		const scene = ctx.displayedScene();
		const at = ctx.viewCenter();
		if (!scene || !at) return;
		const id = crypto.randomUUID();
		const ok = await ctx.run({
			op: "create",
			kind: "note",
			id,
			data: {
				sceneId: scene.id,
				x: Math.round(at.x),
				y: Math.round(at.y),
				title: "",
				text: "",
				hidden: true,
			},
		});
		if (ok !== undefined) select(id);
	}

	function moveNote(id: string, world: WorldPoint): void {
		if (!ctx.isGm) return;
		ctx.run({
			op: "update",
			kind: "note",
			id,
			patch: { x: Math.round(world.x), y: Math.round(world.y) },
		});
	}

	const gmSection = h(
		"div",
		{},
		h("h2", {}, "Notizen"),
		h(
			"p",
			{ className: "hint" },
			"Neue Notizen liegen in der Bildmitte und sind zunächst nur für dich sichtbar. Antippen öffnet, Ziehen verschiebt.",
		),
		button("Notiz setzen", () => void create()),
	);

	function render(): void {
		// Gelöschte oder verborgene Notiz: Karte schließen.
		if (selectedId && !byId(selectedId)) select(null);
	}

	return { stageNotes, select, moveNote, gmSection, render };
}
