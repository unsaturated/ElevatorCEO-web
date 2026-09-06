// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

/**
 * Constants ported from ElevatorCEO/Classes/GameController.h.
 *
 * Only the 16:9 (iPhone 5 / tall) code path is implemented. The web build has no
 * ad banner, which in the original is equivalent to `adsRemovedByUser == YES`, so
 * `is16x9` is permanently true and the 4:3 branches are dropped.
 */

// Design canvas. One world unit == one design point.
export const DESIGN_WIDTH = 320;
export const DESIGN_HEIGHT = 568;

/** Extra y offset for menu-screen layout on the 16:9 art (GameController.h:49). */
export const VERTICAL_BUMP_FOR_16X9 = 30;

// Play area / control bar split (GameController.h:54, GamePlayLayer.m:37, GameControlLayer.m:33)
export const CONTROL_BAR_WIDTH = 80;
export const PLAY_AREA_WIDTH = DESIGN_WIDTH - CONTROL_BAR_WIDTH;
export const PLAY_AREA_MARGIN = 4;

/** Inset between shafts and the control bar on the control-adjacent side. */
export function playContentOffsetX(controlOnLeft: boolean): number {
    // Left side: shift content right. Right side: floor art is already
    // PLAY_AREA_WIDTH - PLAY_AREA_MARGIN wide, so no extra offset is needed.
    return controlOnLeft ? PLAY_AREA_MARGIN : 0;
}

// Floors (GameController.h:110-119)
export const FLOOR_HEIGHT = 60.0;
export const FLOORS_PER_SCREEN = 10; // FLOORS_PER_SCREEN_16x9
export const NUM_LEVEL_SPRITES_PER_SCREEN = 10; // NUM_LEVEL_SPRITES_PER_SCREEN_16x9
export const NUM_LEVEL_SPRITES = NUM_LEVEL_SPRITES_PER_SCREEN + 4; // NUM_LEVEL_SPRITES_16x9
export const BEGIN_SCROLL_UP_ON_FLOOR = 6; // BEGIN_SCROLL_UP_ON_FLOOR_16x9
export const BEGIN_SCROLL_DOWN_ON_FLOOR = 5; // BEGIN_SCROLL_DOWN_ON_FLOOR_16x9
export const ELEVATOR_SHAFT_WIDTH = 48;
export const NUM_ELEVATOR_SHAFTS = 5;
export const FLOOR_BOTTOM_GAP = 4.0;

/**
 * Draw order. GamePlayLayer.m adds the floor band at z=1 and the own elevator at
 * z=2, so in cocos2d the player's car always sits above every floor-band child
 * (divider at 3, transfer poof at 12). Babylon uses a flat alphaIndex, so the
 * own elevator gets a base above the band's maximum internal z.
 */
export const Z_FLOOR_BAND_MAX = 12;
export const Z_OWN_ELEVATOR_BASE = Z_FLOOR_BAND_MAX + 1;

// Up/down buttons (GameController.h:77-82)
export const BUTTON_MAX_UP_VALUE = 8;
export const BUTTON_MAX_DOWN_VALUE = 8;
export const BUTTON_MAX_TAP_TIME = 0.3;
export const BUTTON_TIME_INTERVAL = 0.5;
export const SPEED_FOR_BUTTON_TAP = 2;
export const BUTTON_MIN_SPEED = 3;

// Control swap animation (GameController.h:38, GameControlLayer.m:266-275)
export const SWAP_CONTROL_DURATION = 0.3;
export const SWAP_CONTROL_ROTATION_DURATION = SWAP_CONTROL_DURATION * 1.3;
export const SWAP_CONTROL_SCALE_DIP = 0.8;

// Lives (GameController.h:88-91)
export const NUM_LIFE_INDICATORS = 3;
export const GAME_STARTING_LIVES = 3;

// Radar (GameController.h:96-100)
export const NUM_NO_RADAR_INDICATORS = 8;
export const RADAR_LOCK_DISPLAY_SEC = 2.0;
export const CEO_RADAR_FLASH_SEC = 0.5;

// Pension (GameController.h:69-71)
export const GAME_MIN_PENSION = 0.0;
export const GAME_MAX_PENSION = 95_000_000.0;

/** GameController.h:212 — local top-three leaderboard depth. */
export const MAX_GAME_HIGH_SCORES = 3;

