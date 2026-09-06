// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { LAYER_WORLD } from "./designSpace";
import type { TextureCache } from "./textureCache";

/**
 * Builds a quad whose local origin sits at `anchor`, expressed as a fraction of
 * the quad's size. This is cocos2d's `anchorPoint`: because the origin moves
 * with the anchor, rotation and scaling pivot around it and `position` places
 * it, exactly as CCNode behaved.
 */
function buildQuad(mesh: Mesh, width: number, height: number, anchorX: number, anchorY: number): void {
    const left = -anchorX * width;
    const right = left + width;
    const bottom = -anchorY * height;
    const top = bottom + height;

    const data = new VertexData();
    data.positions = [left, bottom, 0, right, bottom, 0, right, top, 0, left, top, 0];
    data.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    data.indices = [0, 1, 2, 0, 2, 3];
    data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
    data.applyToMesh(mesh, false);
}

export interface Sprite2DOptions {
    /** Anchor as a fraction of size. cocos2d's CCSprite default is centered. */
    anchorX?: number;
    anchorY?: number;
    /** Overrides the frame's natural design-point size. */
    width?: number;
    height?: number;
    parent?: TransformNode | Sprite2D | null;
    /** Draw order within the scene, matching cocos2d's addChild:z:. */
    z?: number;
    layerMask?: number;
}

/**
 * A textured quad positioned in design points, standing in for CCSprite.
 *
 * The underlying Mesh is a TransformNode, so parenting gives relative
 * transforms natively. That is what makes the scrolling floor layer work: its
 * children move with it without any per-frame position maths.
 */
export class Sprite2D {
    readonly mesh: Mesh;

    private _frameName: string;
    private _baseMaterial: StandardMaterial;
    private _ownMaterial: StandardMaterial | null = null;
    private _color = new Color3(1, 1, 1);
    private _width: number;
    private _height: number;
    private _anchorX: number;
    private _anchorY: number;

    constructor(
        private readonly _cache: TextureCache,
        scene: Scene,
        frameName: string,
        options: Sprite2DOptions = {}
    ) {
        this._frameName = frameName;

        const natural = _cache.designSize(frameName);
        this._width = options.width ?? natural.width;
        this._height = options.height ?? natural.height;
        this._anchorX = options.anchorX ?? 0.5;
        this._anchorY = options.anchorY ?? 0.5;

        this.mesh = new Mesh(`sprite:${frameName}`, scene);
        buildQuad(this.mesh, this._width, this._height, this._anchorX, this._anchorY);

        this._baseMaterial = _cache.material(frameName);
        this.mesh.material = this._baseMaterial;
        this.mesh.layerMask = options.layerMask ?? LAYER_WORLD;
        this.mesh.isPickable = false;
        // Sprites are drawn painter-style by z; depth testing would otherwise
        // reject fragments of overlapping transparent quads.
        this.mesh.alphaIndex = options.z ?? 0;

        if (options.z !== undefined) {
            this.mesh.position.z = -options.z;
        }
        if (options.parent) {
            this.setParent(options.parent);
        }
    }

    // -- Hierarchy ---------------------------------------------------------

    setParent(parent: TransformNode | Sprite2D | null): this {
        this.mesh.parent = parent instanceof Sprite2D ? parent.mesh : parent;
        return this;
    }

    get node(): TransformNode {
        return this.mesh;
    }

    // -- Transform ---------------------------------------------------------

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

    setPosition(x: number, y: number): this {
        this.mesh.position.x = x;
        this.mesh.position.y = y;
        return this;
    }

    /**
     * Draw order. Higher values sit in front, matching cocos2d's z argument.
     * Depth position is negated because the camera looks along +Z.
     */
    get z(): number {
        return -this.mesh.position.z;
    }

    set z(value: number) {
        this.mesh.position.z = -value;
        this.mesh.alphaIndex = value;
    }

    get scale(): number {
        return this.mesh.scaling.x;
    }

    set scale(value: number) {
        this.mesh.scaling.x = value;
        this.mesh.scaling.y = value;
    }

    setScale(x: number, y: number): this {
        this.mesh.scaling.x = x;
        this.mesh.scaling.y = y;
        return this;
    }

