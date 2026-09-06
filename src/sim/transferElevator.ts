// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import {
    ELEVATOR_SETTLE_TIME,
    FLOOR_BOTTOM_GAP,
    FLOOR_HEIGHT,
    SYNERGY_BUMP,
    TRANSFER_VALUE,
} from "../core/constants";
import { SimTween, bounceOut } from "./easing";
import { Bonus, Movement } from "./enums";
import type { EventBus } from "./events";
import { HALF_CAR_HEIGHT } from "./ownElevator";

/**
 * Seconds the chest animation plus bonus reveal takes (BaseTransferElevator.m:352-376).
 * 5 chest frames × 0.2s + fade out 0.5s + prize fade-in 0.5s + hold 1.0s.
 */
export const BONUS_REVEAL_SECONDS = 3.0;

/**
 * Port of ElevatorCEO/Classes/BaseTransferElevator.m and TransferElevator.m.
 *
 * Positions are in floor-layer space, so the whole shaft scrolls for free when
 * the layer does; only the floor-relative maths lives here.
 */
export class TransferElevator {
    readonly id: number;

    x = 0;
    /** Center of the car, in floor-layer space. */
    y = HALF_CAR_HEIGHT;

    floor = 0;
    floorGoingTo = 0;
    floorMin = 0;
    floorMax = 0;

    /** Range this elevator wanders within when idle, distinct from its travel bounds. */
    floorRangeMin = 0;
    floorRangeMax = 0;

    passengersOnboard = 0;
    bonus: Bonus = Bonus.None;
    /**
     * Bumped on every `setBonus`, even when the kind is unchanged. The view
     * keys off this so a second pension chest on the same car resets like
     * BaseTransferElevator.m:260-286, which always re-applied the sprites.
     */
    bonusChangeCounter = 0;

    activeInGame = false;
    inTransit = false;
    reachedFloor = false;
    touched = false;
    displayingBonus = false;

    movementDir: Movement = Movement.Stopped;

    /** Seconds parked at the current floor, which drives the timer bars. */
    timeAtFloor = 0;
    /** 0..100, mirrored by the eight-bar ElevatorTimer indicator. */
    timerPercent = 100;

    protected _speed = 0;
    protected _move = 0;
    protected _prevY = HALF_CAR_HEIGHT;
    protected _floorGoingToY = 0;
    protected _topFloorBottomY = 0;
    protected _bottomFloorBottomY = 0;
    protected _shouldComeToRest = false;
    protected _comingToRest = false;
    protected _bounce = new SimTween();
    private _bonusTimer = 0;

    constructor(
        id: number,
        protected readonly _events: EventBus
    ) {
        this.id = id;
    }

    // -- Setup -------------------------------------------------------------

    /** BaseTransferElevator.m:80-90. */
    setFloorMinMax(min: number, max: number): void {
        this.floorMin = min;
        this.floorMax = max;
        this._topFloorBottomY = max * FLOOR_HEIGHT;
        this._bottomFloorBottomY = 0;
    }

    setFloorRange(min: number, max: number): void {
        this.floorRangeMin = min;
        this.floorRangeMax = max;
    }

    /** BaseTransferElevator.m:64-77. Places the car instantly, no animation. */
    setTo(floor: number): void {
        this.floor = floor;
        this.floorGoingTo = floor;
        this.y = FLOOR_HEIGHT * (floor - this.floorMin);
        this._prevY = this.y;
        this._speed = 0;
        this._move = 0;
        this.movementDir = Movement.Stopped;
        this.timeAtFloor = 0;
        this.inTransit = false;
        this.reachedFloor = true;
        this._cancelSettle();
    }

    initializePassengers(count: number): void {
        this.passengersOnboard = count;
    }

    setBonus(bonus: Bonus): void {
        this.bonus = bonus;
        this.bonusChangeCounter++;
    }

    /** BaseTransferElevator.m:381-396. */
    initializeLevel(): void {
        this.touched = false;
        this._move = 0;
        this._prevY = this.y;
        this.reachedFloor = false;
        this.inTransit = false;
        this._floorGoingToY = 0;
        this.floorRangeMin = 0;
        this.floorRangeMax = 0;
        this.floor = 0;
        this.floorGoingTo = 0;
        this.timeAtFloor = 0;
        this.floorMin = 0;
        this.floorMax = 0;
        this.movementDir = Movement.Stopped;
        this.displayingBonus = false;
        this.timerPercent = 100;
        this._speed = 0;
        this._cancelSettle();
    }

