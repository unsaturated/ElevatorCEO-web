// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import {
    BONUSES_BEGIN_AT_LEVEL,
    BUTTON_MAX_UP_VALUE,
    BUTTON_MIN_SPEED,
    BUTTON_SPEED_FLOOR_DIVISOR,
    CEO_STOP_DIVISOR,
    CEO_STOP_TIME_MAX_SECONDS,
    CEO_STOP_TIME_MIN_SECONDS,
    DEATH_P,
    ELEVATOR_BUMP_DIVISOR,
    ELEVATOR_BUMP_INCREMENT,
    EVEN_START_PERCENTAGE,
    FLOOR_INCREMENT_FOR_PASSENGER_BUMP,
    FLOOR_INCREMENT_PERCENT,
    HEART_P,
    INITIAL_ELEVATORS,
    INITIAL_FLOORS,
    INITIAL_PASSENGERS,
    LEVEL_PASSENGER_BUMP_DIVISOR,
    MAX_BONUSES_PER_LEVEL,
    MAX_ELEVATORS,
    MAX_PAUSE_AT_FLOOR,
    MIN_PAUSE_AT_FLOOR,
    MIN_PENSION_BONUS,
    NO_RADAR_P,
    ODD_START_PERCENTAGE,
    PASSENGER_P,
    PENSION_BONUS_MULTIPLIER,
    PENSION_P,
    POSSIBLE_TRANSFERS_MULTIPLIER,
    RADAR_FLOORS_HIDDEN_MIN,
    RADAR_FLOOR_HIDDEN_MULTIPLIER,
    SLOT_LEVEL_MULTIPLIER,
    STARTING_SLOT_BUFFER,
    START_FLOOR,
    SYNERGY_BONUS,
    SYNERGY_P,
    TRANSFER_PAUSE_INCREMENT,
} from "../core/constants";
import { Bonus } from "./enums";
import { defaultRandom, randBetween, type RandomSource } from "./random";

/**
 * The original stores these values in UInt8/UInt16 fields and computes in
 * 32-bit float. Both matter: the building's cumulative floor count overflows
 * UInt16 around level 48, and the CEO stop time visibly accumulates float32
 * error. Reproducing the storage widths keeps the port bit-comparable with the
 * fixture in tests/levels.json.
 */
const u8 = (x: number): number => Math.trunc(x) & 0xff;
const u16 = (x: number): number => Math.trunc(x) & 0xffff;
const f32 = Math.fround;

/** C's truncf. */
const truncf = Math.trunc;

/**
 * `MROUND(x,rn) (((UInt16)((x) / (rn)) + 0.5f) * rn)` from GameController.h:217.
 *
 * Despite the name this is not round-to-nearest: it truncates to the multiple
 * below and then adds half a step, so MROUND(50,10) is 55, not 50. Floor counts
 * depend on that quirk, so it is reproduced exactly.
 */
function mround(x: number, rn: number): number {
    return (u16(x / rn) + 0.5) * rn;
}

export interface LevelParameters {
    level: number;
    floors: number;
    startFloor: number;
    stopFloor: number;
    /** Passengers the player's elevator starts the level with. */
    passengers: number;
    stopsByCEO: number;
    stopTimeByCEO: number;
    numberOfElevators: number;
    bonuses: number;
    /** Seconds a green elevator idles at a floor before moving on. */
    stopTime: number;
    elevatorSpeed: number;
    /** Starting passenger count for each transfer elevator, by index. */
    elevatorSlots: number[];
    /** Transfers required to complete the level. */
    transfersToLevelUp: number;
    possibleTransfers: number;
}

/**
 * Port of ElevatorCEO/Classes/GameLevelMaker.m.
 *
 * The original recomputes every level from level 1 on each call, carrying
 * "previous" and "current" values forward exactly like the design spreadsheet
 * it was transcribed from. That iteration is preserved because several values
 * compound (floors, CEO stop time, elevator speed) and cannot be evaluated in
 * closed form.
 */
export class LevelMaker {
    constructor(private readonly _random: RandomSource = defaultRandom) {}

