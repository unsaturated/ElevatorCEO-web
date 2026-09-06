// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { audio } from "../audio/audioController";
import { SoundEffect } from "../audio/soundEffect";
import { DESIGN_WIDTH, VERTICAL_BUMP_FOR_16X9 } from "../core/constants";
import { t } from "../i18n/locale";
import { LAYER_HUD } from "../render/designSpace";
import type { TouchDispatcher } from "../render/input";
import { Sprite2D } from "../render/sprite2d";
import { TextSprite, type TextStyle, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { TweenRunner } from "../render/tween";
import { BarMenu } from "./barMenu";
import { SlideCarousel, type CarouselSlide } from "./slideCarousel";

/** kLeague72White at scale 0.7 (OptionsMenuLayer.m:265-266). */
const TITLE_STYLE: TextStyle = { family: "LeagueGothic", size: 50, color: "#ffffff" };

/** kDroidSansBold13White (OptionsMenuLayer.m:272). */
const CREDIT_LABEL_STYLE: TextStyle = { family: "DroidSans", size: 13, bold: true, color: "#ffffff" };

const MENU_CENTER_X = DESIGN_WIDTH / 2;
/** OptionsMenuLayer.m:123 — back-only menu when ads are removed. */
const MENU_CENTER_Y_BACK_ONLY = 20;

const BG_Z = 0;
const TITLE_Z = 5;
const CREDIT_Z = 10;
const MENU_Z = 100;

/** OptionsMenuLayer.m:141-259 — one credits stanza per slide. */
const CREDIT_KEYS: readonly CarouselSlide[] = [
    ["CREDITS_GAME_DESIGN", "CREDITS_GAME_DESIGN_AUTHOR", "CREDITS_GAME_DESIGN_AUTHOR_URL"],
    ["CREDITS_GAME_ENGINE", "CREDITS_GAME_ENGINE_NAME", "CREDITS_GAME_ENGINE_URL"],
    ["CREDITS_ART", "CREDITS_ARTIST", "CREDITS_ARTIST_URL"],
    ["CREDITS_AUDIO", "CREDITS_AUDIO_VENDOR_NAME_1", "CREDITS_AUDIO_VENDOR_URL_1"],
    ["CREDITS_AUDIO", "CREDITS_AUDIO_VENDOR_NAME_2", "CREDITS_AUDIO_VENDOR_URL_2"],
    ["CREDITS_AUDIO", "CREDITS_AUDIO_VENDOR_NAME_3", "CREDITS_AUDIO_VENDOR_URL_3"],
    ["CREDITS_WEB_FONT", "CREDITS_WEB_FONT_VENDOR", "CREDITS_WEB_FONT_URL"],
];

/** Resolved on the way in, so a locale chosen after boot is picked up. */
function buildSlides(): CarouselSlide[] {
    return CREDIT_KEYS.map(([heading, name, url]): CarouselSlide => [t(heading), t(name), t(url)]);
}

/**
 * Credits / options screen, ported from OptionsMenuLayer.m.
 *
 * The web build has no ad banner (equivalent to adsRemovedByUser), so only
 * the BACK row is shown. IAP restore/remove buttons are omitted.
 */
export class OptionsMenuView {
    readonly node: TransformNode;

    private readonly _menu: BarMenu;
    private readonly _credits: SlideCarousel;

    private _visible = false;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        touch: TouchDispatcher,
        tweens: TweenRunner,
        private readonly _onBack: () => void
    ) {
        this.node = new TransformNode("optionsMenu", scene);

        new Sprite2D(textures, scene, "more-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: BG_Z,
            layerMask: LAYER_HUD,
        });

        const yBump = VERTICAL_BUMP_FOR_16X9;
        const halfWidth = DESIGN_WIDTH / 2;

        const title = new TextSprite(text, scene, t("ELEVATOR_CEO"), TITLE_STYLE, {
            parent: this.node,
            z: TITLE_Z,
            layerMask: LAYER_HUD,
        });
        title.setPosition(halfWidth, 280 + yBump);

        this._credits = new SlideCarousel(scene, text, tweens, {
            parent: this.node,
            style: CREDIT_LABEL_STYLE,
            x: halfWidth,
            lineY: [200 + yBump, 175 + yBump, 150 + yBump],
            z: CREDIT_Z,
            layerMask: LAYER_HUD,
        });

        this._menu = new BarMenu(scene, textures, text, touch, {
            parent: this.node,
            name: "options",
            z: MENU_Z,
            layerMask: LAYER_HUD,
            centerX: MENU_CENTER_X,
            centerY: MENU_CENTER_Y_BACK_ONLY,
            touchPriority: -3,
            active: () => this._visible,
        });
        this._menu.addRow(t("BACK_MENU"), () => {
            audio.playSound(SoundEffect.ClickMenuButton);
            this.hide();
            this._onBack();
        });

        this.node.setEnabled(false);
    }

    /** OptionsMenuLayer.m:326-329 — start the credits carousel on enter. */
    show(): void {
        this._visible = true;
        this.node.setEnabled(true);
        this._credits.setSlides(buildSlides());
        this._credits.start();
    }

    hide(): void {
        this._menu.releasePress();
        this._credits.stop();
        this._visible = false;
        this.node.setEnabled(false);
    }

    dispose(): void {
        this._credits.dispose();
        this._menu.dispose();
        this.node.dispose();
    }
}
