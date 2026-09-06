// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { MAX_ELS_IN_SHAFT, MAX_FLOOR_DIFF, MIN_FLOORS_BETWEEN_ELS } from "../core/constants";
import type { Bonus } from "./enums";
import type { CeoElevator } from "./ceoElevator";
import type { EventBus } from "./events";
import { randBetween, type RandomSource } from "./random";
import { TransferElevator } from "./transferElevator";

export interface FloorZone {
    minimum: number;
    maximum: number;
    startFloor: number;
}

/**
 * Divides [min, max] into `count` non-overlapping bands, one per elevator, and
 * picks a random starting floor inside each.
 *
 * Port of +[ShaftControl floorDataMinMax:elevators:floorMin:floorMax:]
 * (ShaftControl.m:363-389). Bands are separated by MIN_FLOORS_BETWEEN_ELS so
 * two cars in the same shaft cannot occupy the same floor, and each band's top
 * is randomized, which is what makes the cars' wander ranges uneven.
 */
export function computeFloorZones(
    random: RandomSource,
    count: number,
    min: number,
    max: number
): FloorZone[] {
    const zones: FloorZone[] = [];
    let maxWithRange = 0;

    for (let i = 0; i < count; i++) {
        let minFloor: number;
        let maxFloor: number;

        if (i === 0) {
            minFloor = min;
            // Integer division, as in the original.
            maxFloor = Math.trunc(Math.trunc((max - min) / count) - MIN_FLOORS_BETWEEN_ELS + min);
        } else {
            minFloor = maxWithRange + MIN_FLOORS_BETWEEN_ELS;
            maxFloor = Math.trunc(Math.trunc((max - minFloor) / (count - i)) + minFloor);
        }

        // randomMinFloor is undefined when min exceeds max; clamp so a narrow
        // band degenerates to a single floor rather than producing garbage.
        const rangeLow = minFloor + MAX_FLOOR_DIFF;
        maxWithRange = rangeLow > maxFloor ? maxFloor : randBetween(random, rangeLow, maxFloor);
        if (maxWithRange < minFloor) {
            maxWithRange = minFloor;
        }

        const startFloor = randBetween(random, minFloor, maxWithRange);
        zones.push({ minimum: minFloor, maximum: maxWithRange, startFloor });
    }

    return zones;
}

/**
 * Port of ElevatorCEO/Classes/ShaftControl.m.
 *
 * One shaft owns up to six transfer elevators, and the rightmost shaft also
 * owns the CEO. Beyond wandering the cars around when they idle, this runs the
 * three-phase CEO sequence: clear the shaft, send the CEO up through its stops,
 * then retire it if the player never boards.
 */
export class Shaft {
    readonly elevators: TransferElevator[] = [];
    ceo: CeoElevator | null = null;

    activeElevators = 0;
    bonusCount = 0;

    private _startFloor = 0;
    private _stopFloor = 0;

    private _getReadyForCeo = false;
    private _isReadyForCeo = false;
    private _processingCeo = false;
    private _ceoPreviewFloor = 0xffff;
    private _gotCeoPreviewFloor = false;

    constructor(
        readonly index: number,
        private readonly _random: RandomSource,
        events: EventBus
    ) {
        for (let i = 0; i < MAX_ELS_IN_SHAFT; i++) {
            this.elevators.push(new TransferElevator(index * MAX_ELS_IN_SHAFT + i, events));
        }
    }

    get gettingReadyForCeo(): boolean {
        return this._getReadyForCeo;
    }

    get ceoPreviewFloor(): number {
        return this._ceoPreviewFloor;
    }

    setShaftX(x: number): void {
        for (const elevator of this.elevators) {
            elevator.x = x;
        }
        if (this.ceo) {
            this.ceo.x = x;
        }
    }

    setActiveElevators(count: number): void {
        if (count <= MAX_ELS_IN_SHAFT) {
            this.activeElevators = count;
        }
    }

