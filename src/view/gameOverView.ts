// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { audio } from "../audio/audioController";
import { SoundEffect } from "../audio/soundEffect";
import { DESIGN_HEIGHT, DESIGN_WIDTH, VERTICAL_BUMP_FOR_16X9 } from "../core/constants";
import { t, formatNumber } from "../i18n/locale";
import { LAYER_OVERLAY } from "../render/designSpace";
import type { TouchDispatcher } from "../render/input";
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
import { BarMenu } from "./barMenu";

/** GameOverLayer.m:116 — full-screen menu, centered on the 320pt canvas. */
const MENU_CENTER_X = DESIGN_WIDTH / 2;

/** kLeague24White tinted ccc3(255, 0, 0) (GameOverLayer.m:37-38). */
const TOP_THREE_STYLE: TextStyle = { family: "LeagueGothic", size: 24, color: "#ff0000" };

/** GameOverLayer.m:39-42 — the badge pulses between these scales, forever. */
const TOP_THREE_PULSE_SEC = 0.7;
const TOP_THREE_SCALE_UP = 1.2;
const TOP_THREE_SCALE_DOWN = 0.8;

const CARD_WIDTH = DESIGN_WIDTH;
const CARD_HEIGHT = DESIGN_HEIGHT;
const PIVOT_X = CARD_WIDTH / 2;
const PIVOT_Y = CARD_HEIGHT / 2;

const BG_Z = 500;
const TEXT_Z = BG_Z + 1;
const MENU_Z = BG_Z + 2;

/**
 * Full-screen game-over card, ported from GameOverLayer.m.
 *
 * Replaces the entire display (like the original scene swap), independent of
 * play-area / control-bar layout. Shows pension, level, and a BACK row.
 */
export class GameOverView {
    readonly node: TransformNode;

    private readonly _text: TransformNode;
    private readonly _titleGame: TextSprite;
    private readonly _titleOver: TextSprite;
    private readonly _topThree: TextSprite;
    private readonly _level: TextSprite;
    private readonly _pension: TextSprite;
    private readonly _menu: BarMenu;

    private _visible = false;
    private _pulsing = false;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        touch: TouchDispatcher,
        private readonly _tweens: TweenRunner,
        private readonly _onBack: () => void
    ) {
        this.node = new TransformNode("gameOver", scene);

        new Sprite2D(textures, scene, "game-over-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: BG_Z,
            layerMask: LAYER_OVERLAY,
        });

        // Rotated League Gothic block, same treatment as the level transition card.
        this._text = new TransformNode("gameOverText", scene);
        this._text.parent = this.node;
        this._text.position.set(-5 + PIVOT_X, 30 + PIVOT_Y, 0);
        this._text.rotation.z = (-30 * Math.PI) / 180;

        const yBump = VERTICAL_BUMP_FOR_16X9;
        this._titleGame = this._caption(text, scene, t("GAME_OVER_GAME"), LEAGUE_LARGE_STYLE, 280 + yBump);
        this._titleOver = this._caption(text, scene, t("GAME_OVER_OVER"), LEAGUE_LARGE_STYLE, 220 + yBump);
        this._topThree = this._caption(text, scene, "", TOP_THREE_STYLE, 160 + yBump);
        this._level = this._caption(text, scene, "", LEAGUE_SMALL_STYLE, 125 + yBump);
        this._pension = this._caption(text, scene, "", LEAGUE_SMALL_STYLE, 100 + yBump);

        this._menu = new BarMenu(scene, textures, text, touch, {
            parent: this.node,
            name: "gameOver",
            z: MENU_Z,
            layerMask: LAYER_OVERLAY,
            centerX: MENU_CENTER_X,
            touchPriority: -2,
            active: () => this._visible,
        });
        this._menu.addRow(t("BACK_MENU"), () => {
            audio.playSound(SoundEffect.ClickMenuButton);
            this.hide();
            this._onBack();
        });

        this.hide();
    }

    /** Places a line at the y the original used, rebased onto the layer pivot. */
    private _caption(
        text: TextTextureCache,
        scene: Scene,
        value: string,
        style: TextStyle,
        y: number
    ): TextSprite {
        const label = new TextSprite(text, scene, value, style, {
            parent: this._text,
            z: TEXT_Z,
            layerMask: LAYER_OVERLAY,
        });
        label.setPosition(CARD_WIDTH / 2 - PIVOT_X, y - PIVOT_Y);
        return label;
    }

    show(pension: number, level: number, topThree: boolean): void {
        this._pension.setText(formatNumber(pension));
        this._level.setText(`${t("LEVEL_LABEL")} ${level}`);
        this._topThree.setText(topThree ? t("TOP_THREE_SCORE") : "");
        this._visible = true;
        this.node.setEnabled(true);
        if (topThree) {
            void this._pulseTopThree();
        }
    }

    hide(): void {
        this._menu.releasePress();
        this._stopPulse();
        this._visible = false;
        this.node.setEnabled(false);
    }

    /** GameOverLayer.m:39-42 — CCRepeatForever around a pair of CCScaleTo. */
    private async _pulseTopThree(): Promise<void> {
        this._stopPulse();
        this._pulsing = true;

        const mesh = this._topThree.mesh;
        let from = 1;
        while (this._pulsing) {
            const to = from === TOP_THREE_SCALE_UP ? TOP_THREE_SCALE_DOWN : TOP_THREE_SCALE_UP;
            const start = from;
            await this._tweens.run(mesh, TOP_THREE_PULSE_SEC, (t) => {
                const scale = start + (to - start) * t;
                mesh.scaling.set(scale, scale, 1);
            });
            from = to;
        }
    }

    private _stopPulse(): void {
        this._pulsing = false;
        this._tweens.stopAll(this._topThree.mesh);
        this._topThree.mesh.scaling.set(1, 1, 1);
    }

    get visible(): boolean {
        return this._visible;
    }

    dispose(): void {
        this._stopPulse();
        this._menu.dispose();
        this._pension.dispose();
        this._level.dispose();
        this._topThree.dispose();
        this._titleOver.dispose();
        this._titleGame.dispose();
        this._text.dispose();
        this.node.dispose();
    }
}
