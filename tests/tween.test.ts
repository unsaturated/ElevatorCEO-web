// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { describe, expect, it } from "vitest";

import { TweenRunner } from "../src/render/tween";
import type { Sprite2D } from "../src/render/sprite2d";

describe("TweenRunner", () => {
    it("blinks a sprite for specified times and restores initial visibility on completion", async () => {
        const runner = new TweenRunner();
        const fakeSprite = { visible: true } as Sprite2D;

        const promise = runner.blink(fakeSprite, 4, 1.0);

        // At t = 0.0 (slice = 0.25): 0 < 0.5 -> visible: true
        runner.update(0.0);
        expect(fakeSprite.visible).toBe(true);

        // At t = 0.15 (within first slice [0, 0.25), 0.15 / 0.25 = 0.6 >= 0.5) -> visible: false
        runner.update(0.15);
        expect(fakeSprite.visible).toBe(false);

        // At t = 0.30 (within second slice [0.25, 0.50), (0.30 - 0.25)/0.25 = 0.2 < 0.5) -> visible: true
        runner.update(0.15);
        expect(fakeSprite.visible).toBe(true);

        // Complete the blink
        runner.update(0.70);
        await promise;
        expect(fakeSprite.visible).toBe(true);
    });

    it("stops all running tweens on an owner", async () => {
        const runner = new TweenRunner();
        const target = { opacity: 1 };

        let resolved = false;
        const promise = runner.fadeTo(target, 0, 1.0).then(() => {
            resolved = true;
        });

        runner.update(0.5);
        expect(target.opacity).toBeCloseTo(0.5);
        expect(runner.activeCount).toBe(1);

        runner.stopAll(target);
        await promise;
        expect(resolved).toBe(true);
        expect(runner.activeCount).toBe(0);

        // Further updates don't affect target
        runner.update(0.5);
        expect(target.opacity).toBeCloseTo(0.5);
    });

    it("tints from the current color toward a ccc3 target", async () => {
        const runner = new TweenRunner();
        const sprite = {
            color: { r: 1, g: 1, b: 1 },
            setColor(r: number, g: number, b: number) {
                this.color = { r, g, b };
            },
        };

        const promise = runner.tintTo(sprite, 0, 255, 0, 1.0);
        runner.update(0.5);
        expect(sprite.color.r).toBeCloseTo(0.5);
        expect(sprite.color.g).toBeCloseTo(1);
        expect(sprite.color.b).toBeCloseTo(0.5);

        runner.update(0.5);
        await promise;
        expect(sprite.color.r).toBeCloseTo(0);
        expect(sprite.color.g).toBeCloseTo(1);
        expect(sprite.color.b).toBeCloseTo(0);
    });

    it("scales and moves a transformable together", async () => {
        const runner = new TweenRunner();
        const sprite = { x: 0, y: 5, scale: 0.3 };

        const scale = runner.scaleTo(sprite, 2.0, 0.7);
        const move = runner.moveBy(sprite, 0, 20, 0.7);
        runner.update(0.7);
        await Promise.all([scale, move]);

        expect(sprite.scale).toBeCloseTo(2.0);
        expect(sprite.x).toBeCloseTo(0);
        expect(sprite.y).toBeCloseTo(25);
    });
});
