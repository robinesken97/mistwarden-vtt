import { randomUUID } from "node:crypto";
import type { Action, Audience, Entity } from "@mistwarden/protocol";
import type { RawClient } from "./helpers.ts";

export function act(client: RawClient, action: Action) {
	client.send({ type: "action", actionId: randomUUID(), action });
	return client.nextOf(["ack", "reject"]);
}

/** Objekte aus dem Anfangszustand eines Clients. */
export function snapshotEntities(client: RawClient): Entity[] {
	const snap = client.received.find((m) => m.type === "snapshot");
	return snap?.type === "snapshot" ? snap.entities : [];
}

/** Legt eine Szene mit gegebener Sichtbarkeit an (als GM) und liefert ihre ID. */
export async function createScene(
	gm: RawClient,
	audience: Audience,
): Promise<string> {
	const id = randomUUID();
	const res = await act(gm, {
		op: "create",
		kind: "scene",
		id,
		data: { name: "Nebenraum", order: 1 },
		audience,
	});
	if (res.type !== "ack") throw new Error("Szene nicht angelegt");
	return id;
}