    // -- Motion ------------------------------------------------------------

    /** BaseTransferElevator.m:48-61. Ignores a request for the current target. */
    moveTo(floor: number, speed: number, overrideMinMax = false): void {
        const inBuilding = floor >= this.floorMin && floor <= this.floorMax;
        const rangeIsSet = this.floorRangeMin !== 0 || this.floorRangeMax !== 0;
        const inWanderRange =
            !rangeIsSet || (floor >= this.floorRangeMin && floor <= this.floorRangeMax);
        const goodFloor = (inBuilding && inWanderRange) || overrideMinMax;
        if (!goodFloor || floor === this.floorGoingTo) {
            return;
        }

        this.floorGoingTo = floor;
        this._floorGoingToY = (floor - this.floorMin) * FLOOR_HEIGHT - FLOOR_BOTTOM_GAP;
        this.reachedFloor = false;
        this.inTransit = true;
        this._moveSpeed(speed, floor < this.floor);
    }

    /** BaseTransferElevator.m:105-136. */
    protected _moveSpeed(speed: number, down: boolean): void {
        if (speed > 0) {
            // A new trip must be allowed to settle; canceling the tween alone
            // would leave `_comingToRest` latched and the car would fly through
            // its destination into another elevator's floors.
            this._cancelSettle();
            this._move = down ? -(speed * FLOOR_HEIGHT) : speed * FLOOR_HEIGHT;
            this.movementDir = down ? Movement.Down : Movement.Up;
        } else {
            this._move = 0;
            this.movementDir = Movement.Stopped;
        }

        this._shouldComeToRest = this._speed > 0 && speed === 0;
        this._speed = speed;
    }

    /** BaseTransferElevator.m:138-245. */
    update(dt: number, stopTime: number): void {
        this._updateBonusReveal(dt);
        this._updateTimer(dt, stopTime);

        const moveDist = this._move * dt;

        let moveDiff = 0;
        if (Math.abs(this.y - this._prevY) > 0.5) {
            moveDiff = this.y - this._prevY;
            this._prevY = this.y;
        }

        let newY: number;
        if (this._speed > 0) {
            newY = this.y + moveDist;
        } else {
            this._move = moveDiff;
            newY = this.y + moveDist;
        }

        const atMax = newY >= this._topFloorBottomY + HALF_CAR_HEIGHT;
        const atMin = newY <= this._bottomFloorBottomY + HALF_CAR_HEIGHT;

        if (atMax) {
            this.y = this._topFloorBottomY + HALF_CAR_HEIGHT;
            this.stopBounce();
        } else if (atMin) {
            this.y = this._bottomFloorBottomY + HALF_CAR_HEIGHT;
            this.stopBounce();
        } else if (!this._bounce.active) {
            this.y = newY;
        }

        // BaseTransferElevator.m:200
        const newFloor = Math.trunc(this.y / FLOOR_HEIGHT) + this.floorMin;
        if (newFloor !== this.floor) {
            this.floor = newFloor;
        }

        if (this._speed !== 0 && this._hasReachedOrPassedDestination()) {
            this._shouldComeToRest = true;
            this.movementDir = Movement.Stopping;
        }

        // A wider look-ahead going up than down, because gravity is not
        // symmetrical in the original's feel.
        const buffer = this._move < 0 ? FLOOR_HEIGHT / 4 : FLOOR_HEIGHT / 1.5;
        if (Math.abs(this.y - (this._floorGoingToY + buffer)) <= 0.5) {
            this._shouldComeToRest = true;
            this.movementDir = Movement.Stopping;
        }

        if (this._shouldComeToRest && !this._comingToRest) {
            this._comingToRest = true;
            this.movementDir = Movement.Stopping;
            const target = this._floorGoingToY + FLOOR_HEIGHT / 2;
            this._bounce.start(this.y, target, ELEVATOR_SETTLE_TIME, bounceOut, () => this.stopBounce());
        }

        const value = this._bounce.update(dt);
        if (value !== null) {
            this.y = value;
            this._prevY = value;
        }
    }

