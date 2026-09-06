// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import type { App } from "../app";
import type { TextureCache } from "../render/textureCache";
import { MainMenuView } from "../view/mainMenuView";
import { MenuContext } from "./menuContext";

/**
 * Title screen scene, matching ElevatorCEOAppDelegate.m starting at MainMenuLayer.
 */
export class MainMenuScene {
    readonly menu: MainMenuView;

    private readonly _ctx: MenuContext;
    private _offPageHidden: (() => void) | null = null;

    constructor(
        private readonly _app: App,
        textures: TextureCache,
        onPlay: () => void,
        onScores: () => void,
        onMore: () => void
    ) {
        this._ctx = new MenuContext(_app);
        this.menu = new MainMenuView(
            this._ctx.scene,
            textures,
            this._ctx.text,
            this._ctx.touch,
            this._ctx.tweens,
            onPlay,
            onScores,
            onMore
        );
    }

    show(): void {
        this._ctx.activate();
        this.menu.show();
        if (!this._offPageHidden) {
            const observer = this._app.onPageHidden.add((hidden) => this.menu.setPageHidden(hidden));
            this._offPageHidden = () => {
                this._app.onPageHidden.remove(observer);
                this._offPageHidden = null;
            };
        }
    }

    hide(): void {
        this.menu.hide();
        this._ctx.deactivate();
        this._offPageHidden?.();
    }

    dispose(): void {
        this.hide();
        this.menu.dispose();
        this._ctx.dispose();
    }
}
