// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import type { Bonus } from "./enums";

/**
 * Everything the simulation needs to tell the outside world about.
 *
 * The original called `[[AudioController sharedInstance] playSound:]` and ran
 * CCActions directly from inside the game rules. Emitting events instead is
 * what keeps the simulation headless and testable: a test can assert that a
 * transfer emitted `transfer` with the right pension without a canvas or an
 * audio context existing.
 */
export type SimEvent =
    | { type: "elevatorStart" }
    | { type: "elevatorMoving" }
    | { type: "elevatorStopping" }
    | { type: "elevatorCrash" }
    | { type: "buttonTap" }
    | { type: "buttonInvalid" }
    /** A transfer elevator handed its passengers over. */
    | { type: "transfer"; elevatorId: number; passengers: number; pension: number; synergy: number }
    | { type: "chestOpening"; elevatorId: number }
    | { type: "bonusResolved"; elevatorId: number; bonus: Bonus; value: number }
    | { type: "poof"; elevatorId: number }
    | { type: "pensionAward"; elevatorId: number; amount: number }
    | { type: "ceoBoarded" }
    | { type: "levelUp"; level: number }
    | { type: "levelStart"; level: number }
    | { type: "lifeLost"; livesRemaining: number }
    | { type: "gameOver"; pension: number; level: number }
    | { type: "lowSynergy" }
    | { type: "radarHidden"; floors: number }
    | { type: "radarRecovered" };

export type SimEventHandler = (event: SimEvent) => void;

/** Simple synchronous fan-out. */
export class EventBus {
    private _handlers: SimEventHandler[] = [];

    on(handler: SimEventHandler): () => void {
        this._handlers.push(handler);
        return () => {
            this._handlers = this._handlers.filter((candidate) => candidate !== handler);
        };
    }

    emit(event: SimEvent): void {
        for (const handler of this._handlers) {
            handler(event);
        }
    }

    clear(): void {
        this._handlers = [];
    }
}
