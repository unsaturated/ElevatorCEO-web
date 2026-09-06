// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import {
    ELEVATOR_SHAFT_WIDTH,
    GAME_MAX_PENSION,
    GAME_MIN_PENSION,
    GAME_STARTING_LIVES,
    MAX_BONUS_PASSENGER,
    MAX_ELS_IN_SHAFT,
    MIN_BONUS_PASSENGER,
    NUM_ELEVATOR_SHAFTS,
    STARTING_LEVEL,
    SYNERGY_BONUS,
    TRANSITION_DELAY_AFTER_CEO,
} from "../core/constants";
import { CeoElevator } from "./ceoElevator";
import { Bonus } from "./enums";
import { EventBus } from "./events";
import { FloorGeometry } from "./geometry";
import { LevelMaker, bonusValue, type LevelParameters } from "./levelMaker";
import { OwnElevator } from "./ownElevator";
import { defaultRandom, randBetween, type RandomSource } from "./random";
import { Shaft } from "./shaft";
import type { TransferElevator } from "./transferElevator";

/** Transfer shafts occupy columns 2..5; the player has column 1. */
export const TRANSFER_SHAFT_COUNT = NUM_ELEVATOR_SHAFTS - 1;

/** GamePlayLayer.m:238-241. */
export function shaftX(shaftNumber: number): number {
    return ELEVATOR_SHAFT_WIDTH / 2 + (shaftNumber - 1) * ELEVATOR_SHAFT_WIDTH;
}

/**
 * The whole game, with no rendering or audio dependency.
 *
 * This is the object the view reads and the tests drive. Everything the
 * original spread across GameControlLayer, GamePlayLayer, ShaftControl and the
 * elevator classes that constitutes a *rule* lives here; everything that was
 * presentation lives in src/view.
 */
export class Game {
    readonly events = new EventBus();
    readonly floors = new FloorGeometry();
    readonly own: OwnElevator;
    readonly ceo: CeoElevator;
    readonly shafts: Shaft[] = [];

    level = STARTING_LEVEL;
    pension = 0;
    params: LevelParameters;

    /** Floors of radar blackout remaining from a NoRadar bonus. */
    radarHiddenFloors = 0;
    radarHiddenTotal = 0;

    gameOver = false;
    paused = false;

    private readonly _maker: LevelMaker;
    private _levelUpTimer = -1;
    private _lastOwnFloor = 0;

    constructor(private readonly _random: RandomSource = defaultRandom) {
        this._maker = new LevelMaker(_random);
        this.own = new OwnElevator(this.floors, this.events);
        this.ceo = new CeoElevator(this.events);

        for (let i = 0; i < TRANSFER_SHAFT_COUNT; i++) {
            const shaft = new Shaft(i, _random, this.events);
            // Shaft 1 is the player's, so transfer shafts start at column 2.
            shaft.setShaftX(shaftX(i + 2));
            this.shafts.push(shaft);
        }

        // The CEO shares the rightmost shaft.
        const lastShaft = this.shafts[this.shafts.length - 1]!;
        lastShaft.ceo = this.ceo;
        this.ceo.x = shaftX(TRANSFER_SHAFT_COUNT + 1);

        this.params = this._maker.calculate(STARTING_LEVEL);

        this.own.onLevelReset = () => this.setLevel(this.level);
        this.own.onGameOver = () => this._endGame();
        this.ceo.onPassedTop = () => this.own.removePassengers(1);

        for (const shaft of this.shafts) {
            for (const elevator of shaft.elevators) {
                elevator.onBonusResolved = (bonus, passengers) => this._resolveBonus(elevator, bonus, passengers);
            }
        }
    }

    /** All transfer elevators across every shaft, plus the CEO. */
    get allElevators(): TransferElevator[] {
        return this.shafts.flatMap((shaft) => shaft.elevators);
    }

    // -- Level setup -------------------------------------------------------

    newGame(): void {
        this.gameOver = false;
        this.pension = 0;
        this.own.lives = GAME_STARTING_LIVES;
        this.level = STARTING_LEVEL;
        this.setLevel(STARTING_LEVEL);
    }

