// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { BounceEase, EasingFunction, ElasticEase, SineEase } from "@babylonjs/core/Animations/easing";
import type { IEasingFunction } from "@babylonjs/core/Animations/easing";

import type { Sprite2D } from "./sprite2d";

/** Position and uniform scale, so Sprite2D and TextSprite share move/scale tweens. */
export interface Transformable {
    x: number;
    y: number;
    scale: number;
}

/** RGB 0..1, so Sprite2D and TextSprite share CCTintTo. */
export interface Tintable {
    readonly color: { r: number; g: number; b: number };
    setColor(r: number, g: number, b: number): unknown;
}

/**
 * Replacement for cocos2d's CCAction combinators.
 *
 * The original nested CCSequence/CCSpawn/CCDelayTime/CCCallFunc trees at 63
 * call sites. Here each tween returns a promise, so a sequence is an `await`
 * chain and a spawn is `Promise.all` - the composition lives in ordinary
 * control flow rather than in an action graph.
 *
 * Babylon's built-in easing curves are used directly, so the motion matches:
 * CCEaseBounceOut -> BounceEase(EASEOUT), CCEaseElasticIn -> ElasticEase(EASEIN),
 * CCEaseInOut -> SineEase(EASEINOUT).
 */

export const Easing = {
    linear: null as IEasingFunction | null,

    /** CCEaseBounceOut, used for elevator and floor settle. */
    bounceOut: (() => {
        const ease = new BounceEase(3, 2);
        ease.setEasingMode(EasingFunction.EASINGMODE_EASEOUT);
        return ease as IEasingFunction;
    })(),

    /** CCEaseElasticIn, used for the death-sequence fall. */
    elasticIn: (() => {
        const ease = new ElasticEase(3, 3);
        ease.setEasingMode(EasingFunction.EASINGMODE_EASEIN);
        return ease as IEasingFunction;
    })(),

    /** CCEaseInOut, used for the menu demo elevator. */
    easeInOut: (() => {
        const ease = new SineEase();
        ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
        return ease as IEasingFunction;
    })(),
} as const;

/** Anything with an opacity, so both Sprite2D and TextSprite can be faded. */
export interface Fadeable {
    opacity: number;
}

interface ActiveTween {
    elapsed: number;
    duration: number;
    ease: IEasingFunction | null;
    apply: (t: number) => void;
    resolve: () => void;
    canceled: boolean;
    /** Tweens are grouped by owner so a node's animations can be stopped together. */
    owner: object;
}

/**
 * Drives all running tweens from the game's own update loop rather than
 * Babylon's animation system, so a single paused clock stops gameplay motion
 * and animation together, the way CCDirector.pause did.
 */
export class TweenRunner {
    private _tweens: ActiveTween[] = [];
    private _paused = false;

    get paused(): boolean {
        return this._paused;
    }

    set paused(value: boolean) {
        this._paused = value;
    }

    get activeCount(): number {
        return this._tweens.length;
    }

    update(dt: number): void {
        if (this._paused || this._tweens.length === 0) {
            return;
        }

        // Iterate over a snapshot: completion callbacks frequently start new tweens.
        const current = this._tweens;
        this._tweens = [];

        for (const tween of current) {
            if (tween.canceled) {
                continue;
            }

            tween.elapsed += dt;
            const raw = tween.duration <= 0 ? 1 : Math.min(1, tween.elapsed / tween.duration);
            const eased = tween.ease ? tween.ease.ease(raw) : raw;
            tween.apply(eased);

            if (raw >= 1) {
                tween.resolve();
            } else {
                this._tweens.push(tween);
            }
        }
    }

