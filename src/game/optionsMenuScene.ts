// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import type { App } from "../app";
import type { TextureCache } from "../render/textureCache";
import { OptionsMenuView } from "../view/optionsMenuView";
import { MenuContext } from "./menuContext";

/**
 * Credits / options scene, matching OptionsMenuLayer navigation from MainMenuLayer.
 */
export class OptionsMenuScene {
    readonly menu: OptionsMenuView;

    private readonly _ctx: MenuContext;

    constructor(app: App, textures: TextureCache, onBack: () => void) {
        this._ctx = new MenuContext(app);
        this.menu = new OptionsMenuView(
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
