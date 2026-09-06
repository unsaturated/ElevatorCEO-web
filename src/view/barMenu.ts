// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { LAYER_HUD } from "../render/designSpace";
import { rectContains, type TouchDispatcher, type TouchHandler, type TouchPoint } from "../render/input";
import { Sprite2D } from "../render/sprite2d";
import { TextSprite, type TextStyle, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";

/** kDroidSansBold28White, the caption on every menu bar (MainMenuLayer.m:103). */
const MENU_LABEL_STYLE: TextStyle = { family: "DroidSans", size: 28, bold: true, color: "#ffffff" };

/** Label offset from the bar's bottom-left corner (MainMenuLayer.m:100). */
const LABEL_OFFSET_X = 46;

/** Both bar sets are 80 px tall, so 40 design points. */
const MENU_BAR_HEIGHT = 40;

/** The padding every menu passes to alignItemsVerticallyWithPadding. */
const MENU_ITEM_PADDING = -0.5;

/** The off/on frame pair a row's caption is laid over. */
export interface MenuBarFrames {
    readonly off: string;
    readonly on: string;
}

/** The wide bars used by every full-screen menu. */
export const MAIN_MENU_BARS: MenuBarFrames = { off: "main-menu-bar-off.png", on: "main-menu-bar-on.png" };

/** GamePauseLayer.m:80-86 — the narrower bars that fit inside the play area. */
export const GAME_MENU_BARS: MenuBarFrames = { off: "game-menu-bar-off.png", on: "game-menu-bar-on.png" };

/**
 * One CCMenuItemImage: an off/on bar pair with a caption laid over it.
 *
 * `visible` and `collapsed` are separate because CCMenu aligned its children by
 * contentSize × scaleY: hiding an item left its slot behind, so the pause menu
 * hid the confirmation row but collapsed the tutorial row with scaleY 0
 * (GamePauseLayer.m:149). Mutate these, then call `BarMenu.layout`.
 */
export interface MenuRow {
    readonly node: TransformNode;
    readonly off: Sprite2D;
    readonly on: Sprite2D;
    readonly label: TextSprite;
    visible: boolean;
    /** A visible row that ignores taps. */
    enabled: boolean;
    collapsed: boolean;
    readonly onTap: () => void;
}

export interface BarMenuOptions {
    /** Node the row stack hangs off, normally the owning view's root. */
    parent: TransformNode;
    /** Prefix for the node names, e.g. "pause". */
    name: string;
    /** Defaults to the wide bars; the pause menu passes the narrow pair. */
    bars?: MenuBarFrames;
    /** Draw order of the off bar. The on bar and the caption sit one and two above. */
    z: number;
    layerMask?: number;
    centerX: number;
    /**
     * Stack center in the parent's space. Omit it where the original left the
     * CCMenu at its default position, which puts the stack's own half-height at
     * the origin (GamePauseLayer.m:154, GameOverLayer.m:116).
     */
    centerY?: number;
    touchPriority: number;
    /** Taps are only dispatched while this holds, i.e. while the view is up. */
    active: () => boolean;
}

/**
 * A vertical stack of menu bars, replacing CCMenu plus its CCMenuItemImages.
 *
 * Every menu in the game is this same widget: identical bar art, caption style
 * and press feedback, laid out by alignItemsVerticallyWithPadding and driven by
 * a touch handler that highlights the row under the finger and fires on release
 * only if the finger never left it. The differences between screens are all
 * data - which bar art, which draw order, where the stack sits, and which rows
 * it holds - so they are options here rather than five copies of the logic.
 */
export class BarMenu {
    readonly node: TransformNode;

    private readonly _rows: MenuRow[] = [];
    private readonly _handler: TouchHandler;
    private readonly _bars: MenuBarFrames;
    private readonly _layerMask: number;

    private _pressed: MenuRow | null = null;

    constructor(
        private readonly _scene: Scene,
        private readonly _textures: TextureCache,
        private readonly _text: TextTextureCache,
        private readonly _touch: TouchDispatcher,
        private readonly _options: BarMenuOptions
    ) {
        this._bars = _options.bars ?? MAIN_MENU_BARS;
        this._layerMask = _options.layerMask ?? LAYER_HUD;

        this.node = new TransformNode(`${_options.name}:menu`, _scene);
        this.node.parent = _options.parent;
        this.node.position.x = _options.centerX;
        this.node.position.y = _options.centerY ?? 0;

        this._handler = this._touch.add({
            priority: _options.touchPriority,
            swallowsTouches: true,
            enabled: _options.active,
            onBegan: (point) => this._onPointer(point, true),
            onMoved: (point) => this._onPointer(point, false),
            onEnded: (point) => this._onPointerEnd(point),
            // CCMenu.m:196-202 — canceled unhighlights without activating.
            onCanceled: () => this.releasePress(),
        });
    }

    /** Appends a row to the bottom of the stack and re-runs the layout. */
    addRow(caption: string, onTap: () => void): MenuRow {
        const node = new TransformNode(`${this._options.name}:row:${caption}`, this._scene);
        node.parent = this.node;

        const z = this._options.z;
        const off = new Sprite2D(this._textures, this._scene, this._bars.off, {
            parent: node,
            z,
            layerMask: this._layerMask,
        });
        const on = new Sprite2D(this._textures, this._scene, this._bars.on, {
            parent: node,
            z: z + 1,
            layerMask: this._layerMask,
        });
        on.visible = false;

        const label = new TextSprite(this._text, this._scene, caption, MENU_LABEL_STYLE, {
            anchorX: 0,
            anchorY: 0.5,
            parent: node,
            z: z + 2,
            layerMask: this._layerMask,
        });
        label.setPosition(LABEL_OFFSET_X - off.width / 2, 0);

        const row: MenuRow = { node, off, on, label, visible: true, enabled: true, collapsed: false, onTap };
        this._rows.push(row);
        this.layout();
        return row;
    }

    /** CCMenu alignItemsVerticallyWithPadding (CCMenu.m:301-315). */
    layout(): void {
        const stackHeight = this._stackHeight();
        this.node.position.y = this._options.centerY ?? stackHeight / 2;

        let y = stackHeight / 2;
        for (const row of this._rows) {
            const height = this._rowHeight(row);
            row.node.position.x = 0;
            row.node.position.y = y - height / 2;

            const shown = height > 0 && row.visible;
            row.node.setEnabled(shown);
            row.off.visible = shown;
            if (!shown) {
                row.on.visible = false;
            }
            row.label.visible = shown;

            y -= height + MENU_ITEM_PADDING;
        }
    }

    /** Drops any highlight, as leaving the screen mid-press must. */
    releasePress(): void {
        if (!this._pressed) {
            return;
        }
        this._pressed.on.visible = false;
        this._pressed = null;
    }

    dispose(): void {
        this._touch.remove(this._handler);
        this.node.dispose();
    }

    /** Collapsed rows contribute no height, but every child still adds padding. */
    private _stackHeight(): number {
        if (this._rows.length === 0) {
            return 0;
        }
        let height = -MENU_ITEM_PADDING;
        for (const row of this._rows) {
            height += this._rowHeight(row) + MENU_ITEM_PADDING;
        }
        return height;
    }

    private _rowHeight(row: MenuRow): number {
        return row.collapsed ? 0 : MENU_BAR_HEIGHT;
    }

    private _onPointer(point: TouchPoint, began: boolean): boolean {
        const local = this._toMenuLocal(point);
        const row = this._rowAt(local.x, local.y);
        if (began) {
            if (row) {
                this._pressed = row;
                row.on.visible = true;
            }
            // The menu covers its whole screen or overlay, so the touch is
            // claimed either way and nothing behind it sees the press.
            return true;
        }

        if (this._pressed && this._pressed !== row) {
            this.releasePress();
        }
        if (row && row === this._pressed) {
            row.on.visible = true;
        }
        return true;
    }

    private _onPointerEnd(point: TouchPoint): void {
        const local = this._toMenuLocal(point);
        const row = this._rowAt(local.x, local.y);
        const pressed = this._pressed;
        this.releasePress();
        if (row && row === pressed) {
            row.onTap();
        }
    }

    private _rowAt(x: number, y: number): MenuRow | null {
        for (const row of this._rows) {
            if (!row.visible || !row.enabled || row.collapsed) {
                continue;
            }
            const localX = x - row.node.position.x;
            const localY = y - row.node.position.y;
            if (rectContains(row.off.boundingBox(), localX, localY)) {
                return row;
            }
        }
        return null;
    }

    /** Design-space coordinates relative to the stack origin. */
    private _toMenuLocal(point: TouchPoint): { x: number; y: number } {
        let x = point.x;
        let y = point.y;
        let node: TransformNode | null = this.node;
        while (node) {
            x -= node.position.x;
            y -= node.position.y;
            node = node.parent as TransformNode | null;
        }
        return { x, y };
    }
}
