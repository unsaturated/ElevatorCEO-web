// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import type { App } from "../app";
import type { TextureCache } from "../render/textureCache";
import { ScoresMenuView } from "../view/scoresMenuView";
import { MenuContext } from "./menuContext";

/**
 * High-score scene, matching ScoreMenuLayer navigation from MainMenuLayer.
 */
export class ScoresMenuScene {
    readonly menu: ScoresMenuView;

    private readonly _ctx: MenuContext;

    constructor(app: App, textures: TextureCache, onBack: () => void) {
        this._ctx = new MenuContext(app);
        this.menu = new ScoresMenuView(
            this._ctx.scene,
            textures,
            this._ctx.text,
            this._ctx.touch,
            this._ctx.tweens,
            onBack
        );
    }

    show(): void {
        this._ctx.activate();
        this.menu.show();
    }

    hide(): void {
        this.menu.hide();
        this._ctx.deactivate();
    }

    dispose(): void {
        this.hide();
        this.menu.dispose();
        this._ctx.dispose();
    }
}
