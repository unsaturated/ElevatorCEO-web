// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { audio } from "../audio/audioController";
import { SoundEffect } from "../audio/soundEffect";
import type { App } from "../app";
import { DESIGN_HEIGHT, PLAY_AREA_MARGIN, PLAY_AREA_WIDTH } from "../core/constants";
import { t } from "../i18n/locale";
import { LAYER_WORLD } from "../render/designSpace";
import type { TouchDispatcher } from "../render/input";
import { Sprite2D } from "../render/sprite2d";
import type { TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { Game } from "../sim/game";
import { BarMenu, GAME_MENU_BARS, type MenuRow } from "./barMenu";

/** GameController.h:120 — PAUSE_BG_COLOR ccc4(0, 0, 0, 125). */
const PAUSE_OVERLAY_OPACITY = 125 / 255;

const MENU_CENTER_X = 120;

/** GamePlayLayer.m:144 — above the level transition card at z 100. */
const PAUSE_Z = 300;

/** Above the level transition touch gate (priority -1) so pause menu taps work during intro. */
const PAUSE_TOUCH_PRIORITY = -2;

/**
 * In-game pause menu over the play area, ported from GamePauseLayer.m.
 *
 * GamePlayLayer.m:141-145 parents this at (PLAY_AREA_MARGIN - 1, 0) with z 300.
 * It is the only menu whose rows come and go while it is up: RETIRE reveals a
 * confirmation row above itself, and TUTORIAL collapses out of the stack once
 * the tips have been queued.
 */
export class PauseView {
    readonly node: TransformNode;

    private readonly _menu: BarMenu;
    private readonly _confirm: MenuRow;
    private readonly _retire: MenuRow;
    private readonly _tutorial: MenuRow;
    private readonly _layoutObserver;

    private _visible = false;

    constructor(
        private readonly _app: App,
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        touch: TouchDispatcher,
        private readonly _game: Game,
        private readonly _onContinue: () => void,
        private readonly _onRetire: () => void,
        private readonly _onTutorial: () => void
    ) {
        this.node = new TransformNode("pause", scene);
        this._applyLayout(this._app);
        this._layoutObserver = this._app.onLayoutChanged.add((next) => this._applyLayout(next));
        this.node.setEnabled(false);

        const background = new Sprite2D(textures, scene, "lifebar.png", {
            anchorX: 0,
            anchorY: 0,
            width: PLAY_AREA_WIDTH,
            height: DESIGN_HEIGHT,
            parent: this.node,
            z: PAUSE_Z,
            layerMask: LAYER_WORLD,
        });
        background.setColor(0, 0, 0);
        background.opacity = PAUSE_OVERLAY_OPACITY;

        this._menu = new BarMenu(scene, textures, text, touch, {
            parent: this.node,
            name: "pause",
            bars: GAME_MENU_BARS,
            z: PAUSE_Z + 1,
            layerMask: LAYER_WORLD,
            centerX: MENU_CENTER_X,
            touchPriority: PAUSE_TOUCH_PRIORITY,
            active: () => this._visible,
        });

        this._confirm = this._menu.addRow(t("PAUSE_CONFIRM"), () => this._onRetire());
        this._confirm.visible = false;

        this._retire = this._menu.addRow(t("PAUSE_RETIRE"), () => {
            audio.playSound(SoundEffect.ClickMenuButton);
            this._confirm.visible = !this._confirm.visible;
            this._menu.layout();
        });

        this._tutorial = this._menu.addRow(t("TUTORIAL_MENU"), () => {
            audio.playSound(SoundEffect.ClickMenuButton);
            this._tutorial.enabled = false;
            this._tutorial.collapsed = true;
            this._menu.layout();
            this._onTutorial();
        });

        this._menu.addRow(t("PAUSE_CONTINUE"), () => this._onContinue());
        this._menu.layout();
    }

    show(): void {
        this._confirm.visible = false;
        this._retire.visible = this._game.own.lives > 0;
        this._tutorial.visible = true;
        this._tutorial.enabled = true;
        this._tutorial.collapsed = false;

        this._menu.layout();
        this._visible = true;
        this.node.setEnabled(true);
    }

    hide(): void {
        this._menu.releasePress();
        this._visible = false;
        this.node.setEnabled(false);
    }

    get visible(): boolean {
        return this._visible;
    }

    private _applyLayout(_app: App): void {
        // GamePlayLayer.m:145 — wPause sits at (PLAY_AREA_MARGIN - 1, 0) inside the play layer.
        this.node.position.x = PLAY_AREA_MARGIN - 1;
    }

    dispose(): void {
        this._app.onLayoutChanged.remove(this._layoutObserver);
        this._menu.dispose();
        this.node.dispose();
    }
}
