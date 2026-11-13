// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { beforeEach, describe, expect, it } from "vitest";

import { FLOOR_HEIGHT, MIN_FLOORS_BETWEEN_ELS, SYNERGY_PER_FLOOR, TRANSFER_VALUE } from "../src/core/constants";
import { Game } from "../src/sim/game";
import { FloorGeometry } from "../src/sim/geometry";
import { Bonus, Movement } from "../src/sim/enums";
import { EventBus, type SimEvent } from "../src/sim/events";
import { SeededRandom } from "../src/sim/random";
import { computeFloorZones } from "../src/sim/shaft";
import { TransferElevator } from "../src/sim/transferElevator";

const DT = 1 / 60;

/** Advances the simulation in the fixed steps the render loop uses. */
function step(game: Game, seconds: number): void {
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i++) {
        game.update(DT);
    }
}

/** Runs until the predicate holds, returning the elapsed seconds, or -1 on timeout. */
function stepUntil(game: Game, predicate: (game: Game) => boolean, maxSeconds: number): number {
    const frames = Math.round(maxSeconds / DT);
    for (let i = 0; i < frames; i++) {
        game.update(DT);
        if (predicate(game)) {
            return (i + 1) * DT;
        }
    }
    return -1;
}

/** Same as stepUntil, for a single transfer car outside a Game. */
function stepElevatorUntil(
    elevator: TransferElevator,
    predicate: () => boolean,
    maxSeconds: number,
    stopTime = 5
): boolean {
    const frames = Math.round(maxSeconds / DT);
    for (let i = 0; i < frames; i++) {
        elevator.update(DT, stopTime);
        if (predicate()) {
            return true;
        }
    }
    return false;
}

describe("FloorGeometry", () => {
    const floors = new FloorGeometry();

    beforeEach(() => {
        floors.reset(1, 50);
    });

    it("puts the level's first floor at y=0 when unscrolled", () => {
        expect(floors.floorBottomY(1)).toBe(0);
        expect(floors.floorBottomY(2)).toBe(FLOOR_HEIGHT);
    });

    it("round-trips a position to a floor and back", () => {
        for (let floor = 1; floor <= 11; floor++) {
            const y = floors.floorBottomY(floor) + FLOOR_HEIGHT / 2;
            expect(floors.floorFromPosition(y)).toBe(floor);
        }
    });

    it("tracks floors as the layer scrolls", () => {
        floors.scrollBy(-FLOOR_HEIGHT * 3);
        expect(floors.floorFromPosition(1)).toBe(4);
        expect(floors.floorBottomY(4)).toBe(0);
    });

    it("returns 0 outside the level, the original's error signal", () => {
        expect(floors.floorFromPosition(-500)).toBe(0);
        expect(floors.floorFromPosition(100_000)).toBe(0);
        floors.scrollBy(-FLOOR_HEIGHT * 20);
        expect(floors.floorFromPosition(360)).toBe(27);
    });

    it("clamps scrolling at both ends of the building", () => {
        floors.scrollBy(500);
        expect(floors.layerY).toBe(0);
        expect(floors.canElevatorMoveDown).toBe(false);
        expect(floors.canElevatorMoveUp).toBe(true);

        floors.scrollBy(-1_000_000);
        expect(floors.layerY).toBe(floors.minLayerY);
        expect(floors.canElevatorMoveUp).toBe(false);
        expect(floors.canElevatorMoveDown).toBe(true);
    });

    it("reports a signed distance to a floor bottom", () => {
        expect(floors.distanceToFloorBottom(3, 0)).toBe(FLOOR_HEIGHT * 2);
        expect(floors.distanceToFloorBottom(1, FLOOR_HEIGHT)).toBe(-FLOOR_HEIGHT);
    });
});

