// Rückgängig/Wiederholen für eigene Änderungen an Tokens, Fog, Zeichnungen und Notizen.
// Jeder Schritt merkt sich die Gegenaktion und die Version, die das Objekt danach hatte.
// Hat inzwischen jemand anderes das Objekt geändert, wird der Schritt nicht ausgeführt,
// statt fremde Änderungen zu überschreiben. Der Server prüft die Rechte wie immer.
import {
	type Action,
	type Entity,
	type EntityKind,
	entityKey,
	isSceneChild,
} from "@mistwarden/protocol";

/** Objektarten mit Rückgängig (SPEC: mindestens Token-Bewegung, Fog und Zeichnungen). */
export const UNDOABLE_KINDS: readonly EntityKind[] = [
	"token",
	"fog",
	"drawing",
	"note",
];

/** So viele Schritte bleiben im Verlauf. */
export const MAX_HISTORY = 50;

interface Step {
	forward: Action;
	inverse: Action;
	key: string;
	/** Version des Objekts nach dem letzten Ausführen; null = danach gelöscht. */
	version: number | null;
}

export interface HistoryDeps {
	/** Aktueller Stand eines Objekts (gespiegelter Raumzustand). */
	get(key: string): Entity | undefined;
	/** Sendet eine Aktion; löst mit der Raumversion nach der Änderung auf. */
	send(action: Action): Promise<number>;
}

export type UndoResult = "done" | "empty" | "stale" | "failed";

export class History {
	readonly #deps: HistoryDeps;
	#undo: Step[] = [];
	#redo: Step[] = [];
	#busy = false;

	constructor(deps: HistoryDeps) {
		this.#deps = deps;
	}

	get canUndo(): boolean {
		return this.#undo.length > 0;
	}

	get canRedo(): boolean {
		return this.#redo.length > 0;
	}

	/**
	 * Sendet eine Aktion und merkt sie sich, wenn sie rückgängig zu machen ist.
	 * Die Gegenaktion entsteht aus dem Stand vor dem Senden.
	 */
	async run(action: Action): Promise<number> {
		const inverse = UNDOABLE_KINDS.includes(action.kind)
			? inverseOf(action, this.#deps.get(entityKey(action.kind, action.id)))
			: null;
		const version = await this.#deps.send(action);
		if (inverse) {
			this.#undo.push({
				forward: action,
				inverse,
				key: entityKey(action.kind, action.id),
				version: action.op === "delete" ? null : version,
			});
			if (this.#undo.length > MAX_HISTORY) this.#undo.shift();
			this.#redo = [];
		}
		return version;
	}

	undo(): Promise<UndoResult> {
		return this.#replay(this.#undo, this.#redo, "inverse");
	}

	redo(): Promise<UndoResult> {
		return this.#replay(this.#redo, this.#undo, "forward");
	}

	clear(): void {
		this.#undo = [];
		this.#redo = [];
	}

	async #replay(
		from: Step[],
		to: Step[],
		direction: "inverse" | "forward",
	): Promise<UndoResult> {
		if (this.#busy) return "failed";
		const step = from.pop();
		if (!step) return "empty";
		const current = this.#deps.get(step.key);
		const unchanged =
			step.version === null
				? current === undefined
				: current?.version === step.version;
		if (!unchanged) {
			// Jemand anderes war schneller: Schritt verwerfen, Rest bleibt nutzbar.
			return "stale";
		}
		const action = step[direction];
		this.#busy = true;
		try {
			const sent = await this.#deps.send(action);
			const version = action.op === "delete" ? null : sent;
			to.push({ ...step, version });
			// Der nächste Schritt am selben Objekt findet jetzt genau den Stand vor, den er
			// erwartet – nur mit neuer Versionsnummer.
			for (let i = from.length - 1; i >= 0; i--) {
				const prev = from[i] as Step;
				if (prev.key === step.key) {
					prev.version = version;
					break;
				}
			}
			return "done";
		} catch {
			return "failed";
		} finally {
			this.#busy = false;
		}
	}
}

/** Gegenaktion zu `action` bei Stand `before`; null, wenn es keine gibt. */
export function inverseOf(
	action: Action,
	before: Entity | undefined,
): Action | null {
	switch (action.op) {
		case "create":
			return { op: "delete", kind: action.kind, id: action.id };
		case "update": {
			if (!before) return null;
			const patch: Record<string, unknown> = {};
			for (const key of Object.keys(action.patch ?? {})) {
				patch[key] = before.data[key];
			}
			return {
				op: "update",
				kind: action.kind,
				id: action.id,
				patch,
				...(action.audience && before.audience
					? { audience: before.audience }
					: {}),
			};
		}
		case "delete": {
			if (!before) return null;
			// Bei Szenen-Kindern leitet der Server die Sichtbarkeit selbst ab.
			return {
				op: "create",
				kind: action.kind,
				id: action.id,
				data: before.data,
				...(!isSceneChild(action.kind) && before.audience
					? { audience: before.audience }
					: {}),
			};
		}
	}
}
