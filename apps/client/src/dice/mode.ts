// Einstellung der Würfelanimation pro Gerät.
export const DICE_MODES = ["3d", "simple", "off"] as const;
export type DiceMode = (typeof DICE_MODES)[number];

/** Unbekannte oder fehlende Werte heißen: 3D. */
export function parseDiceMode(value: string | null): DiceMode {
	return DICE_MODES.includes(value as DiceMode) ? (value as DiceMode) : "3d";
}
