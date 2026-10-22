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
