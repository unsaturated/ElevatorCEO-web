// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { Bonus } from "../sim/enums";
import type { EventBus, SimEvent } from "../sim/events";
import { audio } from "./audioController";
import { SoundEffect } from "./soundEffect";

/**
 * Maps simulation events onto AudioController calls.
 *
 * The original fired sounds from inside the elevator and status classes. Keeping
 * the mapping here is what lets the simulation stay headless while still
 * producing the same soundtrack.
 */
export function wireEventAudio(events: EventBus): () => void {
    return events.on((event) => handle(event));
}

function handle(event: SimEvent): void {
    switch (event.type) {
        case "elevatorStart":
            audio.playSound(SoundEffect.ElevatorStarting);
            break;
        case "elevatorMoving":
            audio.playSound(SoundEffect.ElevatorMoving);
            break;
        case "elevatorStopping":
            audio.stopSound(SoundEffect.ElevatorMoving);
            audio.playSound(SoundEffect.ElevatorStopping);
            break;
        case "elevatorCrash":
            audio.stopSound(SoundEffect.ElevatorMoving);
            audio.playSound(SoundEffect.ElevatorCrash);
            break;
        case "buttonTap":
            audio.playSound(SoundEffect.TapElevatorButton);
            break;
        case "buttonInvalid":
            audio.playSound(SoundEffect.InvalidElevatorButton);
            break;
        case "transfer":
            audio.playSound(SoundEffect.PassengerBonus);
            break;
        case "chestOpening":
            audio.playSound(SoundEffect.TreasureChestOpening);
            break;
        case "bonusResolved":
            playBonus(event.bonus);
            break;
        case "ceoBoarded":
            audio.playSound(SoundEffect.Booster);
            audio.playSound(SoundEffect.Stinger);
            break;
        case "levelStart":
            audio.playSound(SoundEffect.NewLevelTransition);
            break;
        case "lowSynergy":
            audio.playSound(SoundEffect.LowSynergyWarning);
            break;
        case "radarHidden":
            audio.playSound(SoundEffect.NoRadarBonus);
            break;
        case "radarRecovered":
            audio.playSound(SoundEffect.RecoverRadar);
            break;
        case "gameOver":
            audio.stopSound(SoundEffect.ElevatorMoving);
            audio.musicOff();
            break;
        case "lifeLost":
            if (event.livesRemaining === 0) {
                audio.musicOff();
            }
            break;
        default:
            break;
    }
}

function playBonus(bonus: Bonus): void {
    switch (bonus) {
        case Bonus.Heart:
            audio.playSound(SoundEffect.LifeBonus);
            break;
        case Bonus.Pension:
            audio.playSound(SoundEffect.PensionBonus);
            break;
        case Bonus.Passenger:
            audio.playSound(SoundEffect.PassengerBonus);
            break;
        case Bonus.Synergy:
            audio.playSound(SoundEffect.SynergyBonus);
            break;
        case Bonus.NoRadar:
            // Also emitted as radarHidden; avoid double-play by skipping here.
            break;
        case Bonus.Death:
            // Crash / life-lost path already covers the audible feedback.
            break;
        default:
            break;
    }
}