describe("floor zoning", () => {
    it("separates the bands by MIN_FLOORS_BETWEEN_ELS", () => {
        const random = new SeededRandom(99);
        const zones = computeFloorZones(random, 6, 1, 200);
        expect(zones).toHaveLength(6);
        for (let i = 1; i < zones.length; i++) {
            expect(zones[i]!.minimum).toBeGreaterThanOrEqual(zones[i - 1]!.maximum + MIN_FLOORS_BETWEEN_ELS);
        }
    });

    it("starts every elevator inside its own band", () => {
        const random = new SeededRandom(7);
        for (const count of [1, 2, 3, 4, 5, 6]) {
            const zones = computeFloorZones(random, count, 10, 300);
            for (const zone of zones) {
                expect(zone.maximum).toBeGreaterThanOrEqual(zone.minimum);
                expect(zone.startFloor).toBeGreaterThanOrEqual(zone.minimum);
                expect(zone.startFloor).toBeLessThanOrEqual(zone.maximum);
            }
        }
    });

    it("never assigns the same floor to two bands", () => {
        const random = new SeededRandom(42);
        for (let n = 0; n < 80; n++) {
            for (const count of [1, 2, 3, 4, 5, 6]) {
                const zones = computeFloorZones(random, count, 1, 49);
                const claimed = new Set<number>();
                for (const zone of zones) {
                    for (let floor = zone.minimum; floor <= zone.maximum; floor++) {
                        expect(claimed.has(floor)).toBe(false);
                        claimed.add(floor);
                    }
                }
            }
        }
    });
});

