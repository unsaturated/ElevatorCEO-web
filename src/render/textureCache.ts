// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

import { FRAMES_URL, spriteUrl } from "../assets/urls";
import { ASSET_SCALE } from "../core/constants";

export interface FrameSize {
    /** Source pixel dimensions (art is exported at 2x). */
    width: number;
    height: number;
    generated?: boolean;
}

export type FrameManifest = Record<string, FrameSize>;

/**
 * Replaces cocos2d's CCSpriteFrameCache. Frames are addressed by their original
 * names ("el-blue-game.png", "floor.png"), so call sites stay recognizable
 * against the Objective-C source.
 *
 * Because the atlases were dropped in favor of loose PNGs, one texture and one
 * material exist per file. Materials are shared across every mesh using the same
 * image, which keeps the draw call count at roughly the number of distinct
 * images on screen.
 */
export class TextureCache {
    private _manifest: FrameManifest = {};
    private _textures = new Map<string, Texture>();
    private _materials = new Map<string, StandardMaterial>();

    constructor(private readonly _scene: Scene) {}

    async load(): Promise<void> {
        const response = await fetch(FRAMES_URL);
        if (!response.ok) {
            throw new Error(`Could not load frames.json (${response.status}).`);
        }
        this._manifest = (await response.json()) as FrameManifest;
    }

    get frameNames(): string[] {
        return Object.keys(this._manifest);
    }

    has(name: string): boolean {
        return name in this._manifest;
    }

    /** Source pixel size of a frame. */
    pixelSize(name: string): FrameSize {
        const size = this._manifest[name];
        if (!size) {
            throw new Error(`Unknown sprite frame: ${name}`);
        }
        return size;
    }

    /** Frame size in design points, i.e. pixels halved. */
    designSize(name: string): { width: number; height: number } {
        const { width, height } = this.pixelSize(name);
        return { width: width / ASSET_SCALE, height: height / ASSET_SCALE };
    }

    texture(name: string): Texture {
        let texture = this._textures.get(name);
        if (!texture) {
            texture = new Texture(
                spriteUrl(name),
                this._scene,
                true, // no mipmaps: sprites are drawn at their native scale
                // PNG rows arrive top-down and the quads have a bottom-left
                // origin, so the upload has to flip.
                true,
                Texture.BILINEAR_SAMPLINGMODE
            );
            texture.wrapU = Texture.CLAMP_ADDRESSMODE;
            texture.wrapV = Texture.CLAMP_ADDRESSMODE;
            texture.hasAlpha = true;
            this._textures.set(name, texture);
        }
        return texture;
    }

    /**
     * Unlit material for a frame. `emissiveColor` carries the tint because
     * nothing in this game is lit, which makes it the direct analog of
     * CCSprite's `setColor:`.
     */
    material(name: string): StandardMaterial {
        let material = this._materials.get(name);
        if (!material) {
            material = new StandardMaterial(`mat:${name}`, this._scene);
            material.diffuseTexture = this.texture(name);
            material.opacityTexture = this.texture(name);
            material.emissiveColor = new Color3(1, 1, 1);
            material.diffuseColor = new Color3(0, 0, 0);
            material.specularColor = new Color3(0, 0, 0);
            material.disableLighting = true;
            material.backFaceCulling = false;
            material.useAlphaFromDiffuseTexture = true;
            this._materials.set(name, material);
            material.freeze();
        }
        return material;
    }

    dispose(): void {
        for (const material of this._materials.values()) {
            material.dispose();
        }
        for (const texture of this._textures.values()) {
            texture.dispose();
        }
        this._materials.clear();
        this._textures.clear();
    }
}