    /** ShaftControl.m:231-257. */
    reset(): void {
        this._isReadyForCeo = false;
        this._getReadyForCeo = false;
        this._processingCeo = false;
        this._ceoPreviewFloor = 0xffff;
        this._gotCeoPreviewFloor = false;
        this.bonusCount = 0;
        this.activeElevators = 0;

        for (const elevator of this.elevators) {
            elevator.initializeLevel();
            elevator.activeInGame = false;
        }

        if (this.ceo) {
            this.ceo.initializeLevel();
            this.ceo.floorGoingToPreview = 0xffff;
        }
    }

    /**
     * ShaftControl.m:141-229. Assigns floor bands, starting floors, bonuses and
     * active flags for this level.
     */
    initializeShaft(
        startFloor: number,
        stopFloor: number,
        drawBonus: () => Bonus,
        bonusPassengerCount: () => number,
        ceoStops: number,
        ceoStopTime: number
    ): void {
        this._isReadyForCeo = false;
        this._getReadyForCeo = false;
        this._processingCeo = false;
        this._ceoPreviewFloor = 0xffff;
        this._gotCeoPreviewFloor = false;

        this._startFloor = startFloor;
        this._stopFloor = stopFloor;

        const zones = computeFloorZones(this._random, Math.max(1, this.activeElevators), startFloor, stopFloor);

        const bonuses: Bonus[] = [];
        for (let b = 0; b < this.bonusCount; b++) {
            bonuses.push(drawBonus());
        }

        let remaining = this.activeElevators;
        let bonusIndex = 0;

        this.elevators.forEach((elevator, i) => {
            if (remaining > 0) {
                const zone = zones[i] ?? zones[zones.length - 1]!;
                elevator.setFloorMinMax(startFloor, stopFloor);
                elevator.setFloorRange(zone.minimum, zone.maximum);
                elevator.setTo(zone.startFloor);

                // The control layer flags bonus elevators by seeding them with
                // UINT8_MAX passengers (GameControlLayer.m:458).
                if (elevator.passengersOnboard === 0xff && bonusIndex < bonuses.length) {
                    const bonus = bonuses[bonusIndex]!;
                    elevator.setBonus(bonus);
                    elevator.initializePassengers(bonus === 4 ? bonusPassengerCount() : 0);
                    bonusIndex++;
                } else {
                    elevator.setBonus(0);
                }

                elevator.activeInGame = true;
                remaining--;
            } else {
                elevator.setFloorMinMax(startFloor, stopFloor);
                elevator.setBonus(0);
                elevator.activeInGame = false;
            }
        });

        if (this.ceo) {
            const ceoTop = stopFloor + MIN_FLOORS_BETWEEN_ELS;
            this.ceo.setFloorMinMax(startFloor, ceoTop);
            this.ceo.setFloorRange(startFloor, ceoTop);
            this.ceo.setTo(startFloor - 1);
            this.ceo.totalStops = ceoStops;
            this.ceo.stopsRemaining = ceoStops;
            this.ceo.timeAtEachStop = ceoStopTime;
            this.ceo.activeInGame = false;
        }
    }

    /**
     * ShaftControl.m:123-137. Called once the player is down to a single
     * passenger. Precomputes the CEO's first stop so the radar can preview it.
     */
    clearForCeo(): void {
        if (!this.ceo) {
            return;
        }
        if (!this._gotCeoPreviewFloor) {
            const intermediate =
                Math.floor(
                    (this.ceo.floorRangeMax - this.ceo.floor - MIN_FLOORS_BETWEEN_ELS) / Math.max(1, this.ceo.stopsRemaining)
                ) + this.ceo.floor;
            const target = randBetween(this._random, this.ceo.floor + 1, Math.max(this.ceo.floor + 1, intermediate));
            this._ceoPreviewFloor = target;
            this.ceo.floorGoingToPreview = target;
            this._gotCeoPreviewFloor = true;
        }
        this._getReadyForCeo = true;
    }

