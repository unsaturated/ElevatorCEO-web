// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { describe, expect, it } from "vitest";

import { Game } from "../src/sim/game";
import { SeededRandom } from "../src/sim/random";

const DT = 1 / 60;

function step(game: Game, seconds: number): void {
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i++) {
        game.update(DT);
    }
}

describe("CEO radar preview", () => {
    it("uses the preview floor for the CEO's first stop", () => {
        const game = new Game(new SeededRandom(2024));
        game.newGame();
        game.own.passengersOnboard = 1;
        step(game, 0.1);

        const previewAtSummon = game.ceo.floorGoingToPreview;
        expect(previewAtSummon).not.toBe(0xffff);

        for (let i = 0; i < 7200 && !game.ceo.activeInGame; i++) {
            game.update(DT);
        }
        expect(game.ceo.activeInGame).toBe(true);

        // The CEO enters at startFloor before heading to the previewed stop.
        for (let i = 0; i < 72000 && game.ceo.floorGoingTo === game.params.startFloor; i++) {
            game.update(DT);
        }
        expect(game.ceo.floorGoingTo).toBe(previewAtSummon);
    });

    it("keeps the preview on the first stop for the whole CEO run (ShaftControl.m)", () => {
        const game = new Game(new SeededRandom(4242));
        game.newGame();
        game.setLevel(14); // stopsByCEO = 2
        expect(game.ceo.totalStops).toBeGreaterThan(1);

        game.own.passengersOnboard = 1;
        step(game, 0.1);

        const previewAtSummon = game.ceo.floorGoingToPreview;
        expect(previewAtSummon).not.toBe(0xffff);

        for (let i = 0; i < 7200 && !game.ceo.activeInGame; i++) {
            game.update(DT);
        }

        const initialStops = game.ceo.stopsRemaining;
        for (let i = 0; i < 72000 && game.ceo.stopsRemaining >= initialStops - 1; i++) {
            game.update(DT);
        }

        expect(game.ceo.stopsRemaining).toBeLessThan(initialStops - 1);
        expect(game.ceo.floorGoingToPreview).toBe(previewAtSummon);
    });
});
