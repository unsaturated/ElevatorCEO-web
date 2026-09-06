// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { CREDIT_FADE_SEC, CREDIT_HANG_SEC } from "../core/constants";
import { LAYER_HUD } from "../render/designSpace";
import { TextSprite, type TextStyle, type TextTextureCache } from "../render/textSprite";
import type { TweenRunner } from "../render/tween";

/** The three stacked lines of one slide: a heading and two detail rows. */
export type CarouselSlide = readonly [string, string, string];

const BLANK_SLIDE: CarouselSlide = ["", "", ""];

/** Gap between slides, so the next fade-in starts after the last fade-out. */
const SLIDE_INTERVAL_SEC = CREDIT_FADE_SEC + CREDIT_HANG_SEC + CREDIT_FADE_SEC + 0.2;

export interface SlideCarouselOptions {
    parent: TransformNode;
    style: TextStyle;
    /** Center x shared by all three lines. */
    x: number;
    /** y of each line, top to bottom. */
    lineY: readonly [number, number, number];
    z: number;
    layerMask?: number;
}

/**
 * Three centered text lines that cycle through slides, fading each in and out.
 *
 * OptionsMenuLayer.m:356-437 and ScoreMenuLayer.m:258-327 are the same
 * carousel: a CCRepeatForever around fade in / hang / fade out driving three
 * labels, with the first slide already opaque so the screen is never blank on
 * arrival. The credits screen scrolls stanzas through it and the high-score
 * screen scrolls scores, which is the only difference between them.
 */
export class SlideCarousel {
    private readonly _lines: [TextSprite, TextSprite, TextSprite];
    /** Tween owner for the inter-slide delay, which belongs to no one line. */
    private readonly _owner = {};

    private _slides: readonly CarouselSlide[] = [];
    private _slide = 0;
    private _running = false;
    private _firstShowing = true;

    constructor(
        scene: Scene,
        text: TextTextureCache,
        private readonly _tweens: TweenRunner,
        options: SlideCarouselOptions
    ) {
        const line = (y: number): TextSprite => {
            const label = new TextSprite(text, scene, "", options.style, {
                parent: options.parent,
                z: options.z,
                layerMask: options.layerMask ?? LAYER_HUD,
            });
            label.setPosition(options.x, y);
            return label;
        };

        this._lines = [line(options.lineY[0]), line(options.lineY[1]), line(options.lineY[2])];
    }

    setSlides(slides: readonly CarouselSlide[]): void {
        this._slides = slides;
    }

    /** Cycles the slides, or holds a lone slide still with nothing to cut to. */
    start(): void {
        this.stop();
        this._slide = 0;
        this._firstShowing = true;

        if (this._slides.length > 1) {
            void this._run();
        } else {
            this._hold(this._slides[0] ?? BLANK_SLIDE);
        }
    }

    stop(): void {
        this._running = false;
        this._tweens.stopAll(this._owner);
        for (const line of this._lines) {
            this._tweens.stopAll(line);
        }
    }

    dispose(): void {
        this.stop();
        for (const line of this._lines) {
            line.dispose();
        }
    }

    private async _run(): Promise<void> {
        this._running = true;
        while (this._running) {
            void this._flash(this._slide);
            this._slide = (this._slide + 1) % this._slides.length;
            await this._tweens.delay(this._owner, SLIDE_INTERVAL_SEC);
        }
    }

    private async _flash(slide: number): Promise<void> {
        const lines = this._slides[slide] ?? BLANK_SLIDE;
        for (let i = 0; i < this._lines.length; i++) {
            this._lines[i]!.setText(lines[i] ?? "");
        }

        const first = this._firstShowing;
        this._firstShowing = false;

        await Promise.all(this._lines.map((line) => this._animate(line, first)));
    }

    private async _animate(line: TextSprite, first: boolean): Promise<void> {
        this._tweens.stopAll(line);
        if (!first) {
            line.opacity = 0;
            await this._tweens.fadeIn(line, CREDIT_FADE_SEC);
        } else {
            line.opacity = 1;
        }
        await this._tweens.delay(line, CREDIT_HANG_SEC);
        await this._tweens.fadeOut(line, CREDIT_FADE_SEC);
    }

    /** A single slide stays put instead of flashing (ScoreMenuLayer.m:229-239). */
    private _hold(lines: CarouselSlide): void {
        for (let i = 0; i < this._lines.length; i++) {
            const line = this._lines[i]!;
            this._tweens.stopAll(line);
            line.setText(lines[i] ?? "");
            line.opacity = 1;
        }
    }
}
