// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { DESIGN_HEIGHT } from "../core/constants";
import { formatNumber, t } from "../i18n/locale";
import { Sprite2D } from "../render/sprite2d";
import {
    LEAGUE_LARGE_STYLE,
    LEAGUE_SMALL_STYLE,
    TextSprite,
    type TextStyle,
    type TextTextureCache,
} from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { TweenRunner } from "../render/tween";
import { rectContains, type TouchDispatcher, type TouchHandler, type TouchPoint } from "../render/input";

/** GameController.h:39 and AudioController.h:15. */
const DISPLAY_SECONDS = 5.0;
const SLIDE_OFF_SECONDS = 2.056;

const CARD_WIDTH = 240;
const CARD_HEIGHT = DESIGN_HEIGHT;

/** Above every gameplay sprite; the original added the card at z 100. */
const CARD_Z = 100;

/**
 * cocos2d rotates a CCLayer about its anchorPointInPoints, which for a layer is
 * the center of its content box rather than its origin. Positions below are
 * authored exactly as in the Objective-C and then rebased onto that pivot.
 */
const PIVOT_X = CARD_WIDTH / 2;
const PIVOT_Y = CARD_HEIGHT / 2;

/**
 * The card that announces each level, ported from GameLevelTransition.m.
 *
 * Registers at priority -1 like the original so taps on the card itself are
 * absorbed; touches outside the card pass through to gameplay.
 */
export class LevelTransitionView {
    readonly node: TransformNode;

    private readonly _background: Sprite2D;
    private readonly _text: TransformNode;
    private readonly _levelCaption: TextSprite;
    private readonly _levelValue: TextSprite;
    private readonly _floorsCaption: TextSprite;
    private readonly _floorsValue: TextSprite;

    private readonly _gate: TouchHandler;
    private _showing = false;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        private readonly _tweens: TweenRunner,
        private readonly _touch: TouchDispatcher,
        parent: TransformNode | null
    ) {
        this.node = new TransformNode("levelTransition", scene);
        this.node.parent = parent;
        this.node.setEnabled(false);

        this._background = new Sprite2D(textures, scene, "transition.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: CARD_Z,
        });

        // The whole text block is rotated 30 degrees clockwise, as in the
        // original. Babylon measures rotation counter-clockwise.
        this._text = new TransformNode("levelTransitionText", scene);
        this._text.parent = this.node;
        this._text.position.set(-5 + PIVOT_X, 30 + PIVOT_Y, 0);
        this._text.rotation.z = (-30 * Math.PI) / 180;

        this._levelCaption = this._caption(scene, text, t("LEVEL_LABEL"), LEAGUE_LARGE_STYLE, 310);
        this._levelValue = this._caption(scene, text, "1", LEAGUE_LARGE_STYLE, 250);
        this._floorsCaption = this._caption(scene, text, t("FLOORS_LABEL"), LEAGUE_SMALL_STYLE, 170);
        this._floorsValue = this._caption(scene, text, "1 - 50", LEAGUE_SMALL_STYLE, 145);

        this._gate = {
            priority: -1,
            swallowsTouches: false,
            enabled: () => this._showing,
            onBegan: (point) => this._claimsTouch(point),
        };
        this._touch.add(this._gate);
    }

    /** GameLevelTransition.m:141-151 — only the card's bounding box claims input. */
    private _claimsTouch(point: TouchPoint): boolean {
        const origin = this.node.getAbsolutePosition();
        return rectContains(
            {
                left: origin.x,
                right: origin.x + CARD_WIDTH,
                bottom: origin.y,
                top: origin.y + CARD_HEIGHT,
            },
            point.x,
            point.y
        );
    }

    /** Places a line at the y the original used, rebased onto the layer pivot. */
    private _caption(scene: Scene, text: TextTextureCache, value: string, style: TextStyle, y: number): TextSprite {
        const label = new TextSprite(text, scene, value, style, { parent: this._text, z: CARD_Z + 2 });
        label.setPosition(CARD_WIDTH / 2 - PIVOT_X, y - PIVOT_Y);
        return label;
    }

    get showing(): boolean {
        return this._showing;
    }

    /**
     * Slides the card in, holds it, then slides it up off the top. Resolves
     * once gameplay input is live again.
     */
    async show(level: number, floorMin: number, floorMax: number): Promise<void> {
        this._levelValue.setText(String(level));
        this._floorsValue.setText(`${formatNumber(floorMin)} - ${formatNumber(floorMax)}`);

        this._tweens.stopAll(this._background);
        this.node.position.y = 0;
        this.node.setEnabled(true);
        this._showing = true;

        await this._tweens.delay(this._background, DISPLAY_SECONDS);
        await this._tweens.run(this._background, SLIDE_OFF_SECONDS, (t) => {
            this.node.position.y = DESIGN_HEIGHT * t;
        });

        this._showing = false;
        this.node.setEnabled(false);
    }

    dispose(): void {
        this._touch.remove(this._gate);
        this._tweens.stopAll(this._background);
        this._floorsValue.dispose();
        this._floorsCaption.dispose();
        this._levelValue.dispose();
        this._levelCaption.dispose();
        this._text.dispose();
        this._background.dispose();
        this.node.dispose();
    }
}
