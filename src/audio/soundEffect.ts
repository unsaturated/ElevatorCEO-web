// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

/**
 * Sound effect identifiers, ported from ElevatorCEO/Classes/AudioEnumerations.h.
 * The comments in the original mapped each case to its file; that mapping now
 * lives in SOUND_FILES below.
 */
export enum SoundEffect {
    InvalidElevatorButton = "InvalidElevatorButton",
    PensionBonus = "PensionBonus",
    NewLevelTransition = "NewLevelTransition",
    TapElevatorButton = "TapElevatorButton",
    ElevatorCrash = "ElevatorCrash",
    ElevatorMoving = "ElevatorMoving",
    ElevatorStopping = "ElevatorStopping",
    ElevatorStarting = "ElevatorStarting",
    TreasureChestOpening = "TreasureChestOpening",
    IntroLoop = "IntroLoop",
    ClickMenuButton = "ClickMenuButton",
    NoRadarBonus = "NoRadarBonus",
    LifeBonus = "LifeBonus",
    SynergyBonus = "SynergyBonus",
    Booster = "Booster",
    RecoverRadar = "RecoverRadar",
    Stinger = "Stinger",
    PassengerBonus = "PassengerBonus",
    SwapControlSides = "SwapControlSides",
    LowSynergyWarning = "LowSynergyWarning",
}

export interface SoundDefinition {
    /** Basename in src/assets/audio, without extension. */
    file: string;
    /** Gain applied at play time, matching the original's per-case `gain`. */
    gain?: number;
    loop?: boolean;
}

/**
 * File and gain mapping from AudioController.m:80-158 and :217-275.
 * The two gains that differ from unity are the elevator hum (1.1) and the
 * stinger (0.5).
 */
export const SOUND_FILES: Record<SoundEffect, SoundDefinition> = {
    [SoundEffect.InvalidElevatorButton]: { file: "buzzer" },
    [SoundEffect.PensionBonus]: { file: "coins" },
    [SoundEffect.NewLevelTransition]: { file: "dingdong" },
    [SoundEffect.TapElevatorButton]: { file: "elevator-button" },
    [SoundEffect.ElevatorCrash]: { file: "elevator-crash" },
    [SoundEffect.ElevatorMoving]: { file: "elevator-hum", gain: 1.1, loop: true },
    [SoundEffect.ElevatorStopping]: { file: "elevator-shutdown" },
    [SoundEffect.ElevatorStarting]: { file: "elevator-startup" },
    [SoundEffect.TreasureChestOpening]: { file: "glockenspiel" },
    [SoundEffect.IntroLoop]: { file: "livemusic", gain: 1.0, loop: true },
    [SoundEffect.ClickMenuButton]: { file: "menubutton" },
    [SoundEffect.NoRadarBonus]: { file: "powerdown" },
    [SoundEffect.LifeBonus]: { file: "recharge-big" },
    [SoundEffect.SynergyBonus]: { file: "recharge-small" },
    [SoundEffect.Booster]: { file: "rocket" },
    [SoundEffect.RecoverRadar]: { file: "staticdischarge" },
    [SoundEffect.Stinger]: { file: "stinger", gain: 0.5 },
    [SoundEffect.PassengerBonus]: { file: "successful" },
    [SoundEffect.SwapControlSides]: { file: "swap" },
    [SoundEffect.LowSynergyWarning]: { file: "warning" },
};

/** Background music track (AudioController.m:61, :207-208). */
export const MUSIC_FILE = "happyelevator";
/** Original set `backgroundMusicVolume` to 0.5 (AudioController.m:208). */
export const MUSIC_VOLUME = 0.5;
/** Fade applied when the menu loop is stopped (AudioController.m:171). */
export const INTRO_LOOP_FADE_SEC = 1.0;