    /**
     * Drops an in-progress settle without treating it as arrival. The original
     * `setTo:` cleared `mComingToRest`; the port must too, or the next `moveTo`
     * never starts a bounce and the car overshoots into another band.
     */
    private _cancelSettle(): void {
        this._shouldComeToRest = false;
        this._comingToRest = false;
        this._bounce.cancel();
    }

    /** True once the car has reached or skipped past `floorGoingTo`. */
    private _hasReachedOrPassedDestination(): boolean {
        if (this.floor === this.floorGoingTo) {
            return true;
        }
        if (this._move > 0) {
            return this.floor > this.floorGoingTo;
        }
        if (this._move < 0) {
            return this.floor < this.floorGoingTo;
        }
        return false;
    }

    /** BaseTransferElevator.m:247-258. */
    stopBounce(): void {
        this._speed = 0;
        this._move = 0;
        this.movementDir = Movement.Stopped;
        this._shouldComeToRest = false;
        this._comingToRest = false;
        this.inTransit = false;
        this.reachedFloor = true;
        this._bounce.cancel();
    }

    /** BaseTransferElevator.m:138-156. */
    private _updateTimer(dt: number, stopTime: number): void {
        if (!this.inTransit && !this.displayingBonus) {
            this.timeAtFloor += dt;
            if (this.passengersOnboard > 0) {
                this.timerPercent = ((stopTime - this.timeAtFloor) / stopTime) * 100;
            }
        } else {
            this.timeAtFloor = 0;
        }
    }

    // -- Interaction -------------------------------------------------------

    /**
     * Whether the passenger balloon should be drawn. The car stays
     * `activeInGame` after a tap (it still wanders), but BaseTransferElevator.m
     * hides the balloon as soon as passengers transfer or a bonus finishes.
     */
    get showPassengerBalloon(): boolean {
        if (!this.activeInGame) {
            return false;
        }
        return !(this.touched && this.passengersOnboard === 0 && !this.displayingBonus);
    }

    /**
     * BaseTransferElevator.m:300-318. The player must be on the same floor and
     * the car must be parked. There is no pixel-distance test: floor equality
     * is the whole condition.
     */
    canBeTouchedBy(ownFloor: number): boolean {
        return this.activeInGame && !this.touched && !this.inTransit && this.floor === ownFloor;
    }

    /**
     * BaseTransferElevator.m:320-376. Returns the pension and synergy the
     * player earns, or null when the tap was rejected.
     */
    tap(ownFloor: number): { pension: number; synergy: number; passengers: number } | null {
        if (!this.canBeTouchedBy(ownFloor)) {
            return null;
        }
        this.touched = true;

        if (this.bonus !== Bonus.None) {
            this.displayingBonus = true;
            this._bonusTimer = 0;
            this._events.emit({ type: "chestOpening", elevatorId: this.id });
            return null;
        }

        const passengers = this.passengersOnboard;
        const pension = passengers * TRANSFER_VALUE;
        const synergy = passengers * SYNERGY_BUMP;
        this.passengersOnboard = 0;

        this._events.emit({ type: "transfer", elevatorId: this.id, passengers, pension, synergy });
        this._events.emit({ type: "pensionAward", elevatorId: this.id, amount: pension });
        this._events.emit({ type: "poof", elevatorId: this.id });

        return { pension, synergy, passengers };
    }

    /** Fires once the chest animation has run its course. */
    onBonusResolved: ((bonus: Bonus, passengers: number) => void) | null = null;

    private _updateBonusReveal(dt: number): void {
        if (!this.displayingBonus) {
            return;
        }
        this._bonusTimer += dt;
        if (this._bonusTimer < BONUS_REVEAL_SECONDS) {
            return;
        }

        // BaseTransferElevator.m:398-445
        this.displayingBonus = false;
        const bonus = this.bonus;
        const passengers = this.passengersOnboard;
        this.passengersOnboard = 0;
        this._events.emit({ type: "poof", elevatorId: this.id });
        this.onBonusResolved?.(bonus, passengers);
    }
}