// Synergy bars (GameController.h:126-132)
export const RED_SYNERGY_BARS = 4;
export const YELLOW_SYNERGY_BARS = 5;
export const GREEN_SYNERGY_BARS = 10;
export const COUNT_SYNERGY_BARS = RED_SYNERGY_BARS + YELLOW_SYNERGY_BARS + GREEN_SYNERGY_BARS;
export const LOW_SYNERGY_COUNT = 4;

// Transfer elevators (GameController.h:138-152)
export const MAX_TRANSFER_EL_SPEED = BUTTON_MAX_UP_VALUE;
export const MIN_TRANSFER_EL_SPEED = 3;
export const ELEVATOR_SETTLE_TIME = 0.6;
export const NUM_BARS_TRANSFER_TIME = 8;
export const MIN_FLOORS_BETWEEN_ELS = 2;
export const MAX_FLOOR_DIFF = 8;
export const MAX_ELS_IN_SHAFT = 6;
export const MIN_PAUSE_AT_FLOOR = 3.0;
export const MAX_PAUSE_AT_FLOOR = 5.0;
export const TRANSFER_PAUSE_INCREMENT = 0.2;

// Bonus probabilities (GameController.h:158-165)
export const POSSIBLE_BONUSES = 6;
export const HEART_P = 0.05;
export const PENSION_P = 0.25;
export const DEATH_P = 0.05;
export const PASSENGER_P = 0.3;
export const NO_RADAR_P = 0.1;
export const SYNERGY_P = 0.25;

// Level progression, from the original design spreadsheet (GameController.h:174-207)
export const STARTING_LEVEL = 1;
export const MAX_ELEVATORS = 24;
export const MAX_PASSENGERS = 99;
export const INITIAL_PASSENGERS = 6;
export const LEVEL_PASSENGER_BUMP_DIVISOR = 5;
export const LEVEL_SLOT_DECREASE_DIVISOR = 4;
export const STARTING_SLOT_BUFFER = 10;
export const POSSIBLE_TRANSFERS_MULTIPLIER = 1.4;
export const SLOT_LEVEL_MULTIPLIER = 0.5;
export const TRANSFER_VALUE = 1250;
export const EVEN_START_PERCENTAGE = 0.8;
export const ODD_START_PERCENTAGE = 0.8;
export const START_FLOOR = 1;
export const INITIAL_FLOORS = 50;
export const FLOOR_INCREMENT_PERCENT = 0.11;
export const FLOOR_INCREMENT_FOR_PASSENGER_BUMP = 0.2;
export const INITIAL_ELEVATORS = 7;
export const ELEVATOR_BUMP_DIVISOR = 4;
export const ELEVATOR_BUMP_INCREMENT = 3;
export const CEO_STOP_DIVISOR = 120;
export const CEO_STOP_TIME_MAX_SECONDS = 10.0;
export const CEO_STOP_TIME_MIN_SECONDS = 2.0;
export const BONUSES_BEGIN_AT_LEVEL = 2;
export const MAX_BONUSES_PER_LEVEL = 2;
export const MAX_BONUS_PASSENGER = 2;
export const MIN_BONUS_PASSENGER = 1;
export const MIN_PENSION_BONUS = 2000;
export const PENSION_BONUS_MULTIPLIER = 1.2;
export const RADAR_FLOORS_HIDDEN_MIN = 10;
export const RADAR_FLOOR_HIDDEN_MULTIPLIER = 0.1;
export const SYNERGY_BONUS = 10;
export const SYNERGY_BUMP = 1.5;
export const SYNERGY_PER_FLOOR = 0.575;
export const STARTING_SYNERGY = 100.0;
export const BUTTON_SPEED_FLOOR_DIVISOR = 5;

// Timings (GameController.h:40-44)
export const TRANSITION_LAYER_DISPLAY_SEC = 5.0;
export const TRANSITION_DELAY_AFTER_CEO = 2.5;
export const PENSION_ANIMATION_SEC = 0.7;
export const CREDIT_FADE_SEC = 0.5;
export const CREDIT_HANG_SEC = 4.5;
export const TUTORIAL_ANIMATION_SEC = 0.2;
/** GameController.h:63 — delay after level init before the first tip slides in. */
export const TUTORIAL_DISPLAY_DELAY_SEC = TRANSITION_LAYER_DISPLAY_SEC + 4.2;

/**
 * Source art is exported at 2x, so pixel dimensions halve into design points.
 * (floor.png is 472x120 px for a 236x60 point sprite.)
 */
export const ASSET_SCALE = 2;