describe("own elevator", () => {
    let game: Game;

    beforeEach(() => {
        game = new Game(new SeededRandom(1234));
        game.newGame();
    });

    it("starts on the level's first floor with a full crew", () => {
        expect(game.own.floor).toBe(game.params.startFloor);
        expect(game.own.passengersOnboard).toBe(game.params.passengers);
        expect(game.own.synergy).toBe(100);
        expect(game.own.lives).toBe(3);
    });

    it("cannot descend from the bottom floor but can climb", () => {
        expect(game.own.isDownControlAllowable).toBe(false);
        expect(game.own.isUpControlAllowable).toBe(true);
    });

    it("moves up while held and settles when released", () => {
        game.moveOwnElevator(false, 3, false);
        expect(game.own.movementDir).toBe(Movement.Up);

        step(game, 1.0);
        expect(game.own.floor).toBeGreaterThan(game.params.startFloor);

        game.moveOwnElevator(false, 0, false);
        step(game, 2.0);
        expect(game.own.movementDir).toBe(Movement.Stopped);
    });

    it("drains SYNERGY_PER_FLOOR of a percent for every floor crossed", () => {
        const totalFloors = game.params.stopFloor - game.params.startFloor + 1;
        const perFloor = (100 / totalFloors) * SYNERGY_PER_FLOOR;
        const startFloor = game.own.floor;

        game.moveOwnElevator(false, 4, false);
        step(game, 1.5);

        const crossed = game.own.floor - startFloor;
        expect(crossed).toBeGreaterThan(0);
        expect(game.own.synergy).toBeCloseTo(100 - crossed * perFloor, 6);
    });

    it("travels exactly one floor on a tap and lands square on it", () => {
        const startFloor = game.own.floor;
        game.moveOwnElevator(true, 0, false);
        step(game, 3.0);

        expect(game.own.movementDir).toBe(Movement.Stopped);
        expect(game.own.floor).toBe(startFloor + 1);

        const carBottom = game.own.y - 26;
        expect(carBottom - game.floors.floorBottomY(game.own.floor)).toBeCloseTo(0, 3);
    });

    it("scrolls the building rather than the car past the scroll point", () => {
        game.moveOwnElevator(false, 6, false);
        step(game, 4.0);

        expect(game.floors.layerY).toBeLessThan(0);
        expect(game.own.y).toBeLessThanOrEqual(FLOOR_HEIGHT * 6 + 1);
    });

    it("settles square on a floor after the building has scrolled", () => {
        game.moveOwnElevator(false, 6, false);
        step(game, 5.0);
        expect(game.floors.layerY).toBeLessThan(0);

        const floorBefore = game.own.floor;
        game.moveOwnElevator(false, 0, false);
        step(game, 2.0);

        expect(game.own.movementDir).toBe(Movement.Stopped);
        expect(game.own.floor).toBe(floorBefore);

        const carBottom = game.own.y - 26;
        expect(carBottom - game.floors.floorBottomY(game.own.floor)).toBeCloseTo(0, 1);
    });

    it("tap-travels one floor correctly after the building has scrolled", () => {
        game.moveOwnElevator(false, 6, false);
        step(game, 5.0);
        game.moveOwnElevator(false, 0, false);
        step(game, 2.0);

        const startFloor = game.own.floor;
        game.moveOwnElevator(true, 0, false);
        step(game, 3.0);

        expect(game.own.movementDir).toBe(Movement.Stopped);
        expect(game.own.floor).toBe(startFloor + 1);

        const carBottom = game.own.y - 26;
        // Tap requests include a +/-5 nudge (OwnGameElevator.m:169); when the
        // move crosses into floor-layer scroll the remainder can leave a couple
        // of points of slack after the settle bounce.
        expect(Math.abs(carBottom - game.floors.floorBottomY(game.own.floor))).toBeLessThanOrEqual(2);
    });

    it("lands on the top floor while still held, not only after settle", () => {
        game.moveOwnElevator(false, 8, false);
        const elapsed = stepUntil(game, (current) => {
            if (current.own.floor !== current.params.stopFloor) {
                return false;
            }
            const carBottom = current.own.y - 26;
            return Math.abs(carBottom - current.floors.floorBottomY(current.own.floor)) < 0.5;
        }, 120);
        expect(elapsed).toBeGreaterThan(0);

        expect(game.own.floor).toBe(game.params.stopFloor);
        expect(game.own.movementDir).toBe(Movement.Up);
        expect(game.floors.canElevatorMoveUp).toBe(false);
    });

    it("tap-travels to the top floor when the layer is already at its limit", () => {
        game.moveOwnElevator(false, 8, false);
        stepUntil(game, (current) => current.own.floor === current.params.stopFloor - 1, 120);
        game.moveOwnElevator(false, 0, false);
        step(game, 2.0);
        expect(game.floors.canElevatorMoveUp).toBe(false);

        game.moveOwnElevator(true, 0, false);
        step(game, 3.0);

        expect(game.own.floor).toBe(game.params.stopFloor);
        expect(game.own.atTopFloor).toBe(true);
        const carBottom = game.own.y - 26;
        expect(carBottom - game.floors.floorBottomY(game.own.floor)).toBeCloseTo(0, 1);
    });

    it("emits elevatorStopping when a hold is cut off at the top floor", () => {
        const events: SimEvent[] = [];
        game.events.on((event) => events.push(event));

        game.moveOwnElevator(false, 8, false);
        stepUntil(game, (current) => current.own.atTopFloor, 120);

        // ControlView._tickDirectional sends this once isUpControlAllowable goes false.
        game.moveOwnElevator(false, 0, false);
        step(game, 2.0);

        expect(events.some((event) => event.type === "elevatorStopping")).toBe(true);
        expect(game.own.movementDir).toBe(Movement.Stopped);
    });

    it("descends smoothly from the top floor without y bouncing at the scroll point", () => {
        game.moveOwnElevator(false, 8, false);
        stepUntil(game, (current) => current.own.floor === current.params.stopFloor, 120);
        game.moveOwnElevator(false, 0, false);
        step(game, 2.0);

        game.moveOwnElevator(false, 6, true);
        let prevY = game.own.y;
        for (let frame = 0; frame < 120; frame++) {
            game.update(DT);
            expect(game.own.y - prevY).toBeLessThanOrEqual(0.01);
            prevY = game.own.y;
        }
        expect(game.own.floor).toBeLessThan(game.params.stopFloor);
    });

    it("empties the car and costs a life when synergy runs out", () => {
        const events: SimEvent[] = [];
        game.events.on((event) => events.push(event));

        game.own.synergy = 0.01;
        game.moveOwnElevator(false, 5, false);
        step(game, 3.0);

        expect(game.own.synergyDeathSequencePlaying).toBe(true);
        expect(game.own.passengersOnboard).toBe(0);
        expect(game.own.lives).toBe(2);
        expect(events.some((event) => event.type === "lifeLost")).toBe(true);
    });

    it("ignores the controls while the crash plays out", () => {
        game.own.setLives(2);
        expect(game.own.deathSequencePlaying).toBe(true);

        const before = game.own.y;
        game.moveOwnElevator(false, 8, false);
        step(game, 0.5);
        expect(game.own.y).toBe(before);
    });
});

