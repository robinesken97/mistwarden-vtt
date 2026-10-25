import type { FogPolygon } from "@mistwarden/protocol";
import {
	Container,
	GlProgram,
	Graphics,
	Mesh,
	MeshGeometry,
	Shader,
	UniformGroup,
} from "pixi.js";
import type { Rect } from "./tiles.ts";

// Fog als Nebel: Die aktiven Fog-Formen bilden eine Maske (Stencil), darin zeichnet ein
// Shader eine Nebelstruktur in Weltkoordinaten. Für Spieler ist der Nebel vollständig
// deckend – er variiert in Farbe, nicht in Transparenz. Die GM sieht ihn halbtransparent.
// Überlappende Formen werden dabei nicht dunkler, weil die Maske ihre Vereinigung ist.

const vertex = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vWorld;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
	mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
	gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
	vWorld = aPosition;
}
`;

const fragment = /* glsl */ `#version 300 es
in vec2 vWorld;
out vec4 finalColor;

uniform float uTime;   // Sekunden
uniform float uAlpha;  // 1 = deckend (Spieler), < 1 für die GM
uniform float uScale;  // Weltpixel pro Rauschzelle

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * noise(p);
		p = p * 2.03 + vec2(17.0, 9.0);
		a *= 0.5;
	}
	return v;
}

void main() {
	// Koordinaten klein halten (Genauigkeit), Muster wiederholt sich erst nach 512 Zellen.
	vec2 p = mod(vWorld / uScale, 512.0);
	vec2 drift = vec2(uTime * 0.035, uTime * 0.013);
	float warp = fbm(p * 0.5 - drift);
	float n = fbm(p + drift + warp * 0.9);
	vec3 deep = vec3(0.07, 0.08, 0.10);
	vec3 veil = vec3(0.38, 0.41, 0.46);
	vec3 col = mix(deep, veil, smoothstep(0.30, 0.80, n));
	finalColor = vec4(col * uAlpha, uAlpha);
}
`;

export interface StageFog {
	id: string;
	/** Ändert sich bei jeder Änderung der Form (Entity-Version). */
	version: number;
	polygons: FogPolygon[];
	active: boolean;
	selected: boolean;
}

export class FogLayer {
	readonly container = new Container({ label: "fog" });
	readonly #mask = new Graphics();
	readonly #outlines = new Graphics();
	readonly #mist: Mesh<MeshGeometry, Shader>;
	readonly #geometry: MeshGeometry;
	readonly #uniforms: UniformGroup;
	#shapes: StageFog[] = [];
	#key = "";

	constructor() {
		this.#geometry = new MeshGeometry({
			positions: new Float32Array(8),
			uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
			indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		});
		this.#uniforms = new UniformGroup({
			uTime: { value: 0, type: "f32" },
			uAlpha: { value: 1, type: "f32" },
			uScale: { value: 400, type: "f32" },
		});
		const shader = new Shader({
			glProgram: GlProgram.from({
				vertex,
				fragment,
				name: "mistwarden-fog",
				preferredFragmentPrecision: "highp",
			}),
			resources: { fogUniforms: this.#uniforms },
		});
		this.#mist = new Mesh({ geometry: this.#geometry, shader });
		this.#mist.mask = this.#mask;
		this.container.addChild(this.#mask, this.#mist, this.#outlines);
	}

	/** Formen der angezeigten Szene; `gm` zeigt auch ausgeschaltete Formen als Umriss. */
	set(shapes: StageFog[], gm: boolean, lineWidth: number): void {
		this.#shapes = shapes;
		this.#uniforms.uniforms.uAlpha = gm ? 0.6 : 1;
		const key = JSON.stringify([
			gm,
			lineWidth,
			shapes.map((f) => [f.id, f.version, f.active, f.selected]),
		]);
		if (key === this.#key) return;
		this.#key = key;

		const mask = this.#mask.clear();
		for (const shape of shapes) {
			if (!shape.active) continue;
			for (const poly of shape.polygons) {
				mask.poly(poly.outer).fill({ color: 0xffffff });
				for (const hole of poly.holes) mask.poly(hole).cut();
			}
		}

		const lines = this.#outlines.clear();
		if (gm) {
			for (const shape of shapes) {
				const color = shape.selected
					? 0xffd23f
					: shape.active
						? 0x9aa4b2
						: 0x6b7380;
				const width = shape.selected ? lineWidth * 2 : lineWidth;
				for (const poly of shape.polygons) {
					lines
						.poly(poly.outer)
						.stroke({ width, color, alpha: shape.active ? 0.6 : 0.9 });
				}
			}
		}
		this.#mist.visible = shapes.some((s) => s.active);
	}

	/** Nebelfläche über den sichtbaren Bereich legen und Zeit setzen. */
	update(view: Rect, cell: number, seconds: number): void {
		const u = this.#uniforms.uniforms;
		u.uTime = seconds;
		u.uScale = Math.max(50, cell * 3);
		this.#uniforms.update();
		const { x, y, width, height } = view;
		this.#geometry.positions = new Float32Array([
			x,
			y,
			x + width,
			y,
			x + width,
			y + height,
			x,
			y + height,
		]);
	}

	get hasActive(): boolean {
		return this.#shapes.some((s) => s.active);
	}

	destroy(): void {
		this.container.destroy({ children: true });
	}
}
