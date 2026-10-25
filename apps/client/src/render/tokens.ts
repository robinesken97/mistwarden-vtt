import {
	Container,
	Graphics,
	ImageSource,
	Sprite,
	type Texture,
	Texture as TextureClass,
} from "pixi.js";

/** Ein Token, wie die Spielfläche es zeichnet (Werte schon aufbereitet). */
export interface StageToken {
	id: string;
	/** Mittelpunkt in Weltkoordinaten. */
	x: number;
	y: number;
	/** Kantenlänge in Weltkoordinaten (Felder × Gridgröße). */
	sizePx: number;
	rotation: number;
	layer: "props" | "tokens";
	/** Kachel-URL des Token-Bilds oder null, solange die Metadaten fehlen. */
	textureUrl: string | null;
	/** Ringfarbe (Farbe des Besitzers) oder null. */
	color: string | null;
	selected: boolean;
	/** Für Spieler versteckt; die GM sieht es halbtransparent. */
	hidden: boolean;
	/** Darf angetippt bzw. gezogen werden (Props gesperrt, fremde Tokens …)? */
	hittable: boolean;
}

interface View {
	root: Container;
	sprite: Sprite;
	frame: Graphics;
	textureUrl: string | null;
	key: string;
}

/**
 * Zeichnet Tokens einer Ebene. Tokens mit gleichem Bild teilen sich eine Textur;
 * Texturen ohne Token werden sofort freigegeben.
 */
export class TokenLayer {
	readonly container: Container;
	readonly #views = new Map<string, View>();
	readonly #textures: TokenTextures;
	#tokens: StageToken[] = [];

	constructor(label: string, textures: TokenTextures) {
		this.container = new Container({ label });
		this.#textures = textures;
	}

	set(tokens: StageToken[]): void {
		this.#tokens = tokens;
		const seen = new Set<string>();
		tokens.forEach((t, index) => {
			seen.add(t.id);
			let view = this.#views.get(t.id);
			if (!view) {
				const root = new Container({ label: `token:${t.id}` });
				const sprite = new Sprite();
				sprite.anchor.set(0.5);
				const frame = new Graphics();
				root.addChild(sprite, frame);
				this.container.addChild(root);
				view = { root, sprite, frame, textureUrl: null, key: "" };
				this.#views.set(t.id, view);
			}
			this.#update(view, t);
			this.container.setChildIndex(view.root, index);
		});
		for (const [id, view] of this.#views) {
			if (seen.has(id)) continue;
			if (view.textureUrl) this.#textures.release(view.textureUrl);
			view.root.destroy({ children: true });
			this.#views.delete(id);
		}
	}

	/** Oberstes antippbares Token an einem Weltpunkt. */
	hitTest(x: number, y: number): string | null {
		for (let i = this.#tokens.length - 1; i >= 0; i--) {
			const t = this.#tokens[i] as StageToken;
			if (!t.hittable) continue;
			const a = (-t.rotation * Math.PI) / 180;
			const dx = x - t.x;
			const dy = y - t.y;
			const lx = dx * Math.cos(a) - dy * Math.sin(a);
			const ly = dx * Math.sin(a) + dy * Math.cos(a);
			const half = t.sizePx / 2;
			if (Math.abs(lx) <= half && Math.abs(ly) <= half) return t.id;
		}
		return null;
	}

	get(id: string): StageToken | undefined {
		return this.#tokens.find((t) => t.id === id);
	}

	destroy(): void {
		this.set([]);
		this.container.destroy({ children: true });
	}

	#update(view: View, t: StageToken): void {
		view.root.position.set(t.x, t.y);
		view.root.angle = t.rotation;
		view.root.alpha = t.hidden ? 0.45 : 1;

		if (view.textureUrl !== t.textureUrl) {
			if (view.textureUrl) this.#textures.release(view.textureUrl);
			view.textureUrl = t.textureUrl;
			if (t.textureUrl) this.#textures.acquire(t.textureUrl);
		}
		const texture = t.textureUrl ? this.#textures.get(t.textureUrl) : undefined;
		view.sprite.visible = texture !== undefined;
		if (texture) {
			view.sprite.texture = texture;
			// Bild in das Quadrat einpassen, Seitenverhältnis bleibt.
			const scale = t.sizePx / Math.max(texture.width, texture.height);
			view.sprite.scale.set(scale);
		}

		// Rahmen nur neu zeichnen, wenn sich etwas daran geändert hat.
		const key = `${t.sizePx}|${t.color}|${t.selected}|${texture ? 1 : 0}`;
		if (key === view.key) return;
		view.key = key;
		const half = t.sizePx / 2;
		const line = Math.max(2, t.sizePx * 0.04);
		const g = view.frame.clear();
		if (!texture) {
			g.circle(0, 0, half * 0.9).fill({ color: 0x777777, alpha: 0.6 });
		}
		if (t.color) {
			g.circle(0, 0, half - line / 2).stroke({ width: line, color: t.color });
		}
		if (t.selected) {
			g.rect(
				-half - line,
				-half - line,
				t.sizePx + 2 * line,
				t.sizePx + 2 * line,
			).stroke({
				width: line,
				color: 0xffd23f,
			});
		}
	}
}

/** Gemeinsame Token-Texturen mit Referenzzählung. */
export class TokenTextures {
	readonly #entries = new Map<
		string,
		{ refs: number; texture?: Texture; bitmap?: ImageBitmap; failed?: boolean }
	>();
	readonly #onLoaded: () => void;

	constructor(onLoaded: () => void) {
		this.#onLoaded = onLoaded;
	}

	get(url: string): Texture | undefined {
		return this.#entries.get(url)?.texture;
	}

	acquire(url: string): void {
		const entry = this.#entries.get(url);
		if (entry) {
			entry.refs++;
			return;
		}
		const fresh: {
			refs: number;
			texture?: Texture;
			bitmap?: ImageBitmap;
			failed?: boolean;
		} = {
			refs: 1,
		};
		this.#entries.set(url, fresh);
		this.#load(url, fresh);
	}

	release(url: string): void {
		const entry = this.#entries.get(url);
		if (!entry || --entry.refs > 0) return;
		this.#entries.delete(url);
		entry.texture?.destroy(true);
		entry.bitmap?.close();
	}

	destroy(): void {
		for (const entry of this.#entries.values()) {
			entry.texture?.destroy(true);
			entry.bitmap?.close();
		}
		this.#entries.clear();
	}

	async #load(
		url: string,
		entry: {
			refs: number;
			texture?: Texture;
			bitmap?: ImageBitmap;
			failed?: boolean;
		},
	): Promise<void> {
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(String(res.status));
			const bitmap = await createImageBitmap(await res.blob());
			if (this.#entries.get(url) !== entry) {
				bitmap.close();
				return;
			}
			entry.bitmap = bitmap;
			entry.texture = new TextureClass({
				source: new ImageSource({ resource: bitmap, scaleMode: "linear" }),
			});
			this.#onLoaded();
		} catch {
			entry.failed = true;
		}
	}
}
