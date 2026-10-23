import type { GridData } from "@mistwarden/protocol";
import { GlProgram, Mesh, MeshGeometry, Shader, UniformGroup } from "pixi.js";
import type { Rect } from "./tiles.ts";

// Grid als Shader: Die Linien werden pro Bildschirmpixel aus den Weltkoordinaten
// berechnet. Kosten unabhängig von Kartengröße und Zoom, Linien bleiben scharf.

// "#version 300 es" am Anfang: PixiJS kompiliert sonst als GLSL ES 1.0 (ohne fwidth).
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

uniform float uSize;
uniform vec2 uOffset;
uniform float uType;      // 0 Quadrat, 1 Hex spitz oben, 2 Hex flach oben
uniform vec4 uLineColor;  // nicht vormultipliziert (uColor ist bei Meshes von PixiJS belegt)
uniform float uLineWidth; // in Gerätepixeln

// Abstand zur nächsten Hexkante in Zellbreiten (Hex mit Spitze oben, Breite 1).
float hexEdge(vec2 p) {
	vec2 r = vec2(1.0, 1.7320508);
	vec2 h = r * 0.5;
	vec2 a = mod(p, r) - h;
	vec2 b = mod(p - h, r) - h;
	vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
	return 0.5 - max(dot(g, normalize(r)), g.x);
}

void main() {
	vec2 p = (vWorld - uOffset) / uSize;
	float px;
	if (uType < 0.5) {
		vec2 f = fract(p);
		vec2 e = min(f, 1.0 - f) / max(fwidth(p), vec2(1e-6));
		px = min(e.x, e.y);
	} else {
		vec2 q = uType < 1.5 ? p : p.yx;
		float e = hexEdge(q);
		px = e / max(length(fwidth(q)) * 0.7071, 1e-6);
	}
	float halfWidth = uLineWidth * 0.5;
	float alpha = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, px);
	float a = uLineColor.a * alpha;
	finalColor = vec4(uLineColor.rgb * a, a);
}
`;

const TYPES: Record<GridData["type"], number> = {
	square: 0,
	hexPointy: 1,
	hexFlat: 2,
};

export class GridLayer {
	readonly mesh: Mesh<MeshGeometry, Shader>;
	readonly #geometry: MeshGeometry;
	readonly #uniforms: UniformGroup;

	constructor() {
		this.#geometry = new MeshGeometry({
			positions: new Float32Array(8),
			uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
			indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		});
		this.#uniforms = new UniformGroup({
			uSize: { value: 100, type: "f32" },
			uOffset: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
			uType: { value: 0, type: "f32" },
			uLineColor: {
				value: new Float32Array([0, 0, 0, 0.5]),
				type: "vec4<f32>",
			},
			uLineWidth: { value: 1, type: "f32" },
		});
		const shader = new Shader({
			glProgram: GlProgram.from({ vertex, fragment, name: "mistwarden-grid" }),
			resources: { gridUniforms: this.#uniforms },
		});
		this.mesh = new Mesh({ geometry: this.#geometry, shader });
		this.mesh.label = "grid";
	}

	/** Grid-Einstellungen, Fläche in Weltkoordinaten und Linienbreite in Gerätepixeln. */
	update(grid: GridData | null, area: Rect, lineWidthPx: number): void {
		this.mesh.visible = grid?.visible === true;
		if (!grid?.visible) return;
		const u = this.#uniforms.uniforms;
		u.uSize = grid.size;
		(u.uOffset as Float32Array).set([grid.offsetX, grid.offsetY]);
		u.uType = TYPES[grid.type];
		u.uLineWidth = lineWidthPx;
		this.#uniforms.update();
		const { x, y, width, height } = area;
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

	destroy(): void {
		this.mesh.destroy();
	}
}