    /** Rotation in degrees, clockwise, matching cocos2d's `rotation`. */
    get rotation(): number {
        return (-this.mesh.rotation.z * 180) / Math.PI;
    }

    set rotation(degrees: number) {
        this.mesh.rotation.z = (-degrees * Math.PI) / 180;
    }

    // -- Appearance --------------------------------------------------------

    get visible(): boolean {
        return this.mesh.isEnabled(false);
    }

    set visible(value: boolean) {
        this.mesh.setEnabled(value);
    }

    /** 0..1, equivalent to CCSprite's opacity 0..255. */
    get opacity(): number {
        return this.mesh.visibility;
    }

    set opacity(value: number) {
        this.mesh.visibility = Math.max(0, Math.min(1, value));
    }

    /**
     * Per-sprite tint, the analog of `setColor:`. The shared material is
     * cloned on first use so tinting one sprite cannot affect the others that
     * use the same image.
     */
    get color(): Color3 {
        return this._color;
    }

    setColor(r: number, g: number, b: number): this {
        this._color.set(r, g, b);
        if (!this._ownMaterial) {
            this._ownMaterial = this._baseMaterial.clone(`${this._baseMaterial.name}:tint`) as StandardMaterial;
            this._ownMaterial.unfreeze();
            this.mesh.material = this._ownMaterial;
        }
        this._ownMaterial.emissiveColor.set(r, g, b);
        return this;
    }

    /** Byte-valued convenience matching the original's ccc3() calls. */
    setColor255(r: number, g: number, b: number): this {
        return this.setColor(r / 255, g / 255, b / 255);
    }

    // -- Frame -------------------------------------------------------------

    /**
     * Swaps the displayed image, the analog of `setDisplayFrame:`. Geometry
     * is rebuilt only when the new frame has a different size.
     */
    setFrame(frameName: string): this {
        if (frameName === this._frameName) {
            return this;
        }
        const size = this._cache.designSize(frameName);
        this._frameName = frameName;
        this._baseMaterial = this._cache.material(frameName);

        if (this._ownMaterial) {
            this._ownMaterial.dispose();
            this._ownMaterial = null;
            this.mesh.material = this._baseMaterial;
            this.setColor(this._color.r, this._color.g, this._color.b);
        } else {
            this.mesh.material = this._baseMaterial;
        }

        if (size.width !== this._width || size.height !== this._height) {
            this._width = size.width;
            this._height = size.height;
            buildQuad(this.mesh, this._width, this._height, this._anchorX, this._anchorY);
        }
        return this;
    }

    // -- Geometry ----------------------------------------------------------

    get frameName(): string {
        return this._frameName;
    }

    get width(): number {
        return this._width;
    }

    get height(): number {
        return this._height;
    }

    setSize(width: number, height: number): this {
        this._width = width;
        this._height = height;
        buildQuad(this.mesh, width, height, this._anchorX, this._anchorY);
        return this;
    }

    setAnchor(anchorX: number, anchorY: number): this {
        this._anchorX = anchorX;
        this._anchorY = anchorY;
        buildQuad(this.mesh, this._width, this._height, anchorX, anchorY);
        return this;
    }

    /** Axis-aligned bounds in the parent's coordinate space, for hit testing. */
    boundingBox(): { left: number; bottom: number; right: number; top: number } {
        const scaleX = this.mesh.scaling.x;
        const scaleY = this.mesh.scaling.y;
        const left = this.mesh.position.x - this._anchorX * this._width * scaleX;
        const bottom = this.mesh.position.y - this._anchorY * this._height * scaleY;
        return {
            left,
            bottom,
            right: left + this._width * scaleX,
            top: bottom + this._height * scaleY,
        };
    }

    containsPoint(x: number, y: number): boolean {
        const box = this.boundingBox();
        return x >= box.left && x <= box.right && y >= box.bottom && y <= box.top;
    }

    dispose(): void {
        this._ownMaterial?.dispose();
        this.mesh.dispose();
    }
}

/** Plain container node, the analog of a bare CCNode or CCLayer. */
export function createNode(name: string, scene: Scene, parent?: TransformNode | null): TransformNode {
    const node = new TransformNode(name, scene);
    if (parent) {
        node.parent = parent;
    }
    return node;
}
