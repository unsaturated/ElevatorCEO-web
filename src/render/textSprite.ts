// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { LAYER_WORLD } from "./designSpace";

/**
 * The fonts declared with @font-face in index.html. `CCLabelBMFont` styles map
 * onto these plus a size and color, replacing the 56 AngelCode .fnt files.
 */
export interface TextStyle {
    family: string;
    /** Height in design points. */
    size: number;
    bold?: boolean;
    color: string;
    /** Drawn behind the glyphs, as the bitmap fonts' baked outlines did. */
    outlineColor?: string;
    outlineWidth?: number;
}

/** kDroidSansBold12White: the floor numbers stencilled on each floor. */
export const FLOOR_NUMBER_STYLE: TextStyle = { family: "DroidSans", size: 12, bold: true, color: "#ffffff" };
/** kDroidSansBold20Black: the passenger count inside a speech balloon. */
export const PASSENGER_STYLE: TextStyle = { family: "DroidSans", size: 20, bold: true, color: "#000000" };
/** kLeague72White and kLeague24White, used by the level transition card. */
export const LEAGUE_LARGE_STYLE: TextStyle = { family: "LeagueGothic", size: 72, color: "#ffffff" };
export const LEAGUE_SMALL_STYLE: TextStyle = { family: "LeagueGothic", size: 24, color: "#ffffff" };

/** Texels per design point. Matches the 2x source art so text stays as crisp. */
const TEXT_SUPERSAMPLE = 2;
/** Slack around the glyphs so descenders and outlines are not clipped. */
const PADDING = 4;

interface RenderedText {
    texture: DynamicTexture;
    material: StandardMaterial;
    /** Quad size in design points. */
    width: number;
    height: number;
}

function cssFont(style: TextStyle, scale: number): string {
    return `${style.bold ? "bold " : ""}${style.size * scale}px "${style.family}", sans-serif`;
}

/** Quad height in design points for a single-line label with the given style. */
export function textQuadHeight(style: TextStyle): number {
    const outline = style.outlineWidth ?? 0;
    return Math.max(1, Math.ceil(style.size * 1.35 + (PADDING + outline) * 2));
}

/**
 * Renders short strings into DynamicTextures for use on world-space quads.
 *
 * Babylon GUI would be the obvious choice, but an AdvancedDynamicTexture
 * repaints its whole root container whenever any control changes, and these
 * labels ride on the scrolling floor layer and the elevators, so they move
 * every frame. A DynamicTexture per distinct string is repainted only when the
 * string itself changes - a floor number is redrawn when its sprite wraps, and
 * never otherwise.
 */
export class TextTextureCache {
    private _entries = new Map<string, RenderedText>();
    private _measure: CanvasRenderingContext2D | null = null;

    constructor(private readonly _scene: Scene) {}

    get(text: string, style: TextStyle): RenderedText {
        const key = `${style.family}|${style.size}|${style.bold ? "b" : "n"}|${style.color}|${style.outlineColor ?? ""}|${style.outlineWidth ?? 0}|${text}`;
        const cached = this._entries.get(key);
        if (cached) {
            return cached;
        }

        const outline = style.outlineWidth ?? 0;
        const metrics = this._measureText(text, style);
        const width = Math.max(1, Math.ceil(metrics.width + (PADDING + outline) * 2));
        const height = textQuadHeight(style);

        const texture = new DynamicTexture(
            `text:${key}`,
            { width: width * TEXT_SUPERSAMPLE, height: height * TEXT_SUPERSAMPLE },
            this._scene,
            true
        );
        texture.hasAlpha = true;

        const context = texture.getContext() as CanvasRenderingContext2D;
        context.clearRect(0, 0, width * TEXT_SUPERSAMPLE, height * TEXT_SUPERSAMPLE);
        context.font = cssFont(style, TEXT_SUPERSAMPLE);
        context.textAlign = "center";
        context.textBaseline = "middle";

        const centerX = (width * TEXT_SUPERSAMPLE) / 2;
        const centerY = (height * TEXT_SUPERSAMPLE) / 2;
        if (style.outlineColor && outline > 0) {
            context.lineWidth = outline * 2 * TEXT_SUPERSAMPLE;
            context.strokeStyle = style.outlineColor;
            context.lineJoin = "round";
            context.strokeText(text, centerX, centerY);
        }
        context.fillStyle = style.color;
        context.fillText(text, centerX, centerY);
        // Default invertY: the 2D canvas has a top-left origin and the quad a
        // bottom-left one, so the upload has to flip.
        texture.update();

        const material = new StandardMaterial(`textmat:${key}`, this._scene);
        material.diffuseTexture = texture;
        material.opacityTexture = texture;
        material.emissiveColor = new Color3(1, 1, 1);
        material.diffuseColor = new Color3(0, 0, 0);
        material.specularColor = new Color3(0, 0, 0);
        material.disableLighting = true;
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;

        const entry: RenderedText = { texture, material, width, height };
        this._entries.set(key, entry);
        return entry;
    }

