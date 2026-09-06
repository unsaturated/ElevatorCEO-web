// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import type { App } from "../app";
import { ELEVATOR_SHAFT_WIDTH, PLAY_AREA_MARGIN } from "../core/constants";
import { rectContains, type TouchDispatcher, type TouchHandler } from "../render/input";
import type { TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { TweenRunner } from "../render/tween";
import type { Game } from "../sim/game";
import type { SimEvent } from "../sim/events";
import type { TransferElevator } from "../sim/transferElevator";
import { CeoElevatorView, OwnElevatorView, TransferElevatorView } from "./elevatorView";
import { FloorBandView } from "./floorBandView";
import { LevelTransitionView } from "./levelTransitionView";
import { TutorialTipsView } from "./tutorialTipView";

/** Generous enough to tap a 38x52 car with a fingertip, as the original was. */
const CAR_TOUCH_PADDING = 6;

/**
 * Everything inside the play area, ported from GamePlayLayer.m.
 *
 * The rule this file obeys is that it never decides anything: it reads the
 * simulation each frame and draws what it finds, and player input is forwarded
 * straight through. All the branching that used to live in the view - who can
 * be tapped, when a bonus fires, where an elevator may travel - now lives in
 * src/sim and is covered by headless tests.
 */
export class WorldView {
    readonly node: TransformNode;
    readonly floors: FloorBandView;
    readonly transition: LevelTransitionView;
    readonly tutorialTips: TutorialTipsView;

    private readonly _own: OwnElevatorView;
    private readonly _ceo: CeoElevatorView;
    private readonly _transfers = new Map<number, TransferElevatorView>();
    private readonly _touchHandler: TouchHandler;
    private _unsubscribe: () => void;
    private _contentOffsetX = PLAY_AREA_MARGIN;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        tweens: TweenRunner,
        private readonly _app: App,
        private readonly _touch: TouchDispatcher,
        private readonly _game: Game
    ) {
        this.node = new TransformNode("world", scene);

        this.floors = new FloorBandView(scene, textures, text, this.node);

        // Transfer cars are parented into the scrolling band, so they ride it
        // for free - the reason the view uses TransformNodes rather than
        // Babylon Sprites, which have no parent.
        for (const elevator of _game.allElevators) {
            const view = new TransferElevatorView(scene, textures, text, tweens, this.floors.node);
            this._transfers.set(elevator.id, view);
        }

        this._ceo = new CeoElevatorView(scene, textures, text, tweens, this.floors.node);

        // The player's car does not scroll: the building moves past it.
        this._own = new OwnElevatorView(scene, textures, text, tweens, this.node);

        this.transition = new LevelTransitionView(scene, textures, text, tweens, _touch, this.node);
        this.tutorialTips = new TutorialTipsView(scene, textures, text, _touch, tweens, this.node);
        this.applyPlayLayout();

        this._touchHandler = _touch.add({
            priority: 0,
            swallowsTouches: false,
            onBegan: (point) => this._onTouch(point.x, point.y),
        });

        this._unsubscribe = _game.events.on((event) => this._onSimEvent(event));
    }

    /** Repositions play content so PLAY_AREA_MARGIN sits inside the play layer (GamePlayLayer.m:46). */
    applyPlayLayout(): void {
        this._contentOffsetX = PLAY_AREA_MARGIN;
        this.floors.node.position.x = this._contentOffsetX;
        this.transition.node.position.x = this._contentOffsetX;
        this.tutorialTips.setLayout(this._contentOffsetX, this._app.worldOffsetX);
    }

    /** Called once per frame, after the simulation has advanced. */
    sync(): void {
        this.floors.sync(this._game.floors);
        this._own.sync(this._game.own, this._contentOffsetX + ELEVATOR_SHAFT_WIDTH / 2);
        this.tutorialTips.watchPassengers(this._game.own.passengersOnboard);

        for (const elevator of this._game.allElevators) {
            this._transfers.get(elevator.id)?.sync(elevator);
        }
        this._ceo.syncCeo(this._game.ceo);
    }

    /** Relays out the building for a new level and plays the transition card. */
    async startLevel(): Promise<void> {
        const params = this._game.params;
        this.floors.reset(params.startFloor, params.stopFloor);
        this.sync();
        this.tutorialTips.onLevelStart(params.level);
        await this.transition.show(params.level, params.startFloor, params.stopFloor);
    }

    // -- Input -------------------------------------------------------------

    /**
     * BaseTransferElevator.m:300-318 tested the tap against the car's bounding
     * box and then let the model decide. Same split here: this finds what was
     * hit, Game decides whether the tap counts.
     */
    private _onTouch(x: number, y: number): boolean {
        for (const elevator of this._game.allElevators) {
            if (!elevator.activeInGame) {
                continue;
            }
            if (this._hitsCar(elevator, x, y) && this._game.tapElevator(elevator)) {
                return true;
            }
        }

        if (this._game.ceo.activeInGame && this._hitsCar(this._game.ceo, x, y)) {
            return this._game.tapElevator(this._game.ceo);
        }
        return false;
    }

    /** Converts a car's floor-layer position into design points and tests it. */
    private _hitsCar(elevator: TransferElevator, x: number, y: number): boolean {
        const centerX = this.node.position.x + this._contentOffsetX + elevator.x;
        const centerY = this._game.floors.layerY + elevator.y;
        const halfWidth = 19 + CAR_TOUCH_PADDING;
        const halfHeight = 26 + CAR_TOUCH_PADDING;
        return rectContains(
            {
                left: centerX - halfWidth,
                right: centerX + halfWidth,
                bottom: centerY - halfHeight,
                top: centerY + halfHeight,
            },
            x,
            y
        );
    }

    // -- Simulation events -------------------------------------------------

    private _onSimEvent(event: SimEvent): void {
        switch (event.type) {
            case "poof":
                void this._viewFor(event.elevatorId)?.playPoof();
                break;
            case "chestOpening": {
                const elevator = this._game.allElevators.find((candidate) => candidate.id === event.elevatorId);
                const view = this._viewFor(event.elevatorId);
                if (elevator && view instanceof TransferElevatorView) {
                    void view.playChest(elevator.bonus, elevator.passengersOnboard);
                }
                break;
            }
            case "ceoBoarded":
                void this._ceo.playBoardingFire();
                break;
            case "pensionAward":
                // Elevator.m:158 is only invoked from BaseTransferElevator.m:332
                // (a regular passenger handoff). The CEO and bonus chests only
                // bump the HUD total.
                if (event.elevatorId !== this._game.ceo.id) {
                    void this._viewFor(event.elevatorId)?.animatePension(event.amount);
                }
                break;
            default:
                break;
        }
    }

    private _viewFor(elevatorId: number): TransferElevatorView | CeoElevatorView | undefined {
        return elevatorId === this._game.ceo.id ? this._ceo : this._transfers.get(elevatorId);
    }

    dispose(): void {
        this._unsubscribe();
        this._unsubscribe = () => {};
        this._touch.remove(this._touchHandler);
        this.tutorialTips.dispose();
        this.transition.dispose();
        for (const view of this._transfers.values()) {
            view.dispose();
        }
        this._transfers.clear();
        this._ceo.dispose();
        this._own.dispose();
        this.floors.dispose();
        this.node.dispose();
    }
}