describe("transfers", () => {
    let game: Game;

    beforeEach(() => {
        game = new Game(new SeededRandom(555));
        game.newGame();
    });

    /** Parks a transfer elevator on the player's floor, ready to be tapped. */
    function parkOnPlayer(index = 0): ReturnType<Game["allElevators"]["at"]> {
        const elevator = game.allElevators.filter((candidate) => candidate.activeInGame)[index]!;
        elevator.setTo(game.own.floor);
        elevator.stopBounce();
        return elevator;
    }

    it("rejects a tap on an elevator the player is not level with", () => {
        const elevator = game.allElevators.find(
            (candidate) => candidate.activeInGame && candidate.floor !== game.own.floor
        );
        expect(elevator).toBeDefined();
        expect(game.tapElevator(elevator!)).toBe(false);
    });

    it("pays TRANSFER_VALUE per passenger and bumps synergy", () => {
        const elevator = parkOnPlayer()!;
        const passengers = elevator.passengersOnboard;
        const ownBefore = game.own.passengersOnboard;
        game.own.synergy = 50;

        expect(passengers).toBeGreaterThan(0);
        expect(elevator.showPassengerBalloon).toBe(true);
        expect(game.tapElevator(elevator)).toBe(true);
        expect(game.pension).toBe(passengers * TRANSFER_VALUE);
        expect(game.own.synergy).toBeCloseTo(50 + passengers * 1.5, 6);
        expect(game.own.passengersOnboard).toBe(ownBefore - passengers);
        expect(elevator.passengersOnboard).toBe(0);
        expect(elevator.activeInGame).toBe(true);
        expect(elevator.showPassengerBalloon).toBe(false);
    });

    it("accepts each elevator only once", () => {
        const elevator = parkOnPlayer()!;
        expect(game.tapElevator(elevator)).toBe(true);
        expect(game.tapElevator(elevator)).toBe(false);
    });

    it("emits a transfer event carrying the award", () => {
        const events: SimEvent[] = [];
        game.events.on((event) => events.push(event));

        const elevator = parkOnPlayer()!;
        const passengers = elevator.passengersOnboard;
        game.tapElevator(elevator);

        expect(events.find((event) => event.type === "transfer")).toMatchObject({
            passengers,
            pension: passengers * TRANSFER_VALUE,
        });
        expect(events.find((event) => event.type === "pensionAward")).toMatchObject({
            elevatorId: elevator.id,
            amount: passengers * TRANSFER_VALUE,
        });
    });

    it("moves an idle elevator on once its stop time expires", () => {
        const elevator = game.allElevators.find(
            (candidate) => candidate.activeInGame && candidate.floorRangeMax > candidate.floorRangeMin
        );
        expect(elevator).toBeDefined();

        const startFloor = elevator!.floor;
        const elapsed = stepUntil(game, () => elevator!.inTransit || elevator!.floor !== startFloor, game.params.stopTime + 5);
        expect(elapsed).toBeGreaterThan(0);
    });

    it("keeps every elevator inside its wander band", () => {
        step(game, 45);
        for (const elevator of game.allElevators) {
            if (!elevator.activeInGame || elevator.floorRangeMax === 0) {
                continue;
            }
            expect(elevator.floor).toBeGreaterThanOrEqual(elevator.floorRangeMin);
            expect(elevator.floor).toBeLessThanOrEqual(elevator.floorRangeMax);
        }
    });

    it("never lets two cars in a shaft occupy the same floor", () => {
        // Assert once at the end: ~26k frames of per-frame expect() calls
        // pushes this past the default timeout on CI runners.
        const violations: string[] = [];
        for (const seed of [1, 31, 1234]) {
            const run = new Game(new SeededRandom(seed));
            run.newGame();
            for (let level = 1; level <= 12; level++) {
                run.setLevel(level);
                for (let frame = 0; frame < 60 * 12; frame++) {
                    run.update(DT);
                    for (const shaft of run.shafts) {
                        if (shaft.gettingReadyForCeo) {
                            continue;
                        }
                        const active = shaft.elevators.filter((el) => el.activeInGame);
                        const floors = active.map((el) => el.floor);
                        if (new Set(floors).size !== floors.length) {
                            violations.push(`seed ${seed} level ${level} frame ${frame}: shared floor in [${floors}]`);
                        }
                        for (const el of active) {
                            if (el.floor < el.floorRangeMin || el.floor > el.floorRangeMax) {
                                violations.push(
                                    `seed ${seed} level ${level} frame ${frame}: elevator ${el.id} at ${el.floor} outside ${el.floorRangeMin}-${el.floorRangeMax}`,
                                );
                            }
                        }
                    }
                }
            }
        }
        expect(violations.slice(0, 10)).toEqual([]);
    });

    it("still settles after setTo interrupts a bounce", () => {
        const elevator = new TransferElevator(0, new EventBus());
        elevator.setFloorMinMax(1, 80);
        elevator.setFloorRange(1, 40);
        elevator.setTo(5);
        elevator.activeInGame = true;
        elevator.moveTo(18, 8);

        const startedBounce = stepElevatorUntil(elevator, () => elevator.movementDir === Movement.Stopping, 8);
        expect(startedBounce).toBe(true);

        elevator.setTo(6);
        elevator.moveTo(22, 8);
        const arrived = stepElevatorUntil(elevator, () => !elevator.inTransit && elevator.floor === 22, 12);
        expect(arrived).toBe(true);
        expect(elevator.floor).toBe(22);
        expect(elevator.floor).toBeGreaterThanOrEqual(elevator.floorRangeMin);
        expect(elevator.floor).toBeLessThanOrEqual(elevator.floorRangeMax);
    });
});