    calculate(level: number): LevelParameters {
        if (level < 1) {
            throw new Error(`Level must be >= 1, received ${level}`);
        }

        let calcLevel = 1;

        // Level 1 is a special case that depends on no previous values.
        let levelCr = 1;
        let floorsCr = INITIAL_FLOORS;
        let startFloorCr = START_FLOOR;
        let stopFloorCr = INITIAL_FLOORS - 1;
        let elevatorCountCr = INITIAL_ELEVATORS;
        let passengersCr = INITIAL_PASSENGERS;
        let transfersToLevelUpCr = INITIAL_PASSENGERS - 1;
        let stopsByCeoCr = u8(Math.max(1, truncf(Math.trunc(floorsCr / CEO_STOP_DIVISOR))));
        let stopTimeByCeoCr = f32(CEO_STOP_TIME_MAX_SECONDS);
        let elevatorSpeedCr = BUTTON_MIN_SPEED;
        let bonusesCr = calcLevel < BONUSES_BEGIN_AT_LEVEL ? 0 : randBetween(this._random, 1, MAX_BONUSES_PER_LEVEL);
        let isOddTransferCr = transfersToLevelUpCr % 2 !== 0;
        let pOddCr = calcLevel % 5 === 0 ? f32(0.1) : f32(ODD_START_PERCENTAGE);
        let pOddActualCr = isOddTransferCr ? pOddCr : f32(1 - pOddCr);
        let pEvenCr = calcLevel % 5 === 0 ? f32(0.1) : f32(EVEN_START_PERCENTAGE);

        // Faithful port of a spreadsheet column the game never reads.
        let slotsCr = u8(
            transfersToLevelUpCr + Math.max(truncf(f32(STARTING_SLOT_BUFFER - f32(calcLevel * SLOT_LEVEL_MULTIPLIER))), 0)
        );

        /**
         * GameLevelMaker.m:88 uses MAX, not MIN, and reads the target `level`
         * rather than the loop counter, so this is computed once and never
         * drops below MAX_PAUSE_AT_FLOOR.
         */
        const stopTime = Math.max(f32(MIN_PAUSE_AT_FLOOR + f32((level - 1) * f32(TRANSFER_PAUSE_INCREMENT))), MAX_PAUSE_AT_FLOOR);

        let levelsToGo = level - 1;
        calcLevel++;

        while (levelsToGo > 0) {
            const floorsPr = floorsCr;
            const elevatorCountPr = elevatorCountCr;
            const passengersPr = passengersCr;
            const stopTimeByCeoPr = stopTimeByCeoCr;
            const elevatorSpeedPr = elevatorSpeedCr;
            const pOddPr = pOddCr;
            const pEvenPr = pEvenCr;

            levelCr = u8(levelCr + 1);

            if (calcLevel % LEVEL_PASSENGER_BUMP_DIVISOR === 0) {
                floorsCr = u16(mround(truncf(f32(floorsPr * f32(1 + f32(FLOOR_INCREMENT_FOR_PASSENGER_BUMP)))), 10));
            } else {
                floorsCr = u16(mround(truncf(f32(floorsPr * f32(1 + f32(FLOOR_INCREMENT_PERCENT)))), 10));
            }

            if (calcLevel % ELEVATOR_BUMP_DIVISOR === 0) {
                elevatorCountCr = u8(Math.min(elevatorCountPr + ELEVATOR_BUMP_INCREMENT, MAX_ELEVATORS));
            } else {
                elevatorCountCr = elevatorCountPr;
            }

            // Each level continues up the same building from where the last
            // stopped, which is why these overflow UInt16 in the high 40s.
            startFloorCr = u16(stopFloorCr + 1);
            stopFloorCr = u16(floorsCr + startFloorCr - 1);

            passengersCr = u8(
                calcLevel % LEVEL_PASSENGER_BUMP_DIVISOR === 0
                    ? passengersPr + LEVEL_PASSENGER_BUMP_DIVISOR
                    : passengersPr + 2
            );

            transfersToLevelUpCr = u8(passengersCr - 1);

            // GameLevelMaker.m:153 drops the level term present in the level-1
            // case, so this is constant from level 2 onward.
            slotsCr = u8(transfersToLevelUpCr + Math.max(truncf(f32(STARTING_SLOT_BUFFER - f32(SLOT_LEVEL_MULTIPLIER))), 0));

            // Integer division: both operands are integer types in the original.
            stopsByCeoCr = u8(Math.max(1, truncf(Math.trunc(floorsCr / CEO_STOP_DIVISOR))));

            stopTimeByCeoCr = Math.max(
                CEO_STOP_TIME_MIN_SECONDS,
                f32(stopTimeByCeoPr - f32(stopsByCeoCr * f32(FLOOR_INCREMENT_FOR_PASSENGER_BUMP)))
            );

            const levelBump = levelCr % BUTTON_SPEED_FLOOR_DIVISOR === 0;
            elevatorSpeedCr = u8(Math.min(BUTTON_MAX_UP_VALUE, levelBump ? elevatorSpeedPr + 1 : elevatorSpeedPr));

            isOddTransferCr = transfersToLevelUpCr % 2 !== 0;
            pOddCr = calcLevel % 5 === 0 ? f32(pOddPr - f32(0.1)) : pOddPr;
            pOddActualCr = isOddTransferCr ? pOddCr : f32(1 - pOddCr);
            pEvenCr = calcLevel % 5 === 0 ? f32(pEvenPr - f32(0.1)) : pEvenPr;

            bonusesCr = calcLevel < BONUSES_BEGIN_AT_LEVEL ? 0 : randBetween(this._random, 1, MAX_BONUSES_PER_LEVEL);

            levelsToGo--;
            calcLevel++;
        }

        const possibleTransfers = u8(truncf(f32(transfersToLevelUpCr * f32(POSSIBLE_TRANSFERS_MULTIPLIER))));
        const elevatorSlots = this._distributeSlots(
            transfersToLevelUpCr,
            elevatorCountCr,
            possibleTransfers,
            pOddActualCr
        );

        void slotsCr;

        return {
            level: levelCr,
            floors: floorsCr,
            startFloor: startFloorCr,
            stopFloor: stopFloorCr,
            passengers: passengersCr,
            stopsByCEO: stopsByCeoCr,
            stopTimeByCEO: stopTimeByCeoCr,
            numberOfElevators: elevatorCountCr,
            bonuses: bonusesCr,
            stopTime,
            elevatorSpeed: elevatorSpeedCr,
            elevatorSlots,
            transfersToLevelUp: transfersToLevelUpCr,
            possibleTransfers,
        };
    }

