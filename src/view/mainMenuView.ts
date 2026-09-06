// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { audio } from "../audio/audioController";
import { SoundEffect } from "../audio/soundEffect";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../core/constants";
import { t } from "../i18n/locale";
import { LAYER_HUD } from "../render/designSpace";
import type { TouchDispatcher } from "../render/input";
import { Sprite2D } from "../render/sprite2d";
import type { TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import { TweenRunner } from "../render/tween";
import { BarMenu } from "./barMenu";

const MENU_CENTER_X = DESIGN_WIDTH / 2;
const MENU_CENTER_Y = 60;

const BG_Z = 0;
const ELEVATOR_Z = 21;
const MENU_Z = 100;

/**
 * Title-screen main menu, ported from MainMenuLayer.m.
 *
 * Shows the intro background, three menu rows, and the large elevator demo
 * that flies up the shaft while scaling in.
 */
export class MainMenuView {
    readonly node: TransformNode;

    private readonly _menu: BarMenu;
    private readonly _elevator: TransformNode;
    private readonly _elevatorCar: Sprite2D;
    private readonly _booster: Sprite2D;
    private readonly _tweens: TweenRunner;

    private _visible = false;
    private _playClicked = false;
    private _burning = false;
    private _demoRunning = false;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        touch: TouchDispatcher,
        tweens: TweenRunner,
        private readonly _onPlay: () => void,
        private readonly _onScores: () => void,
        private readonly _onMore: () => void
    ) {
        this._tweens = tweens;
        this.node = new TransformNode("mainMenu", scene);

        new Sprite2D(textures, scene, "intro-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: BG_Z,
            layerMask: LAYER_HUD,
        });

        this._elevator = new TransformNode("mainMenuElevator", scene);
        this._elevator.parent = this.node;
        this._elevator.setEnabled(false);

        this._elevatorCar = new Sprite2D(textures, scene, "el-red.png", {
            parent: this._elevator,
            z: ELEVATOR_Z + 1,
            layerMask: LAYER_HUD,
        });

        // MainMenuLargeElevator.m:27-30 — full-size booster under the car.
        this._booster = new Sprite2D(textures, scene, "burner.png", {
            anchorX: 0.5,
            anchorY: 1,
            parent: this._elevator,
            z: ELEVATOR_Z,
            layerMask: LAYER_HUD,
        });
        this._booster.setPosition(0, -30);

        this._menu = new BarMenu(scene, textures, text, touch, {
            parent: this.node,
            name: "mainMenu",
            z: MENU_Z,
            layerMask: LAYER_HUD,
            centerX: MENU_CENTER_X,
            centerY: MENU_CENTER_Y,
            touchPriority: -3,
            active: () => this._visible && !this._playClicked,
        });
        this._menu.addRow(t("PLAY_MENU"), () => this._tapPlay());
        this._menu.addRow(t("SCORES_MENU"), () => this._tapNav(this._onScores));
        this._menu.addRow(t("MORE_MENU"), () => this._tapNav(this._onMore));

        this.node.setEnabled(false);
    }

    /** MainMenuLayer.m:151-164 — intro loop and elevator demo on enter. */
    show(): void {
        this._visible = true;
        this._playClicked = false;
        this.node.setEnabled(true);
        audio.musicOff();
        audio.playSound(SoundEffect.IntroLoop);
        void this._beginDemo();
    }

    hide(): void {
        this._menu.releasePress();
        this._stopDemo();
        this._visible = false;
        this.node.setEnabled(false);
    }

    /**
     * Pause the intro loop while the tab or PWA is backgrounded, and resume
     * it when the player returns. Same onPageHidden hook as GameScene; the
     * native app silenced this via the audio session on resign-active.
     */
    setPageHidden(hidden: boolean): void {
        if (!this._visible || this._playClicked) {
            return;
        }
        if (hidden) {
            audio.pauseSound(SoundEffect.IntroLoop);
        } else {
            audio.resumeSound(SoundEffect.IntroLoop);
        }
    }

    /** MainMenuLayer.m:193-206 — only one Play transition. */
    private _tapPlay(): void {
        if (this._playClicked) {
            return;
        }
        this._playClicked = true;
        audio.stopSound(SoundEffect.IntroLoop);
        audio.playSound(SoundEffect.ClickMenuButton);
        this._stopDemo();
        this.hide();
        this._onPlay();
    }

    private _tapNav(callback: () => void): void {
        if (this._playClicked) {
            return;
        }
        audio.stopSound(SoundEffect.IntroLoop);
        audio.playSound(SoundEffect.ClickMenuButton);
        this._stopDemo();
        this.hide();
        callback();
    }

    /** MainMenuLargeElevator.m:42-60 — fly up while scaling from tiny to huge. */
    private async _beginDemo(): Promise<void> {
        this._stopDemo();

        const startX = 210;
        const startY = -30;
        const stopY = DESIGN_HEIGHT + 50 + 300;
        const moveDuration = 3.0;
        const scaleDuration = moveDuration * 1.6;

        this._elevator.setEnabled(true);
        this._elevator.position.x = startX;
        this._elevator.position.y = startY;
        this._elevator.scaling.set(0.05, 0.05, 1);
        this._elevatorCar.visible = true;

        this._demoRunning = true;
        audio.playSound(SoundEffect.Booster);
        void this._burn(true);

        await Promise.all([
            this._tweens.run(this._elevator, moveDuration, (t) => {
                this._elevator.position.y = startY + (stopY - startY) * t;
            }),
            this._tweens.run(this._elevator, scaleDuration, (t) => {
                const scale = 0.05 + (2.2 - 0.05) * t;
                this._elevator.scaling.set(scale, scale, 1);
            }),
        ]);

        if (this._demoRunning) {
            this._elevator.setEnabled(false);
            void this._burn(false);
        }
    }

    private _stopDemo(): void {
        this._demoRunning = false;
        this._tweens.stopAll(this._elevator);
        this._elevator.setEnabled(false);
        void this._burn(false);
    }

    /** BoosterAnimation pulse, scaled for the menu car (factor 1.0). */
    private async _burn(activate: boolean): Promise<void> {
        if (activate === this._burning) {
            return;
        }
        this._burning = activate;

        if (!activate) {
            this._tweens.stopAll(this._booster);
            await this._tweens.fadeOut(this._booster, 0.5);
            return;
        }

        await this._tweens.fadeIn(this._booster, 0.2);
        while (this._burning) {
            await this._tweens.run(this._booster, 0.15, (t) => {
                this._booster.setScale(1 - 0.15 * t, 1 - 0.4 * t);
            });
            if (!this._burning) {
                break;
            }
            await this._tweens.run(this._booster, 0.15, (t) => {
                this._booster.setScale(0.85 + 0.15 * t, 0.6 + 0.4 * t);
            });
        }
    }

    dispose(): void {
        this._stopDemo();
        this._menu.dispose();
        this.node.dispose();
    }
}