describe("bonuses", () => {
    it("routes each chest to the right resource", () => {
        const game = new Game(new SeededRandom(31));
        game.newGame();
        const elevator = game.allElevators[0]!;

        /** Opens a chest of the given kind and runs past the reveal animation. */
        const open = (bonus: Bonus): void => {
            elevator.touched = false;
            elevator.activeInGame = true;
            elevator.setBonus(bonus);
            elevator.setTo(game.own.floor);
            elevator.stopBounce();
            game.tapElevator(elevator);
            expect(elevator.displayingBonus).toBe(true);
            expect(elevator.showPassengerBalloon).toBe(true);
            step(game, 3.5);
            expect(elevator.displayingBonus).toBe(false);
            expect(elevator.showPassengerBalloon).toBe(false);
        };

        game.own.setLives(2);
        game.own.deathSequencePlaying = false;
        open(Bonus.Heart);
        expect(game.own.lives).toBe(3);

        game.own.synergy = 50;
        open(Bonus.Synergy);
        expect(game.own.synergy).toBeCloseTo(60, 6);

        const pensionBefore = game.pension;
        open(Bonus.Pension);
        expect(game.pension).toBeGreaterThan(pensionBefore);

        open(Bonus.NoRadar);
        expect(game.radarHiddenFloors).toBeGreaterThan(0);
        expect(game.radarHiddenTotal).toBe(game.radarHiddenFloors);
    });

    it("holds a passenger prize until the chest sequence finishes", () => {
        const game = new Game(new SeededRandom(31));
        game.newGame();
        const elevator = game.allElevators[0]!;

        elevator.touched = false;
        elevator.activeInGame = true;
        elevator.setBonus(Bonus.Passenger);
        elevator.initializePassengers(2);
        elevator.setTo(game.own.floor);
        elevator.stopBounce();
        game.own.passengersOnboard = 5;
        game.own.setLives(3);
        game.tapElevator(elevator);

        expect(elevator.displayingBonus).toBe(true);
        // After the chest opens and fades, the count is still the prize.
        step(game, 2.5);
        expect(elevator.displayingBonus).toBe(true);
        expect(elevator.showPassengerBalloon).toBe(true);
        expect(elevator.passengersOnboard).toBe(2);

        step(game, 1.0);
        expect(elevator.displayingBonus).toBe(false);
        expect(elevator.passengersOnboard).toBe(0);
        expect(game.own.passengersOnboard).toBe(3);
    });

    it("increments the bonus change counter even when the kind does not change", () => {
        const game = new Game(new SeededRandom(31));
        game.newGame();
        const elevator = game.allElevators[0]!;

        elevator.setBonus(Bonus.Pension);
        const first = elevator.bonusChangeCounter;
        elevator.setBonus(Bonus.Pension);

        expect(elevator.bonus).toBe(Bonus.Pension);
        expect(elevator.bonusChangeCounter).toBeGreaterThan(first);
    });
});

