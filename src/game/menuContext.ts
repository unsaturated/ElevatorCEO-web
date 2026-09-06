// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";

import type { App } from "../app";
import { TouchDispatcher } from "../render/input";
import { TextTextureCache } from "../render/textSprite";
import { TweenRunner } from "../render/tween";

/**
 * The per-screen resources a menu runs on, and the camera swap that reveals it.
 *
 * Each menu owns one of these, so disposing the menu takes its text textures
 * and pending animations with it. While a menu is up only the HUD camera draws:
 * the play-area and radar cameras are parked and put back on the way out, which
 * is what replaces the original's CCDirector scene push.
 */
export class MenuContext {
    readonly text: TextTextureCache;
    readonly touch: TouchDispatcher;
    readonly tweens = new TweenRunner();

    private _parkedCameras: Camera[] | null = null;
    private readonly _offUpdate: () => void;

    constructor(private readonly _app: App) {
        this.text = new TextTextureCache(_app.scene);
        this.touch = new TouchDispatcher(_app.scene, () => _app.letterbox);
        this._offUpdate = _app.onUpdate((dt) => this.tweens.update(dt));
    }

    get scene(): Scene {
        return this._app.scene;
    }

    activate(): void {
        this._parkedCameras = this._app.scene.activeCameras;
        this._app.scene.activeCameras = [this._app.hudCamera];
    }

    deactivate(): void {
        if (this._parkedCameras) {
            this._app.scene.activeCameras = this._parkedCameras;
        }
    }

    dispose(): void {
        this._offUpdate();
        this.touch.dispose();
        this.tweens.stopEverything();
        this.text.dispose();
    }
}
