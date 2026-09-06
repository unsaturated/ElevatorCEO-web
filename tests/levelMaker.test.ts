// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { describe, expect, it } from "vitest";

import { LevelMaker, bonusValue } from "../src/sim/levelMaker";
import { Bonus } from "../src/sim/enums";
import { SeededRandom } from "../src/sim/random";
import prototypeLevels from "./levels.json";

/**
 * tests/levels.json is a dump of -[GameLevelMaker calculateLevel:] for levels
 * 1–50, using the original integer widths and 32-bit float arithmetic. Matching
 * it exactly is the strongest available evidence that the port preserves the
 * game's balance.
 */
describe("LevelMaker matches the Objective-C reference", () => {
    it("covers levels 1 through 50", () => {
        expect(prototypeLevels).toHaveLength(50);
    });

    for (const prototype of prototypeLevels) {
        it(`level ${prototype.level}`, () => {
            const maker = new LevelMaker(new SeededRandom(prototype.level));
            const actual = maker.calculate(prototype.level);

            expect(actual.level).toBe(prototype.level);
            expect(actual.floors).toBe(prototype.floors);
            expect(actual.startFloor).toBe(prototype.startFloor);
            expect(actual.stopFloor).toBe(prototype.stopFloor);
            expect(actual.passengers).toBe(prototype.passengers);
            expect(actual.stopsByCEO).toBe(prototype.stopsByCEO);
            expect(actual.numberOfElevators).toBe(prototype.numberOfElevators);
            expect(actual.elevatorSpeed).toBe(prototype.elevatorSpeed);
            expect(actual.possibleTransfers).toBe(prototype.possibleTransfers);

            // Exact float32 equality, not an approximation.
            expect(actual.stopTimeByCEO).toBe(Math.fround(prototype.stopTimeByCEO));
            expect(actual.stopTime).toBe(Math.fround(prototype.stopTime));
        });
    }
});

describe("LevelMaker invariants", () => {
    it("distributes one slot entry per transfer elevator", () => {
        for (let level = 1; level <= 50; level++) {
            const maker = new LevelMaker(new SeededRandom(level * 7919));
            const params = maker.calculate(level);
            expect(params.elevatorSlots).toHaveLength(params.numberOfElevators);
            for (const slot of params.elevatorSlots) {
                expect(slot).toBeGreaterThanOrEqual(1);
            }
        }
    });

    it("hands out exactly the possible-transfer budget", () => {
        // The adjustment pass tops the elevators up until the budget is spent,
        // so the totals must reconcile.
        for (let level = 1; level <= 50; level++) {
            const maker = new LevelMaker(new SeededRandom(level));
            const params = maker.calculate(level);
            const total = params.elevatorSlots.reduce((sum, slot) => sum + slot, 0);
            expect(total).toBe(params.possibleTransfers);
        }
    });

    it("always seats enough passengers to complete the level", () => {
        for (let level = 1; level <= 50; level++) {
            const maker = new LevelMaker(new SeededRandom(level));
            const params = maker.calculate(level);
            expect(params.possibleTransfers).toBeGreaterThanOrEqual(params.transfersToLevelUp);
        }
    });

    it("primes the first elevator with 1 when the level-up count is odd, otherwise 2", () => {
        for (let level = 1; level <= 50; level++) {
            const maker = new LevelMaker(new SeededRandom(level));
            const params = maker.calculate(level);
            expect(params.elevatorSlots[0]).toBe(params.transfersToLevelUp % 2 === 1 ? 1 : 2);
        }
    });

    it("is deterministic for a given seed", () => {
        const a = new LevelMaker(new SeededRandom(42)).calculate(17);
        const b = new LevelMaker(new SeededRandom(42)).calculate(17);
        expect(a).toEqual(b);
    });

    it("rejects levels below 1", () => {
        expect(() => new LevelMaker().calculate(0)).toThrow();
    });
});

describe("bonus values", () => {
    it("matches the original formulas", () => {
        // GameLevelMaker.m:365-372: level 1 is the flat minimum.
        expect(bonusValue(Bonus.Pension, 1, 50)).toBe(2000);
        // MROUND truncates to the multiple below and adds half a step.
        expect(bonusValue(Bonus.Pension, 2, 55)).toBe(2050);
        expect(bonusValue(Bonus.Heart, 1, 50)).toBe(1);
        expect(bonusValue(Bonus.Synergy, 1, 50)).toBe(10);
        expect(bonusValue(Bonus.Death, 1, 50)).toBe(0);
        expect(bonusValue(Bonus.Passenger, 1, 50)).toBe(0);
        expect(bonusValue(Bonus.None, 1, 50)).toBe(0);
        // floors*0.1 + 10, then MROUND to 10.
        expect(bonusValue(Bonus.NoRadar, 1, 50)).toBe(15);
    });

    it("draws bonuses across the full probability range", () => {
        const maker = new LevelMaker(new SeededRandom(1234));
        const seen = new Set<Bonus>();
        for (let i = 0; i < 5000; i++) {
            seen.add(maker.randomBonus());
        }
        expect(seen).toContain(Bonus.Heart);
        expect(seen).toContain(Bonus.Pension);
        expect(seen).toContain(Bonus.Death);
        expect(seen).toContain(Bonus.Passenger);
        expect(seen).toContain(Bonus.NoRadar);
        expect(seen).toContain(Bonus.Synergy);
    });
});
