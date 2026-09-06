// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import {
    BEGIN_SCROLL_DOWN_ON_FLOOR,
    BEGIN_SCROLL_UP_ON_FLOOR,
    ELEVATOR_SETTLE_TIME,
    ELEVATOR_SHAFT_WIDTH,
    FLOOR_HEIGHT,
    GAME_STARTING_LIVES,
    NUM_LIFE_INDICATORS,
    PLAY_AREA_MARGIN,
    SPEED_FOR_BUTTON_TAP,
    STARTING_SYNERGY,
    SYNERGY_PER_FLOOR,
} from "../core/constants";
import { SimTween, bounceOut } from "./easing";
import { Movement } from "./enums";
import type { EventBus } from "./events";
import type { FloorGeometry } from "./geometry";

/** Half the height of el-blue-game.png in design points (76x104 px at 2x). */
export const HALF_CAR_HEIGHT = 26;

const UP_SCROLL_POINT = BEGIN_SCROLL_UP_ON_FLOOR * FLOOR_HEIGHT;
const DOWN_SCROLL_POINT = BEGIN_SCROLL_DOWN_ON_FLOOR * FLOOR_HEIGHT;

/** How far the death animation drops the car, in design points. */
const DEATH_FALL_DISTANCE = 588;
/** AudioController.h:19. */
const CRASH_FALL_SPAN = 4.0;

/**
 * Port of ElevatorCEO/Classes/OwnGameElevator.m, rules only.
 *
 * The original's `update:` mixed physics, synergy accounting, floor scrolling
 * and CCAction bounces in one 300-line method. The structure is preserved so
 * the behavior matches, but every rendering call is gone: the view reads this
 * object's public state each frame and draws it.
 */
export class OwnElevator {
    /** Center of the car, in play-area space. Bottom of the car sits at y - 26. */
    y = HALF_CAR_HEIGHT;
    readonly x = PLAY_AREA_MARGIN + ELEVATOR_SHAFT_WIDTH / 2;

    floor = 0;
    floorMin = 0;
    floorMax = 0;

    passengersOnboard = 0;
    synergy = STARTING_SYNERGY;
    lives = GAME_STARTING_LIVES;

    movementDir: Movement = Movement.Stopped;

    deathSequencePlaying = false;
    synergyDeathSequencePlaying = false;
    levelUpPlaying = false;
    movedToCeoElevator = false;

    atTopFloor = false;
    atBottomFloor = true;

    /** Vertical offset applied by the death fall, for the view to render. */
    deathFallY = 0;

    private _speed = 0;
    private _move = 0;
    private _goingDown = false;
    private _prevFloor = 0;
    private _prevY = HALF_CAR_HEIGHT;

    private _tapped = false;
    private _tapDistance = 0;
    private _shouldComeToRest = false;
    private _comingToRest = false;

    /** Settle bounce. Drives either the car or the floor layer, never both. */
    private _bounce = new SimTween();
    private _bounceTarget: "car" | "floor" = "car";
    private _deathTween = new SimTween();
    private _deathTimer = 0;

    constructor(
        private readonly _floors: FloorGeometry,
        private readonly _events: EventBus
    ) {}

    // -- Level lifecycle ---------------------------------------------------

    /** OwnGameElevator.m:547-557 plus the setup GameControlLayer performs. */
    initializeLevel(floorMin: number, floorMax: number, passengers: number): void {
        this.floorMin = floorMin;
        this.floorMax = floorMax;
        this.floor = floorMin;
        this._prevFloor = floorMin;
        this.passengersOnboard = passengers;

        this.synergy = STARTING_SYNERGY;
        this.levelUpPlaying = false;
        this.movedToCeoElevator = false;
        this.synergyDeathSequencePlaying = false;
        this.deathSequencePlaying = false;
        this.atTopFloor = false;
        this.atBottomFloor = true;

        this.setToBottomFloor();
        this._resetMotion();
    }

    /** OwnGameElevator.m:684-687. */
    setToBottomFloor(): void {
        this.y = HALF_CAR_HEIGHT;
        this._prevY = this.y;
        this.deathFallY = 0;
    }

    private _resetMotion(): void {
        this._speed = 0;
        this._move = 0;
        this._floorSpeed = 0;
        this._goingDown = false;
        this._tapped = false;
        this._tapDistance = 0;
        this._shouldComeToRest = false;
        this._comingToRest = false;
        this.movementDir = Movement.Stopped;
        this._bounce.cancel();
        this._deathTween.cancel();
    }

