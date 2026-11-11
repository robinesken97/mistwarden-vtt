// Würfelkörper als Flächenlisten, ohne Abhängigkeiten: d4 bis d20. Jede Fläche kennt ihren
// Mittelpunkt, ihre Normale und ein eigenes 2D-Achsenkreuz für die Beschriftung.
// Gemeinsame Grundlage für die 3D-Darstellung (three.js) und den CSS-Rückfall.

export type Vec = [number, number, number];
export type DieKind = 4 | 6 | 8 | 10 | 12 | 20;

export interface Face {
	/** Ecken in Umlaufrichtung. */
	pts: Vec[];
	c: Vec;
	n: Vec;
	/** Achsen in der Flächenebene; `v` zeigt für die Zahl nach oben. */
	u: Vec;
	v: Vec;
	/** Ecken im Achsenkreuz der Fläche. */
	loc: [number, number][];
	/** Abstand der fernsten Ecke vom Mittelpunkt. */
	R: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;

export const sub = (a: Vec, b: Vec): Vec => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];
export const add = (a: Vec, b: Vec): Vec => [
	a[0] + b[0],
	a[1] + b[1],
	a[2] + b[2],
];
export const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec, b: Vec): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec): Vec => mul(a, 1 / len(a));

/** Dreht `v` um die Einheitsachse `k` um den Winkel `a` (Rodrigues). */
export function rot(v: Vec, k: Vec, a: number): Vec {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const d = dot(k, v) * (1 - c);
	const x = cross(k, v);
	return [
		v[0] * c + x[0] * s + k[0] * d,
		v[1] * c + x[1] * s + k[1] * d,
		v[2] * c + x[2] * s + k[2] * d,
	];
}

/** Drehung (Achse, Winkel), die den Einheitsvektor `n` auf +z legt. */
export function toZ(n: Vec): { axis: Vec; ang: number } {
	const z: Vec = [0, 0, 1];
	const ax = cross(n, z);
	const s = len(ax);
	return {
		axis: s < 1e-6 ? [1, 0, 0] : mul(ax, 1 / s),
		ang: Math.acos(Math.max(-1, Math.min(1, dot(n, z)))),
	};
}

const SIGNS = [-1, 1];

/** Ecken, die am weitesten in Richtung `n` liegen: eine Fläche eines konvexen Körpers. */
function faceTowards(verts: Vec[], n: Vec): Vec[] {
	const far = Math.max(...verts.map((p) => dot(p, n)));
	return verts.filter((p) => dot(p, n) > far - 1e-6);
}

