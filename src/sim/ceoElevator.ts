// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TRANSFER_VALUE } from "../core/constants";
import { Bonus } from "./enums";
import type { EventBus } from "./events";
import { TransferElevator } from "./transferElevator";

/**
 * Port of ElevatorCEO/Classes/CeoElevator.m.
 *
 * The CEO is a transfer elevator with a schedule: it makes `totalStops` stops
 * on its way up, pausing `timeAtEachStop` at each, and the player has to be
 * waiting at one of them with a single passenger left. Riding past the top of
 * the level without being boarded costs the player that passenger, and with it
 * a life.
 */
export class CeoElevator extends TransferElevator {
    totalStops = 0;
    stopsRemaining = 0;
    timeAtEachStop = 0;

    /** Next stop, published early so the radar can show a preview marker. */
    floorGoingToPreview = 0xffff;

    private _informedLevelFailed = false;

    /** True once the player has boarded and the level-up delay is running. */
    boarded = false;

    constructor(events: EventBus) {
        super(-1, events);
    }

    override initializeLevel(): void {
        super.initializeLevel();
        this._informedLevelFailed = false;
        this.boarded = false;
        this.floorGoingToPreview = 0xffff;
    }

    /**
     * CeoElevator.m:115-140.
     *
     * `onPassedTop` fires once when the CEO reaches the top of its range
     * without having been boarded.
     */
    updateCeo(dt: number, stopTime: number, ownDeathPlaying: boolean, ownLevelUpPlaying: boolean): void {
        super.update(dt, stopTime);

        if (
            this.floor >= this.floorMax &&
            !this._informedLevelFailed &&
            this.floorGoingTo !== 0 &&
            !ownDeathPlaying &&
            !ownLevelUpPlaying
        ) {
            this._informedLevelFailed = true;
            this.onPassedTop?.();
        }
    }

    /**
     * CeoElevator.m:142-204. Boarding the CEO wins the level; there is no bonus
     * variant, so a chest never appears on this car.
     */
    override tap(ownFloor: number): { pension: number; synergy: number; passengers: number } | null {
        if (this.touched || !this.activeInGame) {
            return null;
        }
        if (this.floor !== ownFloor || this.inTransit) {
            return null;
        }
        if (this.bonus !== Bonus.None) {
            return null;
        }

        this.touched = true;
        this.boarded = true;

        const passengers = this.passengersOnboard;
        const pension = passengers * TRANSFER_VALUE;

        // The player steps aboard, the booster lights, and the timer is
        // overclocked so the CEO leaves immediately.
        this.passengersOnboard = passengers + 1;
        this.timerPercent = 0;
        this.timeAtFloor = 100;

        this._events.emit({ type: "ceoBoarded" });
        this._events.emit({ type: "pensionAward", elevatorId: this.id, amount: pension });

        return { pension, synergy: 0, passengers };
    }

    onPassedTop: (() => void) | null = null;
}
