// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

/**
 * Easing curves used by the simulation.
 *
 * These live in the simulation rather than the view because the original ran
 * settle animations through CCAction on positions the game rules then read back
 * (OwnGameElevator.m:497-525). The curve is therefore part of the physics, and
 * the exact cocos2d implementation is reproduced rather than approximated with
 * Babylon's differently-parameterized BounceEase.
 */

/** CCEaseBounceOut, from cocos2d-iphone CCActionEase.m. */
export function bounceOut(t: number): number {
    if (t < 1 / 2.75) {
        return 7.5625 * t * t;
    }
    if (t < 2 / 2.75) {
        const s = t - 1.5 / 2.75;
        return 7.5625 * s * s + 0.75;
    }
    if (t < 2.5 / 2.75) {
        const s = t - 2.25 / 2.75;
        return 7.5625 * s * s + 0.9375;
    }
    const s = t - 2.625 / 2.75;
    return 7.5625 * s * s + 0.984375;
}

/** CCEaseElasticIn with the given period, used for the death-sequence fall. */
export function elasticIn(t: number, period = 0.3): number {
    if (t === 0 || t === 1) {
        return t;
    }
    const s = period / 4;
    const shifted = t - 1;
    return -Math.pow(2, 10 * shifted) * Math.sin(((shifted - s) * Math.PI * 2) / period);
}

/**
 * Minimal dt-driven tween, the simulation's stand-in for a CCAction.
 * Kept separate from the view's TweenRunner so the simulation stays free of
 * any Babylon dependency.
 */
export class SimTween {
    private _elapsed = 0;
    private _active = false;
    private _from = 0;
    private _delta = 0;
    private _duration = 0;
    private _ease: (t: number) => number = (t) => t;
    private _onDone: (() => void) | null = null;

    get active(): boolean {
        return this._active;
    }

    start(from: number, to: number, duration: number, ease: (t: number) => number, onDone?: () => void): void {
        this._from = from;
        this._delta = to - from;
        this._duration = duration;
        this._ease = ease;
        this._elapsed = 0;
        this._active = true;
        this._onDone = onDone ?? null;
    }

    cancel(): void {
        this._active = false;
        this._onDone = null;
    }

    /** Returns the current value, or null when no tween is running. */
    update(dt: number): number | null {
        if (!this._active) {
            return null;
        }
        this._elapsed += dt;
        const raw = this._duration <= 0 ? 1 : Math.min(1, this._elapsed / this._duration);
        const value = this._from + this._delta * this._ease(raw);

        if (raw >= 1) {
            this._active = false;
            const done = this._onDone;
            this._onDone = null;
            done?.();
        }
        return value;
    }
}
