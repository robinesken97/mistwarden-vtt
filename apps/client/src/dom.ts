/** Kleiner Helfer zum Erzeugen von DOM-Elementen; Texte werden nie als HTML interpretiert. */
export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	Object.assign(el, props);
	el.append(...children);
	return el;
}

export function button(
	label: string,
	onClick: () => void,
	variant: "primary" | "secondary" = "primary",
): HTMLButtonElement {
	const el = h("button", {
		type: "button",
		className: variant === "secondary" ? "secondary" : "",
		textContent: label,
	});
	el.addEventListener("click", onClick);
	return el;
}

/** Zeigt eine Fehlermeldung in einem Absatz an bzw. blendet sie aus. */
export function errorLine(): HTMLParagraphElement & {
	show(msg: string | null): void;
} {
	const el = h("p", {
		className: "error",
		hidden: true,
	}) as HTMLParagraphElement & {
		show(msg: string | null): void;
	};
	el.show = (msg) => {
		el.textContent = msg ?? "";
		el.hidden = !msg;
	};
	return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Dekoratives Strichsymbol aus Pfaddaten; die Farbe folgt der Textfarbe. */
export function icon(paths: string[], size = 24): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("icon");
	for (const d of paths) {
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}
