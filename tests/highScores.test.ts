// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { beforeEach, describe, expect, it } from "vitest";

import { GAME_MAX_PENSION } from "../src/core/constants";
import { loadHighScores, recordScore, saveHighScores } from "../src/core/highScores";

/** Vitest runs in the node environment, which has no Web Storage. */
function installStorage(): void {
    const entries = new Map<string, string>();
    const storage = {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
            entries.set(key, value);
        },
        removeItem: (key: string) => {
            entries.delete(key);
        },
        clear: () => {
            entries.clear();
        },
        key: (index: number) => [...entries.keys()][index] ?? null,
        get length() {
            return entries.size;
        },
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

const pensions = (): number[] => loadHighScores().map((score) => score.pension);

describe("recordScore", () => {
    beforeEach(() => {
        installStorage();
    });

    it("records the first score", () => {
        expect(recordScore(5000, 3)).toBe(true);
        expect(loadHighScores()).toEqual([{ date: expect.any(Number), level: 3, pension: 5000 }]);
    });

    it("rejects a zero pension", () => {
        expect(recordScore(0, 7)).toBe(false);
        expect(loadHighScores()).toEqual([]);
    });

    it("orders by pension, best first", () => {
        recordScore(3000, 1);
        recordScore(9000, 2);
        recordScore(6000, 3);
        expect(pensions()).toEqual([9000, 6000, 3000]);
    });

    it("ranks a tie above the existing score", () => {
        recordScore(4000, 1);
        recordScore(4000, 2);
        expect(loadHighScores().map((score) => score.level)).toEqual([2, 1]);
    });

    it("evicts the worst score once full", () => {
        recordScore(3000, 1);
        recordScore(5000, 2);
        recordScore(7000, 3);
        expect(recordScore(6000, 4)).toBe(true);
        expect(pensions()).toEqual([7000, 6000, 5000]);
    });

    it("rejects a score worse than a full board", () => {
        recordScore(3000, 1);
        recordScore(5000, 2);
        recordScore(7000, 3);
        expect(recordScore(1000, 4)).toBe(false);
        expect(pensions()).toEqual([7000, 5000, 3000]);
    });

    it("stamps the date it was recorded", () => {
        recordScore(2500, 1, 1_700_000_000_000);
        expect(loadHighScores()[0]?.date).toBe(1_700_000_000_000);
    });

    it("accepts a pension at the simulation's ceiling", () => {
        expect(recordScore(GAME_MAX_PENSION, 99)).toBe(true);
        expect(pensions()).toEqual([GAME_MAX_PENSION]);
    });

    it("rejects a pension beyond the simulation's ceiling", () => {
        expect(recordScore(GAME_MAX_PENSION + 1, 99)).toBe(false);
        expect(loadHighScores()).toEqual([]);
    });

    it("rejects a negative pension", () => {
        expect(recordScore(-5000, 1)).toBe(false);
        expect(loadHighScores()).toEqual([]);
    });
});

describe("loadHighScores", () => {
    beforeEach(() => {
        installStorage();
    });

    it("round-trips saved scores", () => {
        const scores = [
            { date: 3, level: 9, pension: 9000 },
            { date: 2, level: 5, pension: 5000 },
        ];
        saveHighScores(scores);
        expect(loadHighScores()).toEqual(scores);
    });

    it("returns an empty list when nothing is stored", () => {
        expect(loadHighScores()).toEqual([]);
    });

    it("returns an empty list for malformed JSON", () => {
        localStorage.setItem("ceo:highScores", "{not json");
        expect(loadHighScores()).toEqual([]);
    });

    it("drops entries that are not scores", () => {
        localStorage.setItem(
            "ceo:highScores",
            JSON.stringify([{ date: 1, level: 2, pension: 3000 }, null, { pension: "lots" }])
        );
        expect(pensions()).toEqual([3000]);
    });

    it("drops tampered scores outside the simulation's pension range", () => {
        localStorage.setItem(
            "ceo:highScores",
            JSON.stringify([
                { date: 1, level: 999, pension: GAME_MAX_PENSION * 10 },
                { date: 2, level: 1, pension: -1 },
                { date: 3, level: 7, pension: 42_000 },
            ])
        );
        expect(pensions()).toEqual([42_000]);
    });

    it("drops entries with a negative or non-finite level", () => {
        localStorage.setItem(
            "ceo:highScores",
            JSON.stringify([
                { date: 1, level: -3, pension: 9000 },
                { date: 2, level: null, pension: 8000 },
                { date: 3, level: 6, pension: 7000 },
            ])
        );
        expect(pensions()).toEqual([7000]);
    });

    it("re-sorts and trims stored data", () => {
        localStorage.setItem(
            "ceo:highScores",
            JSON.stringify([
                { date: 1, level: 1, pension: 1000 },
                { date: 2, level: 2, pension: 8000 },
                { date: 3, level: 3, pension: 4000 },
                { date: 4, level: 4, pension: 6000 },
            ])
        );
        expect(pensions()).toEqual([8000, 6000, 4000]);
    });
});