    // -- Input -------------------------------------------------------------

    /** OwnGameElevator.m:689-698. */
    get isUpControlAllowable(): boolean {
        return !(this.deathSequencePlaying || this.synergyDeathSequencePlaying || this.atTopFloor || this.passengersOnboard === 0);
    }

    /** OwnGameElevator.m:700-709. */
    get isDownControlAllowable(): boolean {
        return !(
            this.deathSequencePlaying ||
            this.synergyDeathSequencePlaying ||
            this.atBottomFloor ||
            this.passengersOnboard === 0
        );
    }

    /**
     * OwnGameElevator.m:139-234.
     *
     * A tap requests exactly one floor of travel and latches `_tapped` until
     * the distance is consumed; a hold sets a continuous speed. Releasing from
     * a non-zero speed triggers the settle bounce.
     */
    moveSpeed(speed: number, tap: boolean, down: boolean): void {
        if ((this._tapped && tap) || this._comingToRest || this.deathSequencePlaying || this.synergyDeathSequencePlaying) {
            return;
        }
        if (this.movedToCeoElevator) {
            return;
        }

        const tempSpeed = tap ? SPEED_FOR_BUTTON_TAP : speed;

        if (tap && !this._tapped) {
            const currentFloor = this._floors.floorFromPosition(this.y);
            if (currentFloor - 1 >= this.floorMin || currentFloor + 1 <= this.floorMax) {
                const desiredFloor = down ? currentFloor - 1 : currentFloor + 1;
                const distance = this._floors.distanceToFloorBottom(desiredFloor, this.y - HALF_CAR_HEIGHT);
                // The sign is carried by the direction, so the distance is
                // stored as a magnitude. The +/-5 nudge is from the original.
                this._tapDistance = Math.abs(down ? distance - 5 : distance + 5);
                this._tapped = true;
            }
        } else if (!tap) {
            this._events.emit({ type: "elevatorMoving" });
            this._tapped = false;
            this._tapDistance = -15;
        }

        if (tempSpeed > 0) {
            this._move = down ? -(tempSpeed * FLOOR_HEIGHT) : tempSpeed * FLOOR_HEIGHT;
            this.movementDir = down ? Movement.Down : Movement.Up;
        } else {
            this._move = 0;
            this.movementDir = Movement.Stopped;
        }

        if (this._speed > 0 && tempSpeed === 0) {
            this._shouldComeToRest = true;
            this.movementDir = Movement.Stopping;
            this._events.emit({ type: "elevatorStopping" });
        } else {
            this._shouldComeToRest = false;
        }

        this._speed = tempSpeed;
        this._goingDown = down;
    }

    // -- Passengers and lives ---------------------------------------------

    /** OwnGameElevator.m:113-132. Reaching zero passengers costs a life. */
    removePassengers(count: number): void {
        this.passengersOnboard = Math.max(this.passengersOnboard - count, 0);
        if (this.passengersOnboard === 0) {
            this.setLives(this.lives - 1);
        }
    }

    /** OwnGameElevator.m:623-641. The CEO case hides the balloon instead. */
    removePassengersForCeo(): void {
        this.movedToCeoElevator = true;
    }

    addLife(): void {
        this.setLives(this.lives + 1);
    }

    /** OwnGameElevator.m:570-615. A decrease starts the crash sequence. */
    setLives(value: number): void {
        if (value === this.lives || value > NUM_LIFE_INDICATORS) {
            return;
        }

        if (value < this.lives) {
            this.deathSequencePlaying = true;
            this._deathTimer = 0;
            this.deathFallY = 0;
            // CCEaseElasticIn over 3s, then a 4s pause before the level resets.
            this._deathTween.start(0, -DEATH_FALL_DISTANCE, 3.0, (t) => t * t * t, () => {
                this._deathTimer = 0;
            });
            this._events.emit({ type: "elevatorCrash" });
            this._events.emit({ type: "lifeLost", livesRemaining: value });
        }

        this.lives = value;
    }

    // -- Per-frame update --------------------------------------------------

