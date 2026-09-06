// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

/** Ported from ElevatorCEO/Classes/BonusEnumerations.h. */
export enum Bonus {
    None = 0,
    Heart = 1,
    Pension = 2,
    Death = 3,
    Passenger = 4,
    NoRadar = 5,
    Synergy = 6,
}

/** Ported from ElevatorCEO/Classes/ElevatorMoveEnum.h. */
export enum Movement {
    Stopped = 0,
    Stopping = 1,
    Up = 2,
    Down = 3,
}

/** Ported from ElevatorCEO/Classes/MinMaxFloorStruct.h. */
export interface MinMaxFloor {
    min: number;
    max: number;
}

/** Sprite frame for each bonus (GameLevelMaker.m:390-411). */
export function bonusSprite(bonus: Bonus): string | null {
    switch (bonus) {
        case Bonus.Heart:
            return "heart.png";
        case Bonus.Pension:
            return "treasure.png";
        case Bonus.Death:
            return "skull-black.png";
        case Bonus.NoRadar:
            return "noradar.png";
        case Bonus.Synergy:
            return "synergy.png";
        case Bonus.None:
        case Bonus.Passenger:
        default:
            return null;
    }
}
