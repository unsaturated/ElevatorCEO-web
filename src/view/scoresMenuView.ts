// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { audio } from "../audio/audioController";
import { SoundEffect } from "../audio/soundEffect";
import { DESIGN_WIDTH, VERTICAL_BUMP_FOR_16X9 } from "../core/constants";
import { loadHighScores, type GameScore } from "../core/highScores";
import { formatDateTime, formatNumber, t } from "../i18n/locale";
import { LAYER_HUD } from "../render/designSpace";
import type { TouchDispatcher } from "../render/input";
import { Sprite2D } from "../render/sprite2d";
import { LEAGUE_SMALL_STYLE, TextSprite, type TextStyle, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { TweenRunner } from "../render/tween";
import { BarMenu } from "./barMenu";
import { SlideCarousel, type CarouselSlide } from "./slideCarousel";

/** kLeague72White at scale 0.7 (ScoreMenuLayer.m:149-150). */
const TITLE_STYLE: TextStyle = { family: "LeagueGothic", size: 50, color: "#ffffff" };

const MENU_CENTER_X = DESIGN_WIDTH / 2;
/** ScoreMenuLayer.m:84 — the Game Center row is dropped, so BACK sits alone. */
const MENU_CENTER_Y_BACK_ONLY = 20;

const BG_Z = 0;
const LOGO_Z = 1;
const TITLE_Z = 5;
const SCORE_Z = 10;
const MENU_Z = 100;

/** ScoreMenuLayer.m:104-144 — one slide per score, or the empty-state line. */
function buildSlides(scores: readonly GameScore[]): CarouselSlide[] {
    if (scores.length === 0) {
        return [[t("NO_HIGH_SCORES"), "", ""]];
    }
    return scores.map((score) => [
        formatDateTime(score.date),
        `${t("LEVEL_LABEL")} ${score.level}`,
        formatNumber(score.pension),
    ]);
}

/**
 * High-score screen, ported from ScoreMenuLayer.m.
 *
 * The original's GAME CENTER row has no web counterpart and is omitted, the
 * same way OptionsMenuView drops the in-app purchase rows.
 */
export class ScoresMenuView {
    readonly node: TransformNode;

    private readonly _menu: BarMenu;
    private readonly _scores: SlideCarousel;

    private _visible = false;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        touch: TouchDispatcher,
        tweens: TweenRunner,
        private readonly _onBack: () => void
    ) {
        this.node = new TransformNode("scoresMenu", scene);

        new Sprite2D(textures, scene, "high-scores-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: BG_Z,
            layerMask: LAYER_HUD,
        });

        const yBump = VERTICAL_BUMP_FOR_16X9;
        const halfWidth = DESIGN_WIDTH / 2;

        const logo = new Sprite2D(textures, scene, "treasure-scores.png", {
            parent: this.node,
            z: LOGO_Z,
            layerMask: LAYER_HUD,
        });
        logo.setPosition(halfWidth, 220 + yBump);

        const title = new TextSprite(text, scene, t("SCORES_MENU"), TITLE_STYLE, {
            parent: this.node,
            z: TITLE_Z,
            layerMask: LAYER_HUD,
        });
        title.setPosition(halfWidth, 290 + yBump);

        this._scores = new SlideCarousel(scene, text, tweens, {
            parent: this.node,
            style: LEAGUE_SMALL_STYLE,
            x: halfWidth,
            lineY: [150 + yBump, 125 + yBump, 100 + yBump],
            z: SCORE_Z,
            layerMask: LAYER_HUD,
        });

        this._menu = new BarMenu(scene, textures, text, touch, {
            parent: this.node,
            name: "scores",
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

    /** ScoreMenuLayer.m:229-239 — the scores only cycle when there are several. */
    show(): void {
        this._visible = true;
        this.node.setEnabled(true);
        this._scores.setSlides(buildSlides(loadHighScores()));
        this._scores.start();
    }

    hide(): void {
        this._menu.releasePress();
        this._scores.stop();
        this._visible = false;
        this.node.setEnabled(false);
    }

    dispose(): void {
        this._scores.dispose();
        this._menu.dispose();
        this.node.dispose();
    }
}