    /**
     * Port of -[GameControlLayer setLevel:] (GameControlLayer.m:285-566).
     * Distributes the level's elevators and bonuses across the four shafts,
     * then hands each shaft its floor bands.
     */
    setLevel(level: number): void {
        this.level = level;
        this.params = this._maker.calculate(level);
        this._levelUpTimer = -1;

        const params = this.params;

        this.floors.reset(params.startFloor, params.stopFloor);
        this.own.initializeLevel(params.startFloor, params.stopFloor, params.passengers);
        this._lastOwnFloor = params.startFloor;

        this.radarHiddenFloors = 0;
        this.radarHiddenTotal = 0;

        for (const shaft of this.shafts) {
            shaft.reset();
        }

        // GameControlLayer.m:310-311: the CEO always starts a level with one
        // passenger. Boarding adds the player on top of that, so skipping this
        // reset makes the count climb across levels.
        this.ceo.initializePassengers(1);

        // Spread elevators and bonus chests over the shafts, respecting the
        // six-per-shaft cap.
        const totalSlots = Math.min(params.numberOfElevators + params.bonuses, TRANSFER_SHAFT_COUNT * MAX_ELS_IN_SHAFT);
        const perShaft = Math.trunc(totalSlots / TRANSFER_SHAFT_COUNT);
        let remainder = totalSlots - perShaft * TRANSFER_SHAFT_COUNT;

        const counts = this.shafts.map(() => perShaft);
        while (remainder > 0) {
            const index = randBetween(this._random, 0, TRANSFER_SHAFT_COUNT - 1);
            if (counts[index]! < MAX_ELS_IN_SHAFT) {
                counts[index]!++;
                remainder--;
            }
        }

        const bonusPerShaft = this.shafts.map(() => 0);
        for (let b = 0; b < params.bonuses; b++) {
            for (let attempt = 0; attempt < 16; attempt++) {
                const index = randBetween(this._random, 0, TRANSFER_SHAFT_COUNT - 1);
                if (bonusPerShaft[index]! < counts[index]!) {
                    bonusPerShaft[index]!++;
                    break;
                }
            }
        }

        // Passenger slots come from the level maker, consumed in order.
        let slotCursor = 0;

        this.shafts.forEach((shaft, shaftIndex) => {
            shaft.setActiveElevators(counts[shaftIndex]!);
            shaft.bonusCount = bonusPerShaft[shaftIndex]!;

            let bonusesToPlace = shaft.bonusCount;
            for (let i = 0; i < counts[shaftIndex]!; i++) {
                const elevator = shaft.elevators[i]!;
                if (bonusesToPlace > 0) {
                    // 0xFF is the original's sentinel for "this car holds a chest".
                    elevator.initializePassengers(0xff);
                    bonusesToPlace--;
                } else {
                    elevator.initializePassengers(params.elevatorSlots[slotCursor % params.elevatorSlots.length] ?? 1);
                    slotCursor++;
                }
            }

            shaft.initializeShaft(
                params.startFloor,
                params.stopFloor,
                () => this._maker.randomBonus(),
                () => randBetween(this._random, MIN_BONUS_PASSENGER, MAX_BONUS_PASSENGER),
                params.stopsByCEO,
                params.stopTimeByCEO
            );
        });

        this.events.emit({ type: "levelStart", level });
    }

    // -- Frame -------------------------------------------------------------

    update(dt: number): void {
        if (this.paused || this.gameOver) {
            return;
        }

        this.own.update(dt);
        this.own.applyScroll(dt);

        // GameControlLayer.m:171-187: the CEO is summoned once the player is
        // down to their last passenger.
        if (this.own.passengersOnboard === 1 && !this.own.deathSequencePlaying) {
            this.shafts[this.shafts.length - 1]!.clearForCeo();
        }

        for (const shaft of this.shafts) {
            shaft.update(dt, this.params.stopTime, this.params.elevatorSpeed);
            for (const elevator of shaft.elevators) {
                if (elevator.activeInGame || elevator.displayingBonus) {
                    elevator.update(dt, this.params.stopTime);
                }
            }
        }

        if (this.ceo.activeInGame) {
            this.ceo.updateCeo(dt, this.params.stopTimeByCEO, this.own.deathSequencePlaying, this.own.levelUpPlaying);
        }

        this._updateRadarCountdown();
        this._updateLevelUp(dt);
    }

