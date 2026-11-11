// 3D-Darstellung der Würfel mit three.js: Körper mit Licht und Schatten auf einer eigenen
// durchsichtigen Zeichenfläche über der Karte. Wird erst beim ersten Wurf geladen.
import {
	AmbientLight,
	BufferGeometry,
	CanvasTexture,
	DirectionalLight,
	Float32BufferAttribute,
	Mesh,
	MeshStandardMaterial,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	Quaternion,
	Scene,
	ShadowMaterial,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer,
} from "three";
import { dieFaces, dot, type Face, restPose } from "./geometry.ts";
import { DIE_SCALE, type DiceView } from "./layer.ts";
import type { PlannedDie } from "./plan.ts";

/** Abstand der Kamera; damit entspricht eine Einheit in der Bodenebene einem CSS-Pixel. */
const CAMERA_Z = 800;
/** Kantenlänge einer Zahl in der Textur. */
const CELL = 128;

interface ThreeDie {
	mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
	rest: Quaternion;
	axis: Vector3;
	/** Abstand der Auflagefläche vom Mittelpunkt: so hoch liegt der Würfel über dem Boden. */
	inradius: number;
}

function buildMesh(
	plan: PlannedDie,
	color: string,
	textColor: string,
): ThreeDie {
	const faces = dieFaces(plan.kind, DIE_SCALE);
	const cols = Math.ceil(Math.sqrt(faces.length));
	const rows = Math.ceil(faces.length / cols);
	const canvas = document.createElement("canvas");
	canvas.width = cols * CELL;
	canvas.height = rows * CELL;
	const g = canvas.getContext("2d");
	if (!g) throw new Error("2d context unavailable");
	g.fillStyle = color;
	g.fillRect(0, 0, canvas.width, canvas.height);
	g.fillStyle = textColor;
	g.textAlign = "center";
	g.textBaseline = "middle";
	const pos: number[] = [];
	const uv: number[] = [];
	faces.forEach((f, i) => {
		const cx = ((i % cols) + 0.5) * CELL;
		const cy = (Math.floor(i / cols) + 0.5) * CELL;
		const k = (0.45 * CELL) / f.R;
		const label = plan.labels[i] ?? "";
		const size = Math.round(CELL * (label.length === 2 ? 0.3 : 0.4));
		g.font = `700 ${size}px system-ui, sans-serif`;
		g.fillText(label, cx, cy + size * 0.05);
		// 6 und 9 unterstreichen, damit sie auf dem Kopf nicht verwechselt werden.
		if (label === "6" || label === "9") {
			g.fillRect(cx - size * 0.28, cy + size * 0.5, size * 0.56, size * 0.08);
		}
		for (let j = 1; j < f.pts.length - 1; j++) {
			for (const q of [0, j, j + 1]) {
				const p = f.pts[q] as [number, number, number];
				const l = f.loc[q] as [number, number];
				pos.push(p[0], p[1], p[2]);
				uv.push(
					(cx + l[0] * k) / canvas.width,
					1 - (cy - l[1] * k) / canvas.height,
				);
			}
		}
	});
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
	geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
	geometry.computeVertexNormals();
	const map = new CanvasTexture(canvas);
	map.colorSpace = SRGBColorSpace;
	const mesh = new Mesh(
		geometry,
		new MeshStandardMaterial({
			map,
			roughness: 0.35,
			metalness: 0.05,
			transparent: true,
		}),
	);
	mesh.castShadow = true;
	const face = faces[plan.face] as Face;
	const pose = restPose(face);
	// Endlage: erst die Ergebnisfläche nach oben, dann um z aufrichten.
	const rest = new Quaternion()
		.setFromAxisAngle(new Vector3(0, 0, 1), pose.gz)
		.multiply(
			new Quaternion().setFromAxisAngle(new Vector3(...pose.axis), pose.ang),
		);
	return {
		mesh,
		rest,
		axis: new Vector3(...plan.axis),
		inradius: dot(face.n, face.c),
	};
}

export function createThreeView(host: HTMLElement): DiceView {
	const canvas = document.createElement("canvas");
	canvas.className = "dice-gl";
	// Wirft, wenn kein WebGL-Kontext zu bekommen ist; dann greift die einfache Darstellung.
	const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
	// Schatten und Auflösung knapp halten: Referenzgerät hat 2 GB RAM.
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;
	host.append(canvas);

	const scene = new Scene();
	const camera = new PerspectiveCamera(30, 1, 1, 5000);
	camera.position.set(0, 0, CAMERA_Z);
	scene.add(new AmbientLight(0xffffff, 1.9));
	const sun = new DirectionalLight(0xffffff, 2.6);
	sun.position.set(-220, 320, 520);
	sun.castShadow = true;
	sun.shadow.mapSize.set(1024, 1024);
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = 2000;
	scene.add(sun);
	const shadowMaterial = new ShadowMaterial({ opacity: 0.4 });
	const floor = new Mesh(new PlaneGeometry(6000, 6000), shadowMaterial);
	floor.receiveShadow = true;
	scene.add(floor);

	let dice: ThreeDie[] = [];
	let size = "";
	const spin = new Quaternion();

	function clear(): void {
		for (const d of dice) {
			scene.remove(d.mesh);
			d.mesh.geometry.dispose();
			d.mesh.material.map?.dispose();
			d.mesh.material.dispose();
		}
		dice = [];
		renderer.render(scene, camera);
	}

	return {
		build(plans, color, textColor) {
			clear();
			dice = plans.map((plan) => buildMesh(plan, color, textColor));
			for (const d of dice) scene.add(d.mesh);
		},
		frame(poses, opacity, width, height) {
			if (size !== `${width}x${height}` && width > 0 && height > 0) {
				size = `${width}x${height}`;
				renderer.setSize(width, height, false);
				camera.aspect = width / height;
				camera.fov = (2 * Math.atan(height / 2 / CAMERA_Z) * 180) / Math.PI;
				camera.updateProjectionMatrix();
				const s = sun.shadow.camera;
				s.left = -width;
				s.right = width;
				s.top = height;
				s.bottom = -height;
				s.updateProjectionMatrix();
			}
			shadowMaterial.opacity = 0.4 * opacity;
			dice.forEach((d, i) => {
				const pose = poses[i];
				if (!pose) return;
				// Plan-y zeigt nach unten, die Szene nach oben.
				d.mesh.position.set(pose.x, -pose.y, pose.z + d.inradius);
				spin.setFromAxisAngle(d.axis, pose.angle);
				d.mesh.quaternion.copy(spin).multiply(d.rest);
				d.mesh.material.opacity = opacity;
			});
			renderer.render(scene, camera);
		},
		clear,
		destroy() {
			clear();
			floor.geometry.dispose();
			shadowMaterial.dispose();
			renderer.dispose();
			renderer.forceContextLoss();
			canvas.remove();
		},
	};
}