    /**
     * Passenger counts per transfer elevator (GameLevelMaker.m:220-271).
     *
     * Two quirks of the original are preserved:
     *
     * 1. `wMaxAllowedPerEl = ceilf(wPossibleTransfers/wElevatorCount)` divides
     *    two integers before calling ceilf, so it truncates rather than rounds up.
     * 2. The ODD()/EVEN() macros are `((x) % 2 == 0) ? (x++) : (x)` and its
     *    mirror. Post-increment yields the old value, so both return their
     *    argument unchanged and the odd/even biasing never had any effect. The
     *    probability draw is still performed because it consumes a random value.
     */
    private _distributeSlots(
        transfersToLevelUp: number,
        elevatorCount: number,
        possibleTransfers: number,
        pOddActual: number
    ): number[] {
        const levelUpIsOdd = transfersToLevelUp % 2 !== 0;
        // Guarded at 1: a zero here would make RANDBETWEEN divide by zero,
        // which is undefined behavior in the original but unreachable for
        // levels 1-50.
        const maxAllowedPerEl = Math.max(1, u8(Math.trunc(possibleTransfers / elevatorCount)));

        const slots = new Array<number>(elevatorCount).fill(0);
        let adjustment = possibleTransfers;

        for (let i = 0; i < elevatorCount; i++) {
            let result: number;
            if (i === 0) {
                // The first elevator is primed so the total parity can work out.
                result = levelUpIsOdd ? 1 : 2;
            } else {
                const candidate = randBetween(this._random, 1, maxAllowedPerEl);
                void (this._random.next() <= pOddActual);
                result = Math.min(candidate, maxAllowedPerEl);
            }
            slots[i] = result;
            adjustment -= result;
        }

        // Spread any shortfall round-robin, never touching index 0.
        if (elevatorCount > 1) {
            let i = 1;
            let guard = 0;
            while (adjustment > 0 && guard < 10_000) {
                slots[i] = (slots[i] ?? 0) + 1;
                adjustment--;
                i = i + 1 === elevatorCount ? 1 : i + 1;
                guard++;
            }
        }

        return slots;
    }

    /** GameLevelMaker.m:310-355. Probability bands over a single draw. */
    randomBonus(): Bonus {
        const value = this._random.next();

        let min = 0.001;
        let max = HEART_P;
        if (value >= min && value < max) {
            return Bonus.Heart;
        }

        min = max;
        max = PENSION_P + min;
        if (value >= min && value < max) {
            return Bonus.Pension;
        }

        min = max;
        max = DEATH_P + min;
        if (value >= min && value < max) {
            return Bonus.Death;
        }

        min = max;
        max = PASSENGER_P + min;
        if (value >= min && value < max) {
            return Bonus.Passenger;
        }

        min = max;
        max = NO_RADAR_P + min;
        if (value >= min && value < max) {
            return Bonus.NoRadar;
        }

        min = max;
        max = SYNERGY_P + min;
        if (value >= min && value < max) {
            return Bonus.Synergy;
        }

        return Bonus.None;
    }
}

/** GameLevelMaker.m:357-388. Value carried by a bonus at the given level. */
export function bonusValue(bonus: Bonus, level: number, floors: number): number {
    switch (bonus) {
        case Bonus.Heart:
            return 1;
        case Bonus.Pension: {
            if (level === 1) {
                return MIN_PENSION_BONUS;
            }
            // The original casts the multiplier term to UInt16 before
            // multiplying, so it truncates.
            const temp = u16(MIN_PENSION_BONUS * u16(f32(PENSION_BONUS_MULTIPLIER * level) - 1));
            return u16(mround(temp, 100));
        }
        case Bonus.NoRadar: {
            const temp = truncf(f32(f32(floors * f32(RADAR_FLOOR_HIDDEN_MULTIPLIER)) + RADAR_FLOORS_HIDDEN_MIN));
            return u16(mround(temp, 10));
        }
        case Bonus.Synergy:
            return SYNERGY_BONUS;
        case Bonus.None:
        case Bonus.Death:
        case Bonus.Passenger:
        default:
            return 0;
    }
}