    /** ShaftControl.m:259-356. */
    update(dt: number, stopTime: number, elevatorSpeed: number): void {
        let activeCount = 0;

        for (const elevator of this.elevators) {
            if (!elevator.activeInGame) {
                continue;
            }
            activeCount++;

            if (elevator.timeAtFloor >= stopTime && !this._getReadyForCeo) {
                // Wander to a different floor inside this car's band, never onto
                // a floor another car in this shaft already occupies.
                const occupied = this._occupiedFloors(elevator);
                const target = this._pickDifferentFloor(
                    elevator.floorRangeMin,
                    elevator.floorRangeMax,
                    elevator.floor,
                    occupied
                );
                if (target !== null) {
                    elevator.moveTo(target, elevatorSpeed);
                }
            } else if (this._getReadyForCeo && this.activeElevators > 0) {
                // Everything vacates upward to make room for the CEO.
                const exitFloor = this._stopFloor + 3;
                if (elevator.floorGoingTo !== exitFloor) {
                    elevator.setFloorMinMax(this._startFloor, this._stopFloor + 2);
                    elevator.moveTo(exitFloor, elevatorSpeed, true);
                } else if (elevator.floor === exitFloor) {
                    elevator.activeInGame = false;
                }
            }
        }

        if (activeCount === 0) {
            this._isReadyForCeo = true;
        }

        if (this._processingCeo && this.ceo) {
            this._updateCeoSchedule(elevatorSpeed);
        }

        if (this._isReadyForCeo && !this._processingCeo && this.ceo) {
            this.ceo.activeInGame = true;
            this._processingCeo = true;
            this.ceo.setTo(this._startFloor - 1);
            this.ceo.moveTo(this._startFloor, elevatorSpeed);
        }

        void dt;
    }

    /** ShaftControl.m:309-344. */
    private _updateCeoSchedule(elevatorSpeed: number): void {
        const ceo = this.ceo!;
        const timeOk = ceo.timeAtFloor >= ceo.timeAtEachStop;
        const firstMove = ceo.stopsRemaining === ceo.totalStops;
        const goingToFloor = ceo.floorGoingTo !== ceo.floor;

        if (!((timeOk || firstMove) && !goingToFloor)) {
            return;
        }

        if (ceo.stopsRemaining > 0) {
            let target: number;
            if (this._gotCeoPreviewFloor) {
                target = this._ceoPreviewFloor;
            } else {
                // Spread the remaining stops evenly over the floors left.
                const intermediate =
                    Math.floor((ceo.floorRangeMax - ceo.floor - MIN_FLOORS_BETWEEN_ELS) / Math.max(1, ceo.stopsRemaining)) +
                    ceo.floor;
                target = randBetween(this._random, ceo.floor + 1, Math.max(ceo.floor + 1, intermediate));
            }
            ceo.moveTo(target, elevatorSpeed);
            ceo.stopsRemaining--;
        } else {
            // Out of stops: the CEO leaves and the player has missed the level.
            ceo.floorGoingToPreview = 0xffff;
            this._getReadyForCeo = false;
            ceo.moveTo(ceo.floorRangeMax, elevatorSpeed);
        }
    }

    private _occupiedFloors(except: TransferElevator): Set<number> {
        const occupied = new Set<number>();
        for (const elevator of this.elevators) {
            if (!elevator.activeInGame || elevator === except) {
                continue;
            }
            occupied.add(elevator.floor);
            occupied.add(elevator.floorGoingTo);
        }
        return occupied;
    }

    private _pickDifferentFloor(
        min: number,
        max: number,
        current: number,
        occupied: Set<number> = new Set()
    ): number | null {
        if (max < min) {
            return null;
        }
        const isFree = (floor: number): boolean => floor !== current && !occupied.has(floor);
        if (max === min) {
            return isFree(min) ? min : null;
        }
        // The original looped until it drew a different floor; bound it so a
        // degenerate range cannot spin forever, then scan the band as a fallback
        // so a busy shaft stays put rather than overlapping.
        for (let attempt = 0; attempt < 32; attempt++) {
            const candidate = randBetween(this._random, min, max);
            if (isFree(candidate)) {
                return candidate;
            }
        }
        for (let floor = min; floor <= max; floor++) {
            if (isFree(floor)) {
                return floor;
            }
        }
        return null;
    }
}