    /** Registers a raw interpolation over `duration` seconds. */
    run(owner: object, duration: number, apply: (t: number) => void, ease: IEasingFunction | null = null): Promise<void> {
        if (duration <= 0) {
            apply(1);
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this._tweens.push({ elapsed: 0, duration, ease, apply, resolve, canceled: false, owner });
        });
    }

    /** cocos2d's stopAllActions. Pending promises resolve so awaiters do not hang. */
    stopAll(owner: object): void {
        for (const tween of this._tweens) {
            if (tween.owner === owner) {
                tween.canceled = true;
                tween.resolve();
            }
        }
        this._tweens = this._tweens.filter((tween) => tween.owner !== owner);
    }

    stopEverything(): void {
        for (const tween of this._tweens) {
            tween.canceled = true;
            tween.resolve();
        }
        this._tweens = [];
    }

    // -- Sprite tweens, named after their CCAction counterparts -------------

    /** CCDelayTime. */
    delay(owner: object, seconds: number): Promise<void> {
        return this.run(owner, seconds, () => {});
    }

    /** CCMoveTo. */
    moveTo(sprite: Transformable, x: number, y: number, duration: number, ease: IEasingFunction | null = null): Promise<void> {
        const startX = sprite.x;
        const startY = sprite.y;
        return this.run(
            sprite,
            duration,
            (t) => {
                sprite.x = startX + (x - startX) * t;
                sprite.y = startY + (y - startY) * t;
            },
            ease
        );
    }

    /** CCMoveBy. */
    moveBy(sprite: Transformable, dx: number, dy: number, duration: number, ease: IEasingFunction | null = null): Promise<void> {
        return this.moveTo(sprite, sprite.x + dx, sprite.y + dy, duration, ease);
    }

    /** CCScaleTo. */
    scaleTo(sprite: Transformable, scale: number, duration: number, ease: IEasingFunction | null = null): Promise<void> {
        const start = sprite.scale;
        return this.run(
            sprite,
            duration,
            (t) => {
                sprite.scale = start + (scale - start) * t;
            },
            ease
        );
    }

    /** CCRotateTo. Degrees clockwise, matching cocos2d. */
    rotateTo(sprite: Sprite2D, degrees: number, duration: number, ease: IEasingFunction | null = null): Promise<void> {
        const start = sprite.rotation;
        return this.run(
            sprite,
            duration,
            (t) => {
                sprite.rotation = start + (degrees - start) * t;
            },
            ease
        );
    }

    /**
     * CCFadeTo / CCFadeIn / CCFadeOut, with opacity as 0..1. Typed against the
     * property rather than Sprite2D so text quads can fade too.
     */
    fadeTo(target: Fadeable, opacity: number, duration: number, ease: IEasingFunction | null = null): Promise<void> {
        const start = target.opacity;
        return this.run(
            target,
            duration,
            (t) => {
                target.opacity = start + (opacity - start) * t;
            },
            ease
        );
    }

    fadeIn(target: Fadeable, duration: number): Promise<void> {
        return this.fadeTo(target, 1, duration);
    }

    fadeOut(target: Fadeable, duration: number): Promise<void> {
        return this.fadeTo(target, 0, duration);
    }

    /** CCTintTo, with components in 0..255 to match the original ccc3 calls. */
    tintTo(sprite: Tintable, r: number, g: number, b: number, duration: number): Promise<void> {
        const startR = sprite.color.r;
        const startG = sprite.color.g;
        const startB = sprite.color.b;
        const targetR = r / 255;
        const targetG = g / 255;
        const targetB = b / 255;
        return this.run(sprite, duration, (t) => {
            sprite.setColor(
                startR + (targetR - startR) * t,
                startG + (targetG - startG) * t,
                startB + (targetB - startB) * t
            );
        });
    }

    /** CCBlink: `times` on/off cycles spread across `duration`. */
    blink(sprite: Sprite2D, times: number, duration: number): Promise<void> {
        const wasVisible = sprite.visible;
        return this.run(sprite, duration, (t) => {
            if (t >= 1) {
                sprite.visible = wasVisible;
                return;
            }
            const slice = 1 / times;
            sprite.visible = (t % slice) / slice < 0.5;
        });
    }

    /**
     * CCAnimate over numbered frames, e.g. "poof%d.png" as built by
     * CCAnimation+SequenceLoader.
     */
    animate(sprite: Sprite2D, frames: string[], delayPerFrame: number): Promise<void> {
        if (frames.length === 0) {
            return Promise.resolve();
        }
        const duration = frames.length * delayPerFrame;
        let lastIndex = -1;
        return this.run(sprite, duration, (t) => {
            const index = Math.min(frames.length - 1, Math.floor(t * frames.length));
            if (index !== lastIndex) {
                lastIndex = index;
                sprite.setFrame(frames[index]!);
            }
        });
    }
}

/** Frame name list for a numbered sequence, e.g. sequenceFrames("poof%d.png", 5). */
export function sequenceFrames(pattern: string, count: number): string[] {
    const frames: string[] = [];
    for (let i = 1; i <= count; i++) {
        frames.push(pattern.replace("%d", String(i)));
    }
    return frames;
}