    /** OwnGameElevator.m:236-532. */
    update(dt: number): void {
        if (this.deathSequencePlaying) {
            this._updateDeath(dt);
            return;
        }

        const moveDist = this._move * dt;

        // The original inferred implicit motion from the previous position so
        // that a bounce driven by CCAction still registered as movement.
        let moveDiff = 0;
        if (Math.abs(this.y - this._prevY) > 0.5) {
            moveDiff = this.y - this._prevY;
            this._prevY = this.y;
        }

        const currentFloor = this._floors.floorFromPosition(this.y);
        if (currentFloor === 0) {
            // Outside the sprite ring: the original bailed out of the frame.
            return;
        }

        if (this.synergyDeathSequencePlaying && !this.deathSequencePlaying) {
            this.removePassengers(this.passengersOnboard);
        }

        if (currentFloor !== this._prevFloor) {
            this._onFloorCrossed(currentFloor);
        }

        let newY: number;
        if (this._speed > 0) {
            newY = this.y + moveDist;
        } else {
            this._move = moveDiff;
            newY = this.y + moveDist;
        }

        if (this._tapped) {
            if (this._tapDistance > 0) {
                this._tapDistance -= Math.abs(moveDist);
            } else {
                this._tapDistance = -1;
                // Distance consumed, so release into the settle bounce.
                this.moveSpeed(0, false, false);
            }
        }

        const shouldScrollUp = newY + HALF_CAR_HEIGHT > UP_SCROLL_POINT && this._move > 0 && this._floors.canElevatorMoveUp;
        const shouldScrollDown =
            newY + HALF_CAR_HEIGHT < DOWN_SCROLL_POINT && this._move < 0 && this._floors.canElevatorMoveDown;
        const layerAtMax = !this._floors.canElevatorMoveUp && this._floors.canElevatorMoveDown;
        const layerAtMin = !this._floors.canElevatorMoveDown && this._floors.canElevatorMoveUp;

        // Near the ends of the building the layer cannot scroll any further, so
        // the car itself has to cover the remaining distance. Clamp to the rest
        // position of the end floor, not the top of the viewport: ceilingY is one
        // floor band higher than the highest floor's line (OwnGameElevator.m:347-350
        // uses the viewport formula, which leaves the car 8px high until settle).
        const topRestY = this._floors.floorBottomY(this.floorMax) + HALF_CAR_HEIGHT;
        const bottomRestY = this._floors.floorBottomY(this.floorMin) + HALF_CAR_HEIGHT;
        if (layerAtMax) {
            if (this._move > 0) {
                newY = Math.min(this.y + moveDist, topRestY);
            } else {
                newY = this.y + moveDist;
            }
        } else if (layerAtMin) {
            if (this._move < 0) {
                newY = Math.max(this.y + moveDist, bottomRestY);
            } else {
                newY = this.y + moveDist;
            }
        }

        // OwnGameElevator.m:353-397: crossing a scroll threshold stops the car
        // and moves the floor layer instead. Do not snap y to the scroll point —
        // that re-triggers the threshold test next frame and makes the car
        // bounce around DOWN_SCROLL_POINT when descending from the top.
        if (!shouldScrollUp && !shouldScrollDown) {
            if (!this._bounce.active || this._bounceTarget !== "car") {
                this.y = newY;
            }
        }

        this._updateScroll(dt, shouldScrollUp, shouldScrollDown, moveDist, currentFloor);
        this._updateSettle(currentFloor);
        this._advanceBounce(dt);
    }

    /** OwnGameElevator.m:262-302. Crossing a floor is what drains synergy. */
    private _onFloorCrossed(currentFloor: number): void {
        this.atTopFloor = currentFloor === this.floorMax;
        this.atBottomFloor = currentFloor === this.floorMin;
        this._prevFloor = currentFloor;
        this.floor = currentFloor;

        const totalFloors = this.floorMax - this.floorMin + 1;
        this.synergy -= (100.0 / totalFloors) * SYNERGY_PER_FLOOR;

        if (this.synergy <= 0 && !this.deathSequencePlaying && !this.synergyDeathSequencePlaying) {
            this.synergyDeathSequencePlaying = true;
            if (this._tapped) {
                this._shouldComeToRest = true;
                this._tapDistance = -1;
            } else if (this.movementDir === Movement.Down) {
                this.moveSpeed(0, true, true);
            } else if (this.movementDir === Movement.Up) {
                this.moveSpeed(0, true, false);
            }
        }
    }