    private _measureText(text: string, style: TextStyle): TextMetrics {
        if (!this._measure) {
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) {
                throw new Error("2D canvas context unavailable for text measurement");
            }
            this._measure = context;
        }
        this._measure.font = cssFont(style, 1);
        return this._measure.measureText(text);
    }

    /**
     * Discards cached strings. Called when webfonts finish loading, since
     * anything drawn beforehand used a fallback face with wrong metrics.
     */
    clear(): void {
        for (const entry of this._entries.values()) {
            entry.material.dispose();
            entry.texture.dispose();
        }
        this._entries.clear();
    }

    dispose(): void {
        this.clear();
    }
}

/**
 * A quad displaying a string, the world-space analog of CCLabelBMFont.
 *
 * The quad resizes to the text, and the anchor works the same way as Sprite2D's
 * so positions can be copied from the Objective-C unchanged.
 */
export class TextSprite {
    readonly mesh: Mesh;

    private _text = "";
    private _anchorX: number;
    private _anchorY: number;
    private _color = new Color3(1, 1, 1);
    /** Per-sprite material so a tint or fade cannot recode every copy of this string. */
    private readonly _material: StandardMaterial;

    constructor(
        private readonly _cache: TextTextureCache,
        scene: Scene,
        text: string,
        private _style: TextStyle,
        options: { anchorX?: number; anchorY?: number; parent?: TransformNode | null; z?: number; layerMask?: number } = {}
    ) {
        this._anchorX = options.anchorX ?? 0.5;
        this._anchorY = options.anchorY ?? 0.5;

        this.mesh = new Mesh(`text:${text}`, scene);
        this.mesh.layerMask = options.layerMask ?? LAYER_WORLD;
        this.mesh.isPickable = false;
        this.mesh.alphaIndex = options.z ?? 0;
        if (options.z !== undefined) {
            this.mesh.position.z = -options.z;
        }
        if (options.parent) {
            this.mesh.parent = options.parent;
        }

        this._material = new StandardMaterial(`textmat:${text}`, scene);
        this._material.emissiveColor = this._color.clone();
        this._material.diffuseColor = new Color3(0, 0, 0);
        this._material.specularColor = new Color3(0, 0, 0);
        this._material.disableLighting = true;
        this._material.backFaceCulling = false;
        this._material.useAlphaFromDiffuseTexture = true;
        this.mesh.material = this._material;

        this.setText(text);
    }

    get text(): string {
        return this._text;
    }

    setText(text: string): this {
        if (text === this._text && this.mesh.material) {
            return this;
        }
        this._text = text;

        const rendered = this._cache.get(text, this._style);
        this._material.diffuseTexture = rendered.texture;
        this._material.opacityTexture = rendered.texture;

        const left = -this._anchorX * rendered.width;
        const bottom = -this._anchorY * rendered.height;
        const data = new VertexData();
        data.positions = [
            left,
            bottom,
            0,
            left + rendered.width,
            bottom,
            0,
            left + rendered.width,
            bottom + rendered.height,
            0,
            left,
            bottom + rendered.height,
            0,
        ];
        data.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
        data.indices = [0, 1, 2, 0, 2, 3];
        data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
        data.applyToMesh(this.mesh, true);
        return this;
    }

    setStyle(style: TextStyle): this {
        this._style = style;
        const text = this._text;
        this._text = "";
        return this.setText(text);
    }

    setPosition(x: number, y: number): this {
        this.mesh.position.x = x;
        this.mesh.position.y = y;
        return this;
    }

    get x(): number {
        return this.mesh.position.x;
    }

    set x(value: number) {
        this.mesh.position.x = value;
    }

    get y(): number {
        return this.mesh.position.y;
    }

    set y(value: number) {
        this.mesh.position.y = value;
    }

    get scale(): number {
        return this.mesh.scaling.x;
    }

    set scale(value: number) {
        this.mesh.scaling.x = value;
        this.mesh.scaling.y = value;
    }

    /**
     * Per-label tint, the analog of CCLabelBMFont `setColor:`. Emissive on
     * this sprite's own material, so a flash cannot recode any other label.
     */
    get color(): Color3 {
        return this._color;
    }

    setColor(r: number, g: number, b: number): this {
        this._color.set(r, g, b);
        this._material.emissiveColor.set(r, g, b);
        return this;
    }

    setColor255(r: number, g: number, b: number): this {
        return this.setColor(r / 255, g / 255, b / 255);
    }

    get visible(): boolean {
        return this.mesh.isEnabled(false);
    }

    set visible(value: boolean) {
        this.mesh.setEnabled(value);
    }

    get opacity(): number {
        return this.mesh.visibility;
    }

    set opacity(value: number) {
        this.mesh.visibility = Math.max(0, Math.min(1, value));
    }

    dispose(): void {
        this.mesh.material = null;
        this._material.dispose(false, false);
        this.mesh.dispose(false, false);
    }
}

/**
 * Resolves the webfonts before any text is rasterized. Without this the first
 * strings are drawn in a fallback face and silently keep the wrong metrics.
 */
export async function waitForFonts(): Promise<void> {
    if (!("fonts" in document)) {
        return;
    }
    await Promise.all([
        document.fonts.load('12px "DroidSans"'),
        document.fonts.load('bold 12px "DroidSans"'),
        document.fonts.load('24px "LeagueGothic"'),
    ]);
    await document.fonts.ready;
}
