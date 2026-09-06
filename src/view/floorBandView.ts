// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import {
    ELEVATOR_SHAFT_WIDTH,
    FLOORS_PER_SCREEN,
    FLOOR_BOTTOM_GAP,
    FLOOR_HEIGHT,
    NUM_LEVEL_SPRITES,
    NUM_LEVEL_SPRITES_PER_SCREEN,
} from "../core/constants";
import { Sprite2D } from "../render/sprite2d";
import { FLOOR_NUMBER_STYLE, TextSprite, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { FloorGeometry } from "../sim/geometry";

interface FloorTile {
    sprite: Sprite2D;
    label: TextSprite;
    /** The floor this tile currently displays, the original's CCSprite `tag`. */
    floor: number;
}

/**
 * The scrolling building, ported from GamePlayFloorLayer.m.
 *
 * Fourteen floor tiles cover the ten visible floors plus a margin, and are
 * recycled top-to-bottom as the layer scrolls, so the building can be tens of
 * thousands of floors tall for the cost of fourteen quads.
 *
 * The original stored each tile's floor number in its `tag` and *derived game
 * state from it* - `floorFromPosition:` searched the sprite list. Here the
 * numbers are display only: FloorGeometry owns the arithmetic, and this class
 * just follows it. That inversion is what let the simulation become headless.
 */
export class FloorBandView {
    readonly node: TransformNode;

    private readonly _tiles: FloorTile[] = [];
    private readonly _divider: Sprite2D;

    private _topIndex = 0;
    private _bottomIndex = NUM_LEVEL_SPRITES - 1;
    private _lastWrapY = 0;
    private _floorMax = 0;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        parent: TransformNode | null
    ) {
        this.node = new TransformNode("floorBand", scene);
        this.node.parent = parent;

        // GamePlayFloorLayer.m:52: tiles start one floor above the visible band
        // and march downward, so index 0 is the topmost.
        for (let i = 0; i < NUM_LEVEL_SPRITES; i++) {
            const sprite = new Sprite2D(textures, scene, "floor.png", {
                anchorX: 0,
                anchorY: 0,
                parent: this.node,
                z: 0,
            });

            const label = new TextSprite(text, scene, "0", FLOOR_NUMBER_STYLE, {
                parent: sprite.mesh,
                z: 1,
            });
            label.setPosition(ELEVATOR_SHAFT_WIDTH / 2, FLOOR_HEIGHT / 2 + FLOOR_BOTTOM_GAP);

            this._tiles.push({ sprite, label, floor: 0 });
        }

        // Marks the ceiling of the level; only visible near the top floor.
        this._divider = new Sprite2D(textures, scene, "level-divider.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: 3,
        });
        this._divider.visible = false;
    }

    /** GamePlayFloorLayer.m:139-194. Relays out the tiles for a new level. */
    reset(floorMin: number, floorMax: number): void {
        this._floorMax = floorMax;
        this.node.position.y = 0;
        this._lastWrapY = 0;
        this._topIndex = 0;
        this._bottomIndex = NUM_LEVEL_SPRITES - 1;
        this._divider.visible = false;

        let y = NUM_LEVEL_SPRITES_PER_SCREEN * FLOOR_HEIGHT + FLOOR_HEIGHT;
        // Numbered top-down from floorMin + FLOORS_PER_SCREEN + 1.
        let floor = floorMin + FLOORS_PER_SCREEN + 1;

        for (const tile of this._tiles) {
            tile.sprite.setPosition(0, y);
            tile.floor = floor;
            tile.label.setText(String(floor));
            tile.label.visible = floor >= 0;
            y -= FLOOR_HEIGHT;
            floor--;
        }
    }

    /**
     * Follows the simulation's scroll offset and recycles tiles.
     *
     * GamePlayFloorLayer.m:256-333, with one change: the original inferred its
     * own direction of travel from its position delta because it was also the
     * thing being moved. Here the offset is handed in, so direction is simply
     * its sign.
     */
    sync(floors: FloorGeometry): void {
        const y = floors.layerY;
        this.node.position.y = y;

        const goingUp = this._lastWrapY > y;
        const goingDown = this._lastWrapY < y;
        if (!goingUp && !goingDown) {
            return;
        }

        const top = this._tiles[this._topIndex]!;
        const bottom = this._tiles[this._bottomIndex]!;

        const needsWrap = Math.abs(y - this._lastWrapY) >= FLOOR_HEIGHT;
        // Without this the tiles drift a fraction of a floor per wrap and a gap
        // eventually opens at the edge of the screen.
        const needsAdjust = goingUp
            ? top.sprite.y + y <= FLOORS_PER_SCREEN * FLOOR_HEIGHT
            : bottom.sprite.y + y >= 0;

        if (!needsWrap && !needsAdjust) {
            return;
        }

        this._lastWrapY = y;

        if (goingUp) {
            bottom.sprite.setPosition(0, top.sprite.y + FLOOR_HEIGHT);
            bottom.floor = top.floor + 1;
            bottom.label.setText(String(bottom.floor));
            bottom.label.visible = true;

            if (bottom.floor === this._floorMax) {
                this._divider.setPosition(0, bottom.sprite.y + FLOOR_HEIGHT);
                this._divider.visible = true;
            }

            this._topIndex = this._bottomIndex;
            this._bottomIndex = this._bottomIndex - 1 < 0 ? NUM_LEVEL_SPRITES - 1 : this._bottomIndex - 1;
        } else {
            top.sprite.setPosition(0, bottom.sprite.y - FLOOR_HEIGHT);
            top.floor = bottom.floor - 1;
            // Floors below zero are never reachable, and the original's bitmap
            // font had no minus glyph, so they stayed blank.
            top.label.visible = top.floor >= 0;
            if (top.floor >= 0) {
                top.label.setText(String(top.floor));
            }

            this._bottomIndex = this._topIndex;
            this._topIndex = this._topIndex + 1 > NUM_LEVEL_SPRITES - 1 ? 0 : this._topIndex + 1;
        }
    }

    dispose(): void {
        for (const tile of this._tiles) {
            tile.label.dispose();
            tile.sprite.dispose();
        }
        this._divider.dispose();
        this.node.dispose();
    }
}
