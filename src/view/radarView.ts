// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { RADAR_CONTENT_INSET, RADAR_CONTENT_SIZE, type App } from "../app";
import { MAX_ELS_IN_SHAFT, NUM_ELEVATOR_SHAFTS } from "../core/constants";
import { LAYER_RADAR } from "../render/designSpace";
import { Sprite2D } from "../render/sprite2d";
import { TextSprite, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { Game } from "../sim/game";

/** Spacing between shaft columns: elevator width (8) + 3px (GameRadarContents.m:56). */
const SHAFT_SPACING = 11;

/**
 * Radar minimap rendered into the radar camera's clipped viewport.
 * Port of GameRadarContents.m for the 16x9 clip (57x136).
 */
export class RadarView {
    readonly node: TransformNode;

    private readonly _own: Sprite2D;
    private readonly _greens: Sprite2D[][] = [];
    private readonly _ceo: Sprite2D;
    private readonly _ceoPreview: Sprite2D;
    private readonly _lock: Sprite2D;
    private readonly _countdown: TextSprite;
    private readonly _shaftX: number[];

    private _hidden = false;

    constructor(
        _app: App,
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        private readonly _game: Game,
        parent: TransformNode | null = null
    ) {
        this.node = new TransformNode("radar", scene);
        if (parent) {
            this.node.parent = parent;
        }
        // GameControlLayer.m:56-58 — mRadar sits at (-2, wViewHeight - 154) on the control bar.
        this.node.position.set(-2, 414, 0);

        this._shaftX = Array.from({ length: NUM_ELEVATOR_SHAFTS }, (_, i) => i * SHAFT_SPACING);

        // GameRadar.m:19-24 — the rounded black frame behind the elevator dots.
        new Sprite2D(textures, scene, "radar-score-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: 0,
            layerMask: LAYER_RADAR,
        });

        this._own = new Sprite2D(textures, scene, "radar-blue.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: 2,
            layerMask: LAYER_RADAR,
        });
        this._own.visible = false;

        for (let shaft = 0; shaft < NUM_ELEVATOR_SHAFTS - 1; shaft++) {
            const column: Sprite2D[] = [];
            for (let i = 0; i < MAX_ELS_IN_SHAFT; i++) {
                const sprite = new Sprite2D(textures, scene, "radar-green.png", {
                    anchorX: 0,
                    anchorY: 0,
                    parent: this.node,
                    z: 2,
                    layerMask: LAYER_RADAR,
                });
                sprite.visible = false;
                column.push(sprite);
            }
            this._greens.push(column);
        }

        this._ceo = new Sprite2D(textures, scene, "radar-red.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: 3,
            layerMask: LAYER_RADAR,
        });
        this._ceo.visible = false;

        this._ceoPreview = new Sprite2D(textures, scene, "radar-red.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: 1,
            layerMask: LAYER_RADAR,
        });
        this._ceoPreview.opacity = 0.45;
        this._ceoPreview.visible = false;

        this._lock = new Sprite2D(textures, scene, "no-radar-lock.png", {
            parent: this.node,
            z: 10,
            layerMask: LAYER_RADAR,
        });
        const contentCenterX = RADAR_CONTENT_INSET.x + RADAR_CONTENT_SIZE.width / 2;
        const contentCenterY = RADAR_CONTENT_INSET.y + RADAR_CONTENT_SIZE.height / 2;
        this._lock.setPosition(contentCenterX, contentCenterY);
        this._lock.visible = false;

        const lockHalfHeight = textures.designSize("no-radar-lock.png").height / 2;
        this._countdown = new TextSprite(
            text,
            scene,
            "",
            { family: "DroidSans", size: 20, bold: true, color: "#ffffff" },
            { parent: this.node, z: 11, layerMask: LAYER_RADAR, anchorY: 1 }
        );
        // Top of the label sits just below the lock (center-anchored) icon.
        this._countdown.setPosition(contentCenterX, contentCenterY - lockHalfHeight - 2);
        this._countdown.visible = false;
    }

    sync(): void {
        // GameOverLayer replaces the whole play scene on iOS; hide the radar
        // camera content while the game-over card is up.
        if (this._game.gameOver) {
            if (this.node.isEnabled()) {
                this.node.setEnabled(false);
            }
            return;
        }
        if (!this.node.isEnabled()) {
            this.node.setEnabled(true);
        }

        const floorMin = this._game.params.startFloor;
        const floorMax = this._game.params.stopFloor;
        const floorSpan = Math.max(1, floorMax - floorMin + 1);
        // GameRadarContents.m:230 — available vertical travel for the avatars.
        const clipSlack = 16;
        const pixPerFloor = (RADAR_CONTENT_SIZE.height - clipSlack) / floorSpan;
        const insetX = RADAR_CONTENT_INSET.x;
        const insetY = RADAR_CONTENT_INSET.y;

        const hidden = this._game.radarHiddenFloors > 0;
        if (hidden !== this._hidden) {
            this._hidden = hidden;
            this._lock.visible = hidden;
            this._countdown.visible = hidden;
        }
        if (hidden) {
            this._countdown.setText(String(this._game.radarHiddenFloors));
            this._setAvatarsVisible(false);
            return;
        }

        const own = this._game.own;
        this._own.visible = !own.deathSequencePlaying;
        if (this._own.visible) {
            this._own.setPosition(insetX + this._shaftX[0]!, insetY + (own.floor - floorMin) * pixPerFloor);
            if (own.deathSequencePlaying) {
                this._own.setColor255(118, 118, 118);
            } else {
                this._own.setColor(1, 1, 1);
            }
        }

        this._game.shafts.forEach((shaft, shaftIndex) => {
            const column = this._greens[shaftIndex]!;
            for (let i = 0; i < MAX_ELS_IN_SHAFT; i++) {
                const elevator = shaft.elevators[i]!;
                const avatar = column[i]!;
                const show = elevator.activeInGame;
                avatar.visible = show;
                if (!show) {
                    continue;
                }
                avatar.setPosition(
                    insetX + this._shaftX[shaftIndex + 1]!,
                    insetY + (elevator.floor - floorMin) * pixPerFloor
                );
                if (elevator.passengersOnboard === 0) {
                    avatar.setColor255(118, 118, 118);
                } else {
                    avatar.setColor(1, 1, 1);
                }
            }
        });

        const ceo = this._game.ceo;
        const lastShaftX = this._shaftX[NUM_ELEVATOR_SHAFTS - 1]!;
        const showCeo = ceo.activeInGame && ceo.floor < floorMax;
        this._ceo.visible = showCeo;
        if (showCeo) {
            this._ceo.setPosition(insetX + lastShaftX, insetY + (ceo.floor - floorMin) * pixPerFloor);
        }

        const previewFloor = ceo.floorGoingToPreview;
        const showPreview = this._game.shafts[this._game.shafts.length - 1]!.gettingReadyForCeo && previewFloor !== 0xffff;
        this._ceoPreview.visible = showPreview;
        if (showPreview) {
            this._ceoPreview.setPosition(insetX + lastShaftX, insetY + (previewFloor - floorMin) * pixPerFloor);
        }
    }

    private _setAvatarsVisible(visible: boolean): void {
        this._own.visible = visible;
        this._ceo.visible = visible;
        this._ceoPreview.visible = visible;
        for (const column of this._greens) {
            for (const sprite of column) {
                sprite.visible = visible;
            }
        }
    }

    dispose(): void {
        this.node.dispose();
    }
}
