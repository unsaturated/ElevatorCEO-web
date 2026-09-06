// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

/**
 * Random source for the simulation.
 *
 * Kept behind an interface so tests can supply a deterministic sequence and
 * assert exact level layouts, which is impossible with a global Math.random.
 */
export interface RandomSource {
    /** Uniform in [0, 1), the analog of CCRANDOM_0_1(). */
    next(): number;
}

export const defaultRandom: RandomSource = {
    next: () => Math.random(),
};

/** Deterministic xorshift128 source, for tests and replayable runs. */
export class SeededRandom implements RandomSource {
    private _a: number;
    private _b: number;
    private _c: number;
    private _d: number;

    constructor(seed = 0x2f6e2b1) {
        this._a = seed >>> 0 || 1;
        this._b = (seed * 0x9e3779b1) >>> 0 || 2;
        this._c = (seed ^ 0x85ebca6b) >>> 0 || 3;
        this._d = (seed + 0xc2b2ae35) >>> 0 || 4;
    }

    next(): number {
        let t = this._d;
        const s = this._a;
        this._d = this._c;
        this._c = this._b;
        this._b = s;
        t ^= t << 11;
        t ^= t >>> 8;
        this._a = (t ^ s ^ (s >>> 19)) >>> 0;
        return this._a / 0x100000000;
    }
}

/**
 * Inclusive integer range, the analog of
 * `RANDBETWEEN(min,max) ((UInt16)((arc4random() % ((max)-(min)+1)) + min))`
 * from GameController.h:218.
 */
export function randBetween(random: RandomSource, min: number, max: number): number {
    const span = max - min + 1;
    if (span <= 0) {
        return min;
    }
    return Math.floor(random.next() * span) + min;
}