/** Eckenlisten der Flächen; Fläche i trägt die Zahl i + 1 (beim d10: i). */
function faceSets(kind: DieKind): Vec[][] {
	if (kind === 4) {
		const verts: Vec[] = [
			[1, 1, 1],
			[1, -1, -1],
			[-1, 1, -1],
			[-1, -1, 1],
		];
		return verts.map((p) => faceTowards(verts, mul(p, -1)));
	}
	if (kind === 6) {
		const verts = SIGNS.flatMap((x) =>
			SIGNS.flatMap((y) => SIGNS.map((z): Vec => [x, y, z])),
		);
		const normals: Vec[] = [
			[0, 0, 1],
			[1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			[-1, 0, 0],
			[0, 0, -1],
		];
		return normals.map((n) => faceTowards(verts, n));
	}
	if (kind === 8) {
		const verts: Vec[] = [
			[1, 0, 0],
			[-1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			[0, 0, 1],
			[0, 0, -1],
		];
		return SIGNS.flatMap((x) =>
			SIGNS.flatMap((y) => SIGNS.map((z) => faceTowards(verts, [x, y, z]))),
		);
	}
	if (kind === 10) {
		// Fünfeckiges Trapezoeder: zwei Spitzen, dazwischen ein Zickzack-Ring aus zehn Ecken.
		// Mit dieser Ringhöhe liegen die vier Ecken jedes Drachenvierecks in einer Ebene.
		const cos36 = Math.cos(Math.PI / 5);
		const h = (1 - cos36) / (1 + cos36);
		const ring = Array.from({ length: 10 }, (_, k): Vec => {
			const a = (k * Math.PI) / 5;
			return [Math.cos(a), Math.sin(a), k % 2 === 0 ? h : -h];
		});
		const at = (k: number) => ring[(k + 10) % 10] as Vec;
		return Array.from({ length: 10 }, (_, i): Vec[] => {
			// Ungerade Flächen oben (um eine tiefe Ringecke), gerade unten (um eine hohe).
			const top = i % 2 === 1;
			const apex: Vec = [0, 0, top ? 1 : -1];
			return [apex, at(i - 1), at(i), at(i + 1)];
		});
	}
	if (kind === 12) {
		const verts: Vec[] = [
			...SIGNS.flatMap((x) =>
				SIGNS.flatMap((y) => SIGNS.map((z): Vec => [x, y, z])),
			),
			...SIGNS.flatMap((a) =>
				SIGNS.flatMap((b): Vec[] => [
					[0, a / PHI, b * PHI],
					[a / PHI, b * PHI, 0],
					[b * PHI, 0, a / PHI],
				]),
			),
		];
		// Die Flächen stehen senkrecht auf den Ecken eines Ikosaeders: (0, ±φ, ±1) und Umläufe.
		const normals = SIGNS.flatMap((a) =>
			SIGNS.flatMap((b): Vec[] => [
				[0, a * PHI, b],
				[b, 0, a * PHI],
				[a * PHI, b, 0],
			]),
		);
		return normals.map((n) => faceTowards(verts, n));
	}
	const verts = SIGNS.flatMap((a) =>
		SIGNS.flatMap((b): Vec[] => [
			[0, a, b * PHI],
			[a, b * PHI, 0],
			[b * PHI, 0, a],
		]),
	);
	const near = (p: Vec, q: Vec) => Math.abs(len(sub(p, q)) - 2) < 1e-6;
	const sets: Vec[][] = [];
	for (let i = 0; i < 12; i++)
		for (let j = i + 1; j < 12; j++)
			for (let k = j + 1; k < 12; k++) {
				const [a, b, c] = [verts[i] as Vec, verts[j] as Vec, verts[k] as Vec];
				if (near(a, b) && near(b, c) && near(a, c)) sets.push([a, b, c]);
			}
	return sets;
}

/** Flächen eines Würfels; `scale` ist der halbe Durchmesser in Pixeln. */
export function dieFaces(kind: DieKind, scale: number): Face[] {
	const sets = faceSets(kind);
	// Alle Körper auf denselben Umkugelradius bringen, damit sie gleich groß wirken.
	const radius = Math.max(...sets.flat().map(len));
	return sets.map((set): Face => {
		const pts = set.map((p) => mul(p, scale / radius));
		const c = mul(pts.reduce(add, [0, 0, 0] as Vec), 1 / pts.length);
		// Normale aus den Ecken (beim d10 zeigt der Mittelpunkt nicht genau entlang der Normale).
		let n = norm(
			cross(
				sub(pts[1] as Vec, pts[0] as Vec),
				sub(pts[2] as Vec, pts[0] as Vec),
			),
		);
		if (dot(n, c) < 0) n = mul(n, -1);
		const u0 = norm(sub(pts[0] as Vec, c));
		const v0 = cross(n, u0);
		const ang = (p: Vec) => {
			const d = sub(p, c);
			return Math.atan2(dot(d, v0), dot(d, u0));
		};
		pts.sort((a, b) => ang(a) - ang(b));
		// Zahl aufrecht: bei Drei- und Drachenvierecken zeigt „oben“ zur ersten Ecke
		// (beim d10 die Spitze), sonst zur Mitte der ersten Kante.
		let u: Vec;
		let v: Vec;
		if (pts.length === 3 || kind === 10) {
			const apex = kind === 10 ? (set[0] as Vec) : (pts[0] as Vec);
			const top = kind === 10 ? mul(apex, scale / radius) : apex;
			v = norm(sub(top, c));
			// Senkrecht zur Normale halten, falls die Ecke nicht exakt in der Ebene liegt.
			v = norm(sub(v, mul(n, dot(v, n))));
			u = cross(v, n);
		} else {
			u = norm(sub(mul(add(pts[0] as Vec, pts[1] as Vec), 0.5), c));
			v = cross(n, u);
		}
		const loc = pts.map((p): [number, number] => {
			const d = sub(p, c);
			return [dot(d, u), dot(d, v)];
		});
		const R = Math.max(...loc.map((l) => Math.hypot(l[0], l[1])));
		return { pts, c, n, u, v, loc, R };
	});
}

/**
 * Endlage: Fläche `face` zeigt nach +z (zum Betrachter), die Zahl steht aufrecht.
 * Zuerst um `axis`/`ang` drehen, danach um z um `gz`.
 */
export function restPose(face: Face): { axis: Vec; ang: number; gz: number } {
	const f = toZ(face.n);
	const v1 = rot(face.v, f.axis, f.ang);
	return { ...f, gz: Math.PI / 2 - Math.atan2(v1[1], v1[0]) };
}
