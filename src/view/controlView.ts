// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import type { App } from "../app";
import { audio } from "../audio/audioController";
import { SoundEffect } from "../audio/soundEffect";
import {
    BUTTON_MAX_TAP_TIME,
    BUTTON_MIN_SPEED,
    BUTTON_TIME_INTERVAL,
    CONTROL_BAR_WIDTH,
    COUNT_SYNERGY_BARS,
    DESIGN_HEIGHT,
    GREEN_SYNERGY_BARS,
    NUM_LIFE_INDICATORS,
    PLAY_AREA_MARGIN,
    RED_SYNERGY_BARS,
    SPEED_FOR_BUTTON_TAP,
    SWAP_CONTROL_DURATION,
    SWAP_CONTROL_ROTATION_DURATION,
    SWAP_CONTROL_SCALE_DIP,
    YELLOW_SYNERGY_BARS,
} from "../core/constants";
import { formatNumber, t } from "../i18n/locale";
import { LAYER_HUD } from "../render/designSpace";
import { circleContains, type TouchDispatcher, type TouchHandler } from "../render/input";
import { Sprite2D } from "../render/sprite2d";
import { TextSprite, type TextStyle, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { TweenRunner } from "../render/tween";
import type { Game } from "../sim/game";

const LABEL_STYLE: TextStyle = { family: "DroidSans", size: 13, bold: true, color: "#ffffff" };
const VALUE_STYLE: TextStyle = { family: "DroidSans", size: 11, color: "#ffffff" };

const RED = { r: 237 / 255, g: 39 / 255, b: 0 };
const YELLOW = { r: 239 / 255, g: 255 / 255, b: 34 / 255 };
const GREEN = { r: 17 / 255, g: 211 / 255, b: 63 / 255 };
const GRAY = { r: 81 / 255, g: 81 / 255, b: 81 / 255 };

/** GameController.h:120 — PAUSE_BG_COLOR ccc4(0, 0, 0, 125). */
const PAUSE_OVERLAY_OPACITY = 125 / 255;

/**
 * The 80pt control bar: status, synergy, up/down, music/sound/pause/swap.
 * Positions are from GameControlLayer.m / GameStatus.m for the 16x9 path.
 */
export class ControlView {
    readonly node: TransformNode;

    /** Player's music toggle, independent of whether autoplay has started yet. */
    get musicDesired(): boolean {
        return this._musicDesired;
    }

    private readonly _navbar: Sprite2D;
    private readonly _scoreBg: Sprite2D;
    private readonly _hearts: Sprite2D[] = [];
    private readonly _grayBars: Sprite2D[] = [];
    private readonly _colorBars: Sprite2D[] = [];
    private readonly _pension: TextSprite;
    private readonly _level: TextSprite;

    private readonly _upOff: Sprite2D;
    private readonly _upOn: Sprite2D;
    private readonly _downOff: Sprite2D;
    private readonly _downOn: Sprite2D;

    private readonly _musicOn: Sprite2D;
    private readonly _musicOff: Sprite2D;
    private readonly _soundOn: Sprite2D;
    private readonly _soundOff: Sprite2D;
    private readonly _pause: Sprite2D;
    private readonly _swap: Sprite2D;

    private readonly _pauseDim: Sprite2D;

    private readonly _handlers: TouchHandler[] = [];
    private readonly _layoutObserver;

    private _up = { down: false, sum: 0, value: 0 };
    private _down = { down: false, sum: 0, value: 0 };
    private _prevSynergyBars = COUNT_SYNERGY_BARS;
    private _blinkingBar: Sprite2D | null = null;
    private _cascadeToken = 0;
    private _musicDesired = true;
    private _soundDesired = true;
    private _swapping = false;
    private _lastPension = 0;
    private _pensionFlashToken = 0;

    constructor(
        private readonly _app: App,
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        private readonly _tweens: TweenRunner,
        private readonly _touch: TouchDispatcher,
        private readonly _game: Game,
        private readonly _worldNode: TransformNode,
        private readonly _onPauseToggle: (paused: boolean) => void
    ) {
        this.node = new TransformNode("control", scene);
        this._applyLayout();

        this._navbar = new Sprite2D(textures, scene, "navbar-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: 0,
            layerMask: LAYER_HUD,
        });
        // GameControlLayer.m:40 — stretch the 480pt art to 568.
        this._navbar.setScale(1, DESIGN_HEIGHT / this._navbar.height);

        this._scoreBg = new Sprite2D(textures, scene, "radar-score-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: 1,
            layerMask: LAYER_HUD,
        });
        this._scoreBg.setPosition(-2, 2);

        // Synergy bars at (12, 86) relative to status, which sits at (-2, 2).
        const barOriginX = 10;
        const barOriginY = 88;
        for (let i = 0; i < COUNT_SYNERGY_BARS; i++) {
            const gray = new Sprite2D(textures, scene, "lifebar.png", {
                anchorX: 0,
                anchorY: 0,
                parent: this.node,
                z: 4,
                layerMask: LAYER_HUD,
            });
            gray.setColor(GRAY.r, GRAY.g, GRAY.b);
            gray.setScale(1, 1.2);
            gray.setPosition(barOriginX + (i + 1) * 3, barOriginY);
            this._grayBars.push(gray);
        }

        const colors = [
            ...Array.from({ length: RED_SYNERGY_BARS }, () => RED),
            ...Array.from({ length: YELLOW_SYNERGY_BARS }, () => YELLOW),
            ...Array.from({ length: GREEN_SYNERGY_BARS }, () => GREEN),
        ];
        for (let i = 0; i < COUNT_SYNERGY_BARS; i++) {
            const bar = new Sprite2D(textures, scene, "lifebar.png", {
                anchorX: 0,
                anchorY: 0,
                parent: this.node,
                z: 5,
                layerMask: LAYER_HUD,
            });
            const color = colors[i]!;
            bar.setColor(color.r, color.g, color.b);
            bar.setScale(1, 1.2);
            bar.setPosition(barOriginX + (i + 1) * 3, barOriginY);
            bar.visible = false;
            this._colorBars.push(bar);
        }

        for (let i = 0; i < NUM_LIFE_INDICATORS; i++) {
            const heart = new Sprite2D(textures, scene, "heart.png", {
                parent: this.node,
                z: 5,
                layerMask: LAYER_HUD,
            });
            heart.scale = 0.8;
            heart.setPosition(20 + i * 20, 132);
            heart.visible = false;
            this._hearts.push(heart);
        }

        const label = (str: string, x: number, y: number, style: TextStyle): TextSprite => {
            const sprite = new TextSprite(text, scene, str, style, {
                parent: this.node,
                z: 6,
                layerMask: LAYER_HUD,
            });
            sprite.setPosition(x, y);
            return sprite;
        };

        label(t("SYNERGY_LABEL"), 40, 104, LABEL_STYLE);
        label(t("PENSION_LABEL"), 40, 68, LABEL_STYLE);
        this._pension = label("0", 40, 54, VALUE_STYLE);
        label(t("LEVEL_LABEL"), 40, 32, LABEL_STYLE);
        this._level = label("1", 40, 18, VALUE_STYLE);

        // Up / down buttons — GameControlLayer.m:139-149.
        this._upOff = new Sprite2D(textures, scene, "up-off-game.png", {
            parent: this.node,
            z: 10,
            layerMask: LAYER_HUD,
        });
        this._upOn = new Sprite2D(textures, scene, "up-on-game.png", {
            parent: this.node,
            z: 11,
            layerMask: LAYER_HUD,
        });
        this._upOn.visible = false;
        this._upOff.setPosition(40, DESIGN_HEIGHT / 2 + 40);
        this._upOn.setPosition(40, DESIGN_HEIGHT / 2 + 40);

        this._downOff = new Sprite2D(textures, scene, "down-off-game.png", {
            parent: this.node,
            z: 10,
            layerMask: LAYER_HUD,
        });
        this._downOn = new Sprite2D(textures, scene, "down-on-game.png", {
            parent: this.node,
            z: 11,
            layerMask: LAYER_HUD,
        });
        this._downOn.visible = false;
        this._downOff.setPosition(40, DESIGN_HEIGHT / 2 - 40);
        this._downOn.setPosition(40, DESIGN_HEIGHT / 2 - 40);

        this._musicOn = this._icon(textures, scene, "music-on.png", 20, DESIGN_HEIGHT - 174);
        this._musicOff = this._icon(textures, scene, "music-off.png", 20, DESIGN_HEIGHT - 174);
        this._musicOff.visible = false;
        this._soundOn = this._icon(textures, scene, "sound-on.png", 60, DESIGN_HEIGHT - 174);
        this._soundOff = this._icon(textures, scene, "sound-off.png", 60, DESIGN_HEIGHT - 174);
        this._soundOff.visible = false;
        this._pause = this._icon(textures, scene, "pause.png", 20, 174);
        this._swap = this._icon(textures, scene, "swap.png", 60, 174);

        // GameControlLayer.m:568-572 — dim the control bar while paused.
        this._pauseDim = new Sprite2D(textures, scene, "lifebar.png", {
            anchorX: 0,
            anchorY: 0,
            width: CONTROL_BAR_WIDTH,
            height: DESIGN_HEIGHT,
            parent: this.node,
            z: 1000,
            layerMask: LAYER_HUD,
        });
        this._pauseDim.setColor(0, 0, 0);
        this._pauseDim.opacity = PAUSE_OVERLAY_OPACITY;
        this._pauseDim.visible = false;

        this._bindButtons();
        this._applyLayout();
        this._layoutObserver = _app.onLayoutChanged.add(() => this._applyLayout());

        this.sync();
    }

    private _icon(textures: TextureCache, scene: Scene, frame: string, x: number, y: number): Sprite2D {
        const sprite = new Sprite2D(textures, scene, frame, {
            parent: this.node,
            z: 12,
            layerMask: LAYER_HUD,
        });
        sprite.setPosition(x, y);
        return sprite;
    }

    private _applyLayout(): void {
        this.node.position.x = this._app.controlOnLeft ? 0 : 240;
        this.node.position.y = 0;
        if (this._swap) {
            this._swap.rotation = this._app.controlOnLeft ? 180 : 0;
        }
    }

    private _bindButtons(): void {
        const upRadius = this._upOff.width / 2;
        const downRadius = this._downOff.width / 2;

        this._handlers.push(
            this._touch.add({
                priority: 0,
                swallowsTouches: false,
                onBegan: (point) => {
                    const local = this._toLocal(point.x, point.y);
                    if (circleContains(40, DESIGN_HEIGHT / 2 + 40, upRadius, local.x, local.y)) {
                        return this._beginDirectional(true);
                    }
                    if (circleContains(40, DESIGN_HEIGHT / 2 - 40, downRadius, local.x, local.y)) {
                        return this._beginDirectional(false);
                    }
                    return this._handleChromeTap(local.x, local.y);
                },
                onMoved: (point) => {
                    const local = this._toLocal(point.x, point.y);
                    if (this._up.down && !circleContains(40, DESIGN_HEIGHT / 2 + 40, upRadius, local.x, local.y)) {
                        this._releaseDirectional(true, false);
                    }
                    if (this._down.down && !circleContains(40, DESIGN_HEIGHT / 2 - 40, downRadius, local.x, local.y)) {
                        this._releaseDirectional(false, false);
                    }
                },
                onEnded: () => {
                    if (this._up.down) {
                        this._releaseDirectional(true, true);
                    }
                    if (this._down.down) {
                        this._releaseDirectional(false, true);
                    }
                },
                onCanceled: () => {
                    if (this._up.down) {
                        this._releaseDirectional(true, false);
                    }
                    if (this._down.down) {
                        this._releaseDirectional(false, false);
                    }
                },
            })
        );
    }

    private _toLocal(x: number, y: number): { x: number; y: number } {
        return { x: x - this.node.position.x, y: y - this.node.position.y };
    }

    private _beginDirectional(up: boolean): boolean {
        if (this._game.paused || this._game.gameOver) {
            return true;
        }
        const allowable = up ? this._game.own.isUpControlAllowable : this._game.own.isDownControlAllowable;
        if (!allowable) {
            this._game.events.emit({ type: "buttonInvalid" });
            return true;
        }
        const state = up ? this._up : this._down;
        state.down = true;
        state.sum = 0;
        state.value = 0;
        if (up) {
            this._upOn.visible = true;
        } else {
            this._downOn.visible = true;
        }
        return true;
    }

    private _releaseDirectional(up: boolean, fireTap: boolean): void {
        const state = up ? this._up : this._down;
        if (!state.down) {
            return;
        }
        const wasTap = fireTap && state.sum > 0 && state.sum <= BUTTON_MAX_TAP_TIME && state.value === 0;
        const hadHoldSpeed = state.value > 0;
        state.down = false;
        state.sum = 0;
        state.value = 0;
        if (up) {
            this._upOn.visible = false;
        } else {
            this._downOn.visible = false;
        }

        if (wasTap) {
            this._game.events.emit({ type: "buttonTap" });
            this._game.moveOwnElevator(true, SPEED_FOR_BUTTON_TAP, !up);
        } else if (hadHoldSpeed || fireTap) {
            // Hold released, the finger slid off the button, or the shaft hit a
            // limit and setPressIsAllowable went false (GameUpDownButton.m:177-242
            // zeroes mCurrentValue and notifies the delegate).
            this._game.moveOwnElevator(false, 0, !up);
        }
    }

    private _handleChromeTap(x: number, y: number): boolean {
        const hit = (sprite: Sprite2D): boolean => {
            const box = sprite.boundingBox();
            return x >= box.left && x <= box.right && y >= box.bottom && y <= box.top;
        };

        if (this._game.paused || this._game.gameOver) {
            return false;
        }

        if (hit(this._musicOn) || hit(this._musicOff)) {
            this._musicDesired = !this._musicDesired;
            if (this._musicDesired) {
                audio.musicOn();
            } else {
                audio.musicOff();
            }
            this._syncToggles();
            audio.playSound(SoundEffect.ClickMenuButton);
            return true;
        }
        if (hit(this._soundOn) || hit(this._soundOff)) {
            this._soundDesired = !this._soundDesired;
            if (this._soundDesired) {
                audio.soundOn();
            } else {
                audio.soundOff();
            }
            this._syncToggles();
            audio.playSound(SoundEffect.ClickMenuButton);
            return true;
        }
        if (hit(this._pause)) {
            audio.playSound(SoundEffect.ClickMenuButton);
            // GameControlLayer.m:214-216 — pause button only enters pause.
            if (!this._game.paused) {
                this._onPauseToggle(true);
            }
            return true;
        }
        if (hit(this._swap)) {
            // GameControlLayer.m:220-224, 239-282
            if (!this._game.paused && !this._swapping) {
                void this.swapControlSide();
            }
            return true;
        }
        return false;
    }

    private _syncToggles(): void {
        this._musicOn.visible = this._musicDesired;
        this._musicOff.visible = !this._musicDesired;
        this._soundOn.visible = this._soundDesired;
        this._soundOff.visible = !this._soundDesired;
    }

    /** Advances hold-to-accelerate timers. Call once per frame. */
    update(dt: number): void {
        if (this._game.paused || this._game.gameOver) {
            return;
        }
        this._tickDirectional(true, dt);
        this._tickDirectional(false, dt);
    }

    private _tickDirectional(up: boolean, dt: number): void {
        const state = up ? this._up : this._down;
        const allowable = up ? this._game.own.isUpControlAllowable : this._game.own.isDownControlAllowable;
        if (!state.down || !allowable) {
            if (state.down && !allowable) {
                this._releaseDirectional(up, false);
            }
            return;
        }

        const maxSpeed = Math.max(BUTTON_MIN_SPEED, this._game.params.elevatorSpeed);
        const prev = state.value;
        state.sum += dt;

        if (state.sum >= (state.value + 1) * BUTTON_TIME_INTERVAL && state.sum > BUTTON_MAX_TAP_TIME) {
            if (state.value + 1 <= maxSpeed) {
                state.value++;
            }
        }

        if (state.value !== prev && state.value > 0) {
            if (state.value === 1) {
                this._game.events.emit({ type: "elevatorStart" });
            }
            this._game.moveOwnElevator(false, state.value, !up);
        }
    }

    /** Mirrors GameControlLayer.update: synergy, lives, level, pension. */
    sync(): void {
        // GameOverLayer replaces the whole scene on iOS; hide the control bar
        // while the game-over card is up.
        if (this._game.gameOver) {
            if (this.node.isEnabled()) {
                this.node.setEnabled(false);
            }
            return;
        }
        if (!this.node.isEnabled()) {
            this.node.setEnabled(true);
        }

        const pension = this._game.pension;
        this._pension.setText(formatNumber(pension));
        if (pension !== this._lastPension) {
            // GameStatus.m:219-222 — green flash on a gain, red on a loss,
            // then back to white. 0.4s each way.
            if (pension > this._lastPension) {
                void this._flashPension(0, 255, 0);
            } else if (pension < this._lastPension) {
                void this._flashPension(255, 0, 0);
            }
            this._lastPension = pension;
        }
        this._level.setText(String(this._game.level));

        for (let i = 0; i < NUM_LIFE_INDICATORS; i++) {
            this._hearts[i]!.visible = i < this._game.own.lives;
        }

        const synergy = Math.max(0, Math.min(100, this._game.own.synergy));
        let visible = 0;
        for (let i = 0; i < COUNT_SYNERGY_BARS; i++) {
            const start = i * (100 / COUNT_SYNERGY_BARS);
            if (synergy > start) {
                visible++;
            }
        }

        const lastBarsVisible = this._prevSynergyBars;
        this._prevSynergyBars = visible;

        // Turn off bars above the active level and stop any tweens running on them (GameSynergy.m:134-138)
        for (let i = visible; i < COUNT_SYNERGY_BARS; i++) {
            const bar = this._colorBars[i]!;
            this._tweens.stopAll(bar);
            bar.visible = false;
            if (this._blinkingBar === bar) {
                this._blinkingBar = null;
            }
        }

        // If there are no yellow bars, it's time to go on alert (GameSynergy.m:146-166)
        if (visible <= RED_SYNERGY_BARS && visible < lastBarsVisible && visible > 0) {
            const lastRed = this._colorBars[visible - 1]!;
            this._cascadeGrayBars();

            // Play low synergy alert only if this is the first red bar
            if (lastBarsVisible > RED_SYNERGY_BARS) {
                this._game.events.emit({ type: "lowSynergy" });
            }

            this._tweens.stopAll(lastRed);
            this._blinkingBar = lastRed;
            void this._tweens.blink(lastRed, 20, 10.0).then(() => {
                if (this._blinkingBar === lastRed) {
                    this._blinkingBar = null;
                    lastRed.visible = true;
                }
            });
        }

        // Stop all previously running actions for red bars when synergy increases (GameSynergy.m:169-176)
        if (visible > lastBarsVisible && visible <= RED_SYNERGY_BARS + 1) {
            for (let i = 0; i < lastBarsVisible; i++) {
                const bar = this._colorBars[i]!;
                this._tweens.stopAll(bar);
                if (this._blinkingBar === bar) {
                    this._blinkingBar = null;
                }
            }
        }

        // Maintain visibility for active non-blinking bars
        for (let i = 0; i < visible; i++) {
            const bar = this._colorBars[i]!;
            if (bar !== this._blinkingBar) {
                bar.visible = true;
            }
        }

        this._pauseDim.visible = this._game.paused;
        this._syncToggles();
    }

    /** GameStatus.m:219-222 — CCTintTo the highlight, then back to white. */
    private async _flashPension(r: number, g: number, b: number): Promise<void> {
        const token = ++this._pensionFlashToken;
        this._tweens.stopAll(this._pension);
        await this._tweens.tintTo(this._pension, r, g, b, 0.4);
        if (token !== this._pensionFlashToken) {
            return;
        }
        await this._tweens.tintTo(this._pension, 255, 255, 255, 0.4);
    }

    /** Cascades gray bar fade-out and fade-in from right to left (GameSynergy.m:150-159). */
    private _cascadeGrayBars(): void {
        const token = ++this._cascadeToken;
        for (let j = 1; j <= COUNT_SYNERGY_BARS; j++) {
            const index = COUNT_SYNERGY_BARS - j;
            const gray = this._grayBars[index]!;
            const delay = (j - 1) * 0.05;
            this._tweens.stopAll(gray);
            gray.opacity = 1;
            void (async () => {
                if (delay > 0) {
                    await this._tweens.delay(gray, delay);
                }
                if (this._cascadeToken !== token) {
                    return;
                }
                await this._tweens.fadeOut(gray, 0.1);
                if (this._cascadeToken !== token) {
                    return;
                }
                await this._tweens.fadeIn(gray, 0.1);
                if (this._cascadeToken === token) {
                    gray.opacity = 1;
                }
            })();
        }
    }

    private _stopGrayCascade(): void {
        this._cascadeToken++;
        for (const gray of this._grayBars) {
            this._tweens.stopAll(gray);
            gray.opacity = 1;
        }
    }

    /**
     * Port of GameControlLayer.m:239-282 (swapControlSide).
     * Tweens the control layer and play area positions, pulses the control scale,
     * and rotates the swap button.
     */
    async swapControlSide(): Promise<void> {
        this._swapping = true;
        const playLayerNowOnLeft = Math.abs(this._worldNode.position.x - -PLAY_AREA_MARGIN) <= 1.0;

        const targetControlX = playLayerNowOnLeft ? 0 : 240;
        const targetPlayX = playLayerNowOnLeft ? CONTROL_BAR_WIDTH : -PLAY_AREA_MARGIN;
        const targetRotation = playLayerNowOnLeft ? 180.0 : 0.0;

        audio.playSound(SoundEffect.SwapControlSides);

        const startControlX = this.node.position.x;
        const startPlayX = this._worldNode.position.x;

        // 1. Rotate swap icon over SWAP_CONTROL_ROTATION_DURATION (duration * 1.3)
        const rotatePromise = this._tweens.rotateTo(
            this._swap,
            targetRotation,
            SWAP_CONTROL_ROTATION_DURATION
        );

        // 2. Play area moves to targetPlayX
        const movePlayPromise = this._tweens.run(
            this._worldNode,
            SWAP_CONTROL_DURATION,
            (t) => {
                this._worldNode.position.x = startPlayX + (targetPlayX - startPlayX) * t;
            }
        );

        // 3. Control layer moves to targetControlX with scale dip (1.0 -> 0.8 -> 1.0)
        const moveControlPromise = this._tweens.run(
            this.node,
            SWAP_CONTROL_DURATION,
            (t) => {
                this.node.position.x = startControlX + (targetControlX - startControlX) * t;

                // Two-phase scale: 0..0.5 drops to SWAP_CONTROL_SCALE_DIP, 0.5..1.0 returns to 1.0
                const scale =
                    t < 0.5
                        ? 1.0 - (1.0 - SWAP_CONTROL_SCALE_DIP) * (t / 0.5)
                        : SWAP_CONTROL_SCALE_DIP + (1.0 - SWAP_CONTROL_SCALE_DIP) * ((t - 0.5) / 0.5);
                this.node.scaling.set(scale, scale, 1);
            }
        );

        await Promise.all([rotatePromise, movePlayPromise, moveControlPromise]);

        this.node.scaling.set(1, 1, 1);
        this.node.position.x = targetControlX;
        this._worldNode.position.x = targetPlayX;

        this._app.setControlOnLeft(playLayerNowOnLeft);
        this._swapping = false;
    }

    dispose(): void {
        this._stopGrayCascade();
        this._pensionFlashToken++;
        this._tweens.stopAll(this._pension);
        for (const bar of this._colorBars) {
            this._tweens.stopAll(bar);
        }
        for (const gray of this._grayBars) {
            this._tweens.stopAll(gray);
        }
        this._app.onLayoutChanged.remove(this._layoutObserver);
        for (const handler of this._handlers) {
            this._touch.remove(handler);
        }
        this._handlers.length = 0;
        this.node.dispose();
    }
}