    /** OwnGameElevator.m:400-463. Scrolls the building past a stationary car. */
    private _updateScroll(
        dt: number,
        shouldScrollUp: boolean,
        shouldScrollDown: boolean,
        moveDist: number,
        currentFloor: number
    ): void {
        if (this._bounce.active) {
            this._floorSpeed = 0;
            return;
        }

        const scrolling =
            (shouldScrollUp && (this._shouldComeToRest || this._speed > 0)) ||
            (shouldScrollDown && (this._shouldComeToRest || this._speed > 0));

        if (!scrolling) {
            if (this._speed === 0) {
                // Idle: make sure the layer is not drifting.
                this._floorSpeed = 0;
            }
            return;
        }

        let calcSpeed = Math.abs(this._move / ELEVATOR_SETTLE_TIME);

        if (this._speed === 0 && calcSpeed > 0 && Math.abs(moveDist) > 0.2) {
            if (this._comingToRest) {
                const distance = this._floors.distanceToFloorBottom(currentFloor, this.y - HALF_CAR_HEIGHT);
                calcSpeed = Math.abs(distance / 2 / ELEVATOR_SETTLE_TIME);
            }
            this._floorSpeed = calcSpeed;
        } else {
            this._floorSpeed = this._speed;
        }

        void dt;
    }

    /** Speed handed to the floor layer this frame, in floors per second. */
    private _floorSpeed = 0;

    /**
     * Applies the scroll the elevator requested. Called by the game loop after
     * update so ordering matches the original's scheduler, where the floor
     * layer's own update ran separately.
     */
    applyScroll(dt: number): void {
        if (this._bounce.active) {
            return;
        }
        if (this._floorSpeed <= 0) {
            return;
        }
        // The layer moves opposite to the car.
        const direction = this._goingDown ? 1 : -1;
        this._floors.scrollBy(direction * this._floorSpeed * FLOOR_HEIGHT * dt);
    }

    /** OwnGameElevator.m:465-526. Chooses whether the car or the floors bounce. */
    private _updateSettle(currentFloor: number): void {
        if (!this._shouldComeToRest || this._comingToRest) {
            return;
        }

        const distance = this._floors.distanceToFloorBottom(currentFloor, this.y - HALF_CAR_HEIGHT);

        if (this.y > UP_SCROLL_POINT && this._floors.canElevatorMoveUp) {
            this.y = UP_SCROLL_POINT;
        }

        this._comingToRest = true;
        this.movementDir = Movement.Stopping;
        this._floorSpeed = 0;

        const bounceFloorUp = distance + this.y > UP_SCROLL_POINT && this._floors.canElevatorMoveUp;
        const bounceFloorDown = distance + this.y < DOWN_SCROLL_POINT && this._floors.canElevatorMoveDown;

        if (bounceFloorUp || bounceFloorDown) {
            // Distances are reversed for the floor layer, which moves opposite
            // to the car.
            this._bounceTarget = "floor";
            this._bounce.start(this._floors.layerY, this._floors.layerY - distance, ELEVATOR_SETTLE_TIME, bounceOut, () =>
                this._stopBounce()
            );
        } else {
            this._bounceTarget = "car";
            this._bounce.start(this.y, this.y + distance, ELEVATOR_SETTLE_TIME, bounceOut, () => this._stopBounce());
        }
    }

    private _advanceBounce(dt: number): void {
        const value = this._bounce.update(dt);
        if (value === null) {
            return;
        }
        if (this._bounceTarget === "floor") {
            this._floors.layerY = value;
        } else {
            this.y = value;
        }
    }

    /** OwnGameElevator.m:539-545. */
    private _stopBounce(): void {
        this._shouldComeToRest = false;
        this._comingToRest = false;
        this._floorSpeed = 0;
        this._move = 0;
        this._speed = 0;
        this.movementDir = Movement.Stopped;
        this._prevY = this.y;
    }

    /** OwnGameElevator.m:643-682, minus the scene transition. */
    private _updateDeath(dt: number): void {
        const value = this._deathTween.update(dt);
        if (value !== null) {
            this.deathFallY = value;
            return;
        }

        this._deathTimer += dt;
        if (this._deathTimer < CRASH_FALL_SPAN) {
            return;
        }

        this.deathSequencePlaying = false;
        this._deathTimer = 0;
        this.deathFallY = 0;
        this._resetMotion();

        if (this.lives > 0) {
            this.onLevelReset?.();
        } else {
            this.onGameOver?.();
        }
    }

    /** Set by the game loop; fires when the crash animation finishes. */
    onLevelReset: (() => void) | null = null;
    onGameOver: (() => void) | null = null;
}