describe("CEO sequence", () => {
    it("summons the CEO once the player is down to one passenger", () => {
        const game = new Game(new SeededRandom(2024));
        game.newGame();

        game.own.passengersOnboard = 1;
        step(game, 0.1);

        const lastShaft = game.shafts[game.shafts.length - 1]!;
        expect(lastShaft.gettingReadyForCeo).toBe(true);
        expect(game.ceo.floorGoingToPreview).not.toBe(0xffff);
    });

    it("clears the shaft, then puts the CEO in play", () => {
        const game = new Game(new SeededRandom(2024));
        game.newGame();
        game.own.passengersOnboard = 1;

        const elapsed = stepUntil(game, (current) => current.ceo.activeInGame, 90);
        expect(elapsed).toBeGreaterThan(0);

        const lastShaft = game.shafts[game.shafts.length - 1]!;
        expect(lastShaft.elevators.every((elevator) => !elevator.activeInGame)).toBe(true);
    });

    it("advances the level when the player boards", () => {
        const game = new Game(new SeededRandom(4242));
        game.newGame();
        const events: SimEvent[] = [];
        game.events.on((event) => events.push(event));

        expect(game.ceo.passengersOnboard).toBe(1);

        game.ceo.activeInGame = true;
        game.ceo.setTo(game.own.floor);
        game.ceo.stopBounce();

        expect(game.tapElevator(game.ceo)).toBe(true);
        expect(game.own.levelUpPlaying).toBe(true);
        expect(game.pension).toBe(TRANSFER_VALUE);
        // CeoElevator.m:172: the player steps aboard, so the balloon shows 2.
        expect(game.ceo.passengersOnboard).toBe(2);

        step(game, 3.0);
        expect(game.level).toBe(2);
        expect(events.some((event) => event.type === "levelUp")).toBe(true);
        // The new level rearms the player and reseeds the CEO (GameControlLayer.m:311).
        expect(game.own.synergy).toBe(100);
        expect(game.own.floor).toBe(game.params.startFloor);
        expect(game.ceo.passengersOnboard).toBe(1);
    });

    it("does not carry the boarded passenger count into the next level", () => {
        const game = new Game(new SeededRandom(4242));
        game.newGame();

        for (let level = 1; level <= 4; level++) {
            expect(game.ceo.passengersOnboard).toBe(1);

            game.ceo.activeInGame = true;
            game.ceo.setTo(game.own.floor);
            game.ceo.stopBounce();
            expect(game.tapElevator(game.ceo)).toBe(true);
            expect(game.ceo.passengersOnboard).toBe(2);

            step(game, 3.0);
            expect(game.level).toBe(level + 1);
        }

        expect(game.ceo.passengersOnboard).toBe(1);
    });

    it("costs the player their last passenger if the CEO reaches the top unboarded", () => {
        const game = new Game(new SeededRandom(77));
        game.newGame();
        game.own.passengersOnboard = 1;

        game.ceo.activeInGame = true;
        game.ceo.setTo(game.ceo.floorMax);
        step(game, 0.1);

        expect(game.own.passengersOnboard).toBe(0);
        expect(game.own.lives).toBe(2);
    });
});

describe("game loop", () => {
    it("ends the game after the third life is lost", () => {
        const game = new Game(new SeededRandom(11));
        game.newGame();
        const events: SimEvent[] = [];
        game.events.on((event) => events.push(event));

        for (let life = 0; life < 3; life++) {
            game.own.removePassengers(game.own.passengersOnboard);
            // The crash animation plus its trailing pause.
            step(game, 8.0);
        }

        expect(game.gameOver).toBe(true);
        expect(events.some((event) => event.type === "gameOver")).toBe(true);
    });

    it("restarts the current level after a survivable crash", () => {
        const game = new Game(new SeededRandom(11));
        game.newGame();
        game.moveOwnElevator(false, 4, false);
        step(game, 2.0);
        expect(game.own.floor).toBeGreaterThan(game.params.startFloor);

        game.own.removePassengers(game.own.passengersOnboard);
        step(game, 8.0);

        expect(game.own.lives).toBe(2);
        expect(game.level).toBe(1);
        expect(game.own.floor).toBe(game.params.startFloor);
        expect(game.own.synergy).toBe(100);
        expect(game.floors.layerY).toBe(0);
    });

    it("clamps pension to the documented range", () => {
        const game = new Game(new SeededRandom(3));
        game.newGame();
        game.changePension(-100);
        expect(game.pension).toBe(0);
        game.changePension(1e12);
        expect(game.pension).toBe(95_000_000);
    });

    it("survives a long scripted session without producing invalid state", () => {
        const game = new Game(new SeededRandom(8675309));
        const script = new SeededRandom(24);
        game.newGame();

        for (let frame = 0; frame < 60 * 90; frame++) {
            if (frame % 37 === 0) {
                game.moveOwnElevator(script.next() < 0.3, 5, script.next() < 0.5);
            }
            game.update(DT);

            if (frame % 60 !== 0) {
                continue;
            }
            expect(Number.isFinite(game.own.y)).toBe(true);
            expect(Number.isFinite(game.own.synergy)).toBe(true);
            expect(Number.isFinite(game.floors.layerY)).toBe(true);
            expect(game.own.lives).toBeGreaterThanOrEqual(0);
            expect(game.pension).toBeGreaterThanOrEqual(0);
            expect(game.level).toBeGreaterThanOrEqual(1);
        }
    });
});