    /** GameRadarContents.m:234-264: the blackout burns down as floors are crossed. */
    private _updateRadarCountdown(): void {
        if (this.radarHiddenFloors <= 0 || this.own.floor === this._lastOwnFloor) {
            this._lastOwnFloor = this.own.floor;
            return;
        }
        this._lastOwnFloor = this.own.floor;
        this.radarHiddenFloors--;
        if (this.radarHiddenFloors === 0) {
            this.events.emit({ type: "radarRecovered" });
        }
    }

    /** CeoElevator.m:197-216: a fixed pause, then the next level. */
    private _updateLevelUp(dt: number): void {
        if (this._levelUpTimer < 0) {
            return;
        }
        this._levelUpTimer += dt;
        if (this._levelUpTimer >= TRANSITION_DELAY_AFTER_CEO) {
            this._levelUpTimer = -1;
            this.ceo.stopsRemaining = 0;
            const next = this.level + 1;
            this.events.emit({ type: "levelUp", level: next });
            this.setLevel(next);
        }
    }

    // -- Player actions ----------------------------------------------------

    /** Routed from the up/down buttons. */
    moveOwnElevator(tap: boolean, speed: number, down: boolean): void {
        if (this.paused || this.gameOver) {
            return;
        }
        this.own.moveSpeed(speed, tap, down);
    }

    /**
     * A tap on a transfer elevator. Returns true when it resolved into a
     * transfer, a chest, or boarding the CEO.
     */
    tapElevator(elevator: TransferElevator): boolean {
        if (this.paused || this.gameOver || this.own.deathSequencePlaying) {
            return false;
        }

        if (elevator === this.ceo) {
            const result = this.ceo.tap(this.own.floor);
            if (!result) {
                return false;
            }
            this.own.levelUpPlaying = true;
            this.own.removePassengersForCeo();
            this.changePension(result.pension);
            this._levelUpTimer = 0;
            return true;
        }

        const before = elevator.passengersOnboard;
        const result = elevator.tap(this.own.floor);
        if (result) {
            this.own.removePassengers(result.passengers);
            this.changePension(result.pension);
            this.changeSynergy(result.synergy);
            return true;
        }
        // A chest opening also counts as a successful tap.
        return elevator.displayingBonus && before > 0;
    }

    // -- Score and resources ----------------------------------------------

    /** GameStatus.m:214-226, including the original's clamp. */
    changePension(amount: number): void {
        this.pension = Math.min(Math.max(this.pension + amount, GAME_MIN_PENSION), GAME_MAX_PENSION);
    }

    changeSynergy(amount: number): void {
        this.own.synergy = Math.min(Math.max(this.own.synergy + amount, 0), 100);
    }

    /** BaseTransferElevator.m:398-445. */
    private _resolveBonus(elevator: TransferElevator, bonus: Bonus, passengers: number): void {
        const value = bonusValue(bonus, this.level, this.params.floors);

        switch (bonus) {
            case Bonus.Heart:
                this.own.addLife();
                break;
            case Bonus.Pension:
                this.changePension(value);
                break;
            case Bonus.Death:
                this.own.setLives(this.own.lives - 1);
                break;
            case Bonus.Passenger: {
                this.own.removePassengers(passengers);
                this.changePension(passengers * 1250);
                break;
            }
            case Bonus.NoRadar:
                this.radarHiddenFloors = value;
                this.radarHiddenTotal = value;
                this.events.emit({ type: "radarHidden", floors: value });
                break;
            case Bonus.Synergy:
                this.changeSynergy(SYNERGY_BONUS);
                break;
            case Bonus.None:
            default:
                break;
        }

        this.events.emit({ type: "bonusResolved", elevatorId: elevator.id, bonus, value });
    }

    private _endGame(): void {
        this.gameOver = true;
        this.events.emit({ type: "gameOver", pension: this.pension, level: this.level });
    }

    /** GamePauseLayer.m:157-172 — retire early with the current pension and level. */
    retire(): void {
        if (this.gameOver) {
            return;
        }
        this.paused = false;
        this.gameOver = true;
        this.events.emit({ type: "gameOver", pension: this.pension, level: this.level });
    }
}
