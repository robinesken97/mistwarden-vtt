// Einfache Darstellung der Würfel mit CSS-3D: dieselben Körper und derselbe Flug wie in der
// 3D-Ansicht, aber ohne zweiten WebGL-Kontext (Rückfall und „einfach“ in den Einstellungen).
import {
	dieFaces,
	dot,
	type Face,
	norm,
	restPose,
	rot,
	type Vec,
} from "./geometry.ts";
import { DIE_SCALE, type DiceView } from "./layer.ts";
import type { PlannedDie } from "./plan.ts";

const LIGHT = norm([-0.35, -0.5, 0.8]);

interface CssDie {
	plan: PlannedDie;
	faces: Face[];
	rest: ReturnType<typeof restPose>;
	box: HTMLElement;
	faceEls: HTMLElement[];
	shadow: HTMLElement;
}

const div = (className: string) => {
	const el = document.createElement("div");
	el.className = className;
	return el;
};

export function createCssView(host: HTMLElement): DiceView {
	const stage = div("dice-css");
	host.append(stage);
	let dice: CssDie[] = [];

	return {
		build(plans, color, textColor) {
			stage.replaceChildren();
			dice = plans.map((plan): CssDie => {
				const faces = dieFaces(plan.kind, DIE_SCALE);
				const box = div("dice-css-die");
				const shadow = div("dice-css-shadow");
				const faceEls = faces.map((f, i) => {
					const size = 2 * f.R + 2;
					const el = div("dice-css-face");
					el.style.width = el.style.height = `${size}px`;
					el.style.left = el.style.top = `${-size / 2}px`;
					el.style.fontSize = `${Math.round(f.R * (plan.labels[0]?.length === 2 ? 0.55 : 0.75))}px`;
					el.style.background = color;
					el.style.color = textColor;
					el.style.clipPath = `polygon(${f.loc
						.map(
							(l) =>
								`${(l[0] + size / 2).toFixed(2)}px ${(l[1] + size / 2).toFixed(2)}px`,
						)
						.join(",")})`;
					// Achsenkreuz der Fläche in den Raum legen. Die Körper werden hier mit y nach
					// unten gezeichnet (gespiegelt zur 3D-Ansicht); „oben“ der Zahl bleibt oben.
					const m = [...f.u, 0, ...f.v, 0, ...f.n, 0, ...f.c, 1];
					el.style.transform = `matrix3d(${m.map((x) => x.toFixed(5)).join(",")})`;
					el.textContent = plan.labels[i] ?? "";
					box.append(el);
					return el;
				});
				stage.append(shadow, box);
				return {
					plan,
					faces,
					rest: restPose(faces[plan.face] as Face),
					box,
					faceEls,
					shadow,
				};
			});
		},
		frame(poses, opacity, width, height) {
			stage.style.opacity = String(opacity);
			dice.forEach((d, i) => {
				const pose = poses[i];
				if (!pose) return;
				const x = width / 2 + pose.x;
				const y = height / 2 + pose.y;
				const axis = d.plan.axis;
				const fmt = (v: Vec) => v.map((x) => x.toFixed(5)).join(",");
				// Von rechts nach links: Endlage, Aufrichten um z, Taumeln, Ort.
				d.box.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${pose.z.toFixed(2)}px) rotate3d(${fmt(axis)},${pose.angle.toFixed(4)}rad) rotateZ(${d.rest.gz.toFixed(5)}rad) rotate3d(${fmt(d.rest.axis)},${d.rest.ang.toFixed(5)}rad)`;
				d.faceEls.forEach((el, j) => {
					const f = d.faces[j] as Face;
					const n = rot(
						rot(rot(f.n, d.rest.axis, d.rest.ang), [0, 0, 1], d.rest.gz),
						axis,
						pose.angle,
					);
					// Nach dem Licht tönen; abgewandte Flächen blendet `backface-visibility` aus.
					el.style.filter = `brightness(${(0.55 + 0.45 * Math.max(0, dot(n, LIGHT))).toFixed(3)})`;
				});
				d.shadow.style.transform = `translate(${(x + 10 + pose.z * 0.2).toFixed(1)}px,${(y + 16 + pose.z * 0.3).toFixed(1)}px) scale(1,0.6)`;
				d.shadow.style.opacity = String(0.7 * (1 - pose.z / 260));
			});
		},
		clear() {
			stage.replaceChildren();
			dice = [];
		},
		destroy() {
			stage.remove();
		},
	};
}
