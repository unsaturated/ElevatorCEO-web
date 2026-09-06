// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { NUM_BARS_TRANSFER_TIME, PENSION_ANIMATION_SEC, Z_OWN_ELEVATOR_BASE } from "../core/constants";
import { formatNumber } from "../i18n/locale";
import { Sprite2D } from "../render/sprite2d";
import { PASSENGER_STYLE, TextSprite, type TextStyle, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import { sequenceFrames, type TweenRunner } from "../render/tween";
import { Bonus, bonusSprite } from "../sim/enums";
import type { CeoElevator } from "../sim/ceoElevator";
import type { OwnElevator } from "../sim/ownElevator";
import type { TransferElevator } from "../sim/transferElevator";

const POOF_FRAMES = sequenceFrames("poof%d.png", 5);
const CHEST_FRAMES = sequenceFrames("chest%d.png", 5);
/** GameLayer.m:37-41. */
const POOF_FRAME_DELAY = 0.1;
const CHEST_FRAME_DELAY = 0.2;

/** CeoElevator.m:182-196 — 0.6s particle smoke burst on boarding. */
const CEO_FIRE_DURATION = 0.6;
const CEO_FIRE_EMIT_INTERVAL = 0.035;
const CEO_FIRE_PARTICLE_LIFETIME = 0.5;

/** Balloon and label sit one car-height above the car center. */
const BALLOON_OFFSET_Y = 52;

/**
 * kDroidSansBold28White (Elevator.m:41). The bitmap font baked a dark outline;
 * without it, white glyphs vanish against the car and floor art.
 */
const PENSION_REWARD_STYLE: TextStyle = {
    family: "DroidSans",
    size: 28,
    bold: true,
    color: "#ffffff",
    outlineColor: "#000000",
    outlineWidth: 2,
};

/**
 * Above the poof (z 12) and chest (z 7). cocos2d used z 1000 as draw order;
 * here the same value is also camera depth, so it has to stay in the small
 * range the rest of the floor band uses.
 */
const PENSION_REWARD_Z = 15;

/**
 * The eight-segment stop timer stacked inside a transfer car.
 *
 * Port of ElevatorTimer.m: bars are 12x3 points, stacked every 4 points from
 * the bottom of the car, and lit proportionally to the time remaining.
 */
class TimerBars {
    readonly node: TransformNode;
    private readonly _bars: Sprite2D[] = [];
    private _litCount = -1;

    constructor(scene: Scene, textures: TextureCache, parent: TransformNode) {
        this.node = new TransformNode("elevatorTimer", scene);
        this.node.parent = parent;

        for (let i = 0; i < NUM_BARS_TRANSFER_TIME; i++) {
            const bar = new Sprite2D(textures, scene, "transfertime.png", {
                anchorX: 0,
                anchorY: 0,
                parent: this.node,
                z: 5,
            });
            bar.setPosition(0, i * 4);
            this._bars.push(bar);
        }
    }

    get width(): number {
        return this._bars[0]?.width ?? 0;
    }

    setPercent(percent: number): void {
        const clamped = Math.max(0, Math.min(100, percent));
        // A bar lights while the remaining percentage is above its own share.
        const lit = this._bars.filter((_, index) => clamped > index * (100 / NUM_BARS_TRANSFER_TIME)).length;
        if (lit === this._litCount) {
            return;
        }
        this._litCount = lit;
        this._bars.forEach((bar, index) => {
            bar.visible = index < lit;
        });
    }

    set visible(value: boolean) {
        this.node.setEnabled(value);
    }

    dispose(): void {
        for (const bar of this._bars) {
            bar.dispose();
        }
        this.node.dispose();
    }
}

/**
 * Shared presentation for every car: the body, the passenger balloon, the poof
 * burst and the stop timer. TransferElevatorView and CeoElevatorView differ
 * only in their extras, exactly as BaseTransferElevator's subclasses did.
 */
abstract class ElevatorViewBase {
    readonly node: TransformNode;
    protected readonly _car: Sprite2D;
    protected readonly _balloon: Sprite2D;
    protected readonly _label: TextSprite;
    protected readonly _poof: Sprite2D;
    protected readonly _timer: TimerBars;

    private _poofPlaying = false;

    protected constructor(
        protected readonly _scene: Scene,
        protected readonly _textures: TextureCache,
        text: TextTextureCache,
        protected readonly _tweens: TweenRunner,
        carFrame: string,
        parent: TransformNode | null,
        zBase = 0
    ) {
        this.node = new TransformNode(`elevator:${carFrame}`, _scene);
        this.node.parent = parent;

        this._car = new Sprite2D(_textures, _scene, carFrame, { parent: this.node, z: zBase + 2 });

        this._balloon = new Sprite2D(_textures, _scene, "dialog.png", { parent: this.node, z: zBase + 3 });
        this._balloon.setPosition(0, BALLOON_OFFSET_Y);

        this._label = new TextSprite(text, _scene, "0", PASSENGER_STYLE, { parent: this.node, z: zBase + 4 });
        this._label.setPosition(0, BALLOON_OFFSET_Y);

        this._poof = new Sprite2D(_textures, _scene, POOF_FRAMES[0]!, { parent: this.node, z: zBase + 12 });
        this._poof.setPosition(0, BALLOON_OFFSET_Y);
        this._poof.visible = false;

        this._timer = new TimerBars(_scene, _textures, this.node);
        // ElevatorTimer sits centered across the car, six points up from its floor.
        this._timer.node.position.set(-this._timer.width / 2, 6 - this._car.height / 2, 0);
    }

    set visible(value: boolean) {
        this.node.setEnabled(value);
    }

    /** CCAnimate over poof1..5, then hide. */
    async playPoof(): Promise<void> {
        if (this._poofPlaying) {
            return;
        }
        this._poofPlaying = true;
        // BaseTransferElevator.m:327-328 hides the balloon before the poof,
        // otherwise the empty dialog sits behind the burst.
        this._balloon.visible = false;
        this._label.visible = false;
        this._poof.visible = true;
        await this._tweens.animate(this._poof, POOF_FRAMES, POOF_FRAME_DELAY);
        this._poof.visible = false;
        this._poof.setFrame(POOF_FRAMES[0]!);
        this._poofPlaying = false;
    }

    dispose(): void {
        this._tweens.stopAll(this._poof);
        this._timer.dispose();
        this._poof.dispose();
        this._label.dispose();
        this._balloon.dispose();
        this._car.dispose();
        this.node.dispose();
    }
}

/** The player's blue car, plus the black wreck used by the death sequence. */
export class OwnElevatorView extends ElevatorViewBase {
    private readonly _wreck: Sprite2D;
    private _crashing = false;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        tweens: TweenRunner,
        parent: TransformNode | null
    ) {
        super(scene, textures, text, tweens, "el-blue-game.png", parent, Z_OWN_ELEVATOR_BASE);
        // The player's car has no stop timer; only transfer cars are on a clock.
        this._timer.visible = false;

        // OwnGameElevator.m:33-38 falls a separate sprite rather than the live
        // car, so the simulation's position stays authoritative throughout.
        this._wreck = new Sprite2D(textures, scene, "el-black-game.png", {
            parent: this.node,
            z: Z_OWN_ELEVATOR_BASE + 20,
        });
        this._wreck.visible = false;
    }

    sync(own: OwnElevator, centerX = own.x): void {
        this.node.position.set(centerX, own.y, 0);

        const crashing = own.deathSequencePlaying;
        if (crashing !== this._crashing) {
            this._crashing = crashing;
            this._car.visible = !crashing;
            this._wreck.visible = crashing;
            if (!crashing) {
                this._wreck.setPosition(0, 0);
                this._balloon.setPosition(0, BALLOON_OFFSET_Y);
                this._label.setPosition(0, BALLOON_OFFSET_Y);
            }
        }

        if (crashing) {
            // The wreck and the balloon both ride the simulation's fall curve,
            // the balloon trailing slightly as the original's 0.3s delay did.
            this._wreck.setPosition(0, own.deathFallY);
            this._balloon.setPosition(0, BALLOON_OFFSET_Y + own.deathFallY * 0.92);
            this._label.setPosition(0, BALLOON_OFFSET_Y + own.deathFallY * 0.92);
        }

        // Boarding the CEO removes the balloon rather than emptying it.
        const showBalloon = !own.movedToCeoElevator;
        this._balloon.visible = showBalloon;
        this._label.visible = showBalloon;
        if (showBalloon) {
            this._label.setText(String(own.passengersOnboard));
        }
    }
}

/** A green transfer car: passengers or a treasure chest, plus its stop timer. */
export class TransferElevatorView extends ElevatorViewBase {
    private readonly _chest: Sprite2D;
    private readonly _bonusIcon: Sprite2D;
    private readonly _pensionReward: TextSprite;
    private _bonusChangeCounter = -1;
    private _chestPlaying = false;
    private _chestChangeCounter = 0;
    private _pensionAnimToken = 0;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        tweens: TweenRunner,
        parent: TransformNode | null,
        carFrame = "el-green-game.png"
    ) {
        super(scene, textures, text, tweens, carFrame, parent);

        this._chest = new Sprite2D(textures, scene, CHEST_FRAMES[0]!, { parent: this.node, z: 7 });
        this._chest.setPosition(1, BALLOON_OFFSET_Y + 1);
        this._chest.visible = false;

        this._bonusIcon = new Sprite2D(textures, scene, "heart.png", { parent: this.node, z: 10 });
        this._bonusIcon.setPosition(1, BALLOON_OFFSET_Y + 1);
        this._bonusIcon.visible = false;

        // Elevator.m:41-43 — floating payout, above everything else on the car.
        this._pensionReward = new TextSprite(text, scene, "0", PENSION_REWARD_STYLE, {
            parent: this.node,
            z: PENSION_REWARD_Z,
        });
        this._pensionReward.visible = false;
    }

    sync(elevator: TransferElevator): void {
        this.node.position.set(elevator.x, elevator.y, 0);
        this.visible = elevator.activeInGame || elevator.displayingBonus;

        if (elevator.bonusChangeCounter !== this._bonusChangeCounter) {
            this._applyBonus(elevator);
        }

        const showBalloon = elevator.showPassengerBalloon;
        const showCount = elevator.bonus === Bonus.None && showBalloon;
        this._balloon.visible = showBalloon;
        // playChest owns the passenger-count label while the prize is on
        // screen. Sync would otherwise hide it because bonus is still Passenger.
        if (!this._chestPlaying) {
            this._label.visible = showCount;
            if (showCount) {
                this._label.opacity = 1;
                this._label.setText(String(elevator.passengersOnboard));
            }
        }

        this._timer.visible = elevator.passengersOnboard > 0 && !elevator.displayingBonus;
        this._timer.setPercent(elevator.timerPercent);
    }

    /**
     * Elevator.m:158-186. A passenger transfer pops the payout off the car:
     * scale 0.3→2, rise 20pt, fade out, and tint white→green, all in
     * PENSION_ANIMATION_SEC (the tint finishes at half that).
     */
    async animatePension(amount: number): Promise<void> {
        const token = ++this._pensionAnimToken;
        this._tweens.stopAll(this._pensionReward);

        this._pensionReward.setText(formatNumber(amount));
        this._pensionReward.setPosition(0, 5);
        this._pensionReward.setColor(1, 1, 1);
        this._pensionReward.scale = 0.3;
        this._pensionReward.opacity = 1;
        this._pensionReward.visible = true;

        await Promise.all([
            this._tweens.scaleTo(this._pensionReward, 2.0, PENSION_ANIMATION_SEC),
            this._tweens.moveBy(this._pensionReward, 0, 20, PENSION_ANIMATION_SEC),
            this._tweens.fadeOut(this._pensionReward, PENSION_ANIMATION_SEC),
            this._tweens.tintTo(this._pensionReward, 0, 255, 0, PENSION_ANIMATION_SEC / 2),
        ]);
        if (token !== this._pensionAnimToken) {
            return;
        }
        this._pensionReward.visible = false;
    }

    /** BaseTransferElevator.m:260-286. Re-runs on every setBonus, not only a kind change. */
    private _applyBonus(elevator: TransferElevator): void {
        this._bonusChangeCounter = elevator.bonusChangeCounter;
        this._chestChangeCounter++;
        this._tweens.stopAll(this._chest);
        this._tweens.stopAll(this._bonusIcon);
        this._tweens.stopAll(this._label);
        this._chestPlaying = false;

        const bonus = elevator.bonus;
        if (bonus === Bonus.None) {
            this._chest.visible = false;
            this._bonusIcon.visible = false;
            return;
        }

        this._chest.setFrame(CHEST_FRAMES[0]!);
        this._chest.opacity = 1;
        this._chest.visible = true;
        this._bonusIcon.visible = false;

        const frame = bonusSprite(bonus);
        if (frame && this._textures.has(frame)) {
            this._bonusIcon.setFrame(frame);
        }
    }

    /**
     * BaseTransferElevator.m:350-376 as a single async flow: the chest opens
     * and fades, then the prize appears and fades, then the poof clears it.
     * The original expressed this as three nested CCSequences handing actions
     * to each other through CCCallFuncO.
     */
    async playChest(bonus: Bonus, passengers: number): Promise<void> {
        if (this._chestPlaying) {
            return;
        }
        this._chestPlaying = true;
        const change = ++this._chestChangeCounter;
        this._chest.setFrame(CHEST_FRAMES[0]!);
        this._chest.opacity = 1;
        this._chest.visible = true;

        await this._tweens.animate(this._chest, CHEST_FRAMES, CHEST_FRAME_DELAY);
        if (change !== this._chestChangeCounter) {
            return;
        }
        await this._tweens.fadeOut(this._chest, 0.5);
        if (change !== this._chestChangeCounter) {
            return;
        }
        this._chest.visible = false;

        // kPassenger has no icon: the prize is the passenger count itself.
        const reveal = bonus === Bonus.Passenger ? this._label : this._bonusIcon;
        if (reveal === this._label) {
            this._label.setText(String(passengers));
        }
        reveal.opacity = 0;
        reveal.visible = true;
        await this._tweens.fadeTo(reveal, 1, 0.5);
        if (change !== this._chestChangeCounter) {
            return;
        }
        await this._tweens.delay(reveal, 1.0);
        if (change !== this._chestChangeCounter) {
            return;
        }
        reveal.visible = false;

        this._chestPlaying = false;
    }

    override dispose(): void {
        this._pensionAnimToken++;
        this._tweens.stopAll(this._chest);
        this._tweens.stopAll(this._bonusIcon);
        this._tweens.stopAll(this._pensionReward);
        this._chest.dispose();
        this._bonusIcon.dispose();
        this._pensionReward.dispose();
        super.dispose();
    }
}

/** The CEO's red car, distinguished by its rocket booster. */
export class CeoElevatorView extends TransferElevatorView {
    private readonly _booster: Sprite2D;
    private _burning = false;
    private readonly _fireContainer: TransformNode;
    private readonly _activeFireSprites = new Set<Sprite2D>();
    private _firePlaying = false;

    constructor(
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        tweens: TweenRunner,
        parent: TransformNode | null
    ) {
        super(scene, textures, text, tweens, parent, "el-red-game.png");

        this._fireContainer = new TransformNode("ceoFireContainer", scene);
        this._fireContainer.parent = this.node;

        // BoosterAnimation.m: scaled to 0.6 and hung below the car.
        this._booster = new Sprite2D(textures, scene, "burner.png", { parent: this.node, z: 1 });
        this._booster.setPosition(0, -30);
        this._booster.scale = 0.6;
        this._booster.opacity = 0;
    }

    syncCeo(ceo: CeoElevator): void {
        this.sync(ceo);
        this.visible = ceo.activeInGame;
        void this.burn(ceo.boarded);
    }

    /**
     * CeoElevator.m:182-196. Spawns a CCParticleSmoke burst textured with
     * fire.png behind the booster (z=0) for 0.6 seconds when the CEO is boarded.
     */
    async playBoardingFire(): Promise<void> {
        if (!this._textures.has("fire.png")) {
            return;
        }
        this._clearFire();
        this._firePlaying = true;

        const emitCount = Math.floor(CEO_FIRE_DURATION / CEO_FIRE_EMIT_INTERVAL);
        for (let i = 0; i < emitCount; i++) {
            if (!this._firePlaying) {
                break;
            }
            this._spawnFireParticle();
            await this._tweens.delay(this._fireContainer, CEO_FIRE_EMIT_INTERVAL);
        }
    }

    private _spawnFireParticle(): void {
        const particle = new Sprite2D(this._textures, this._scene, "fire.png", {
            parent: this._fireContainer,
            z: 0,
        });
        const startX = (Math.random() - 0.5) * 16;
        const startY = -30 + (Math.random() - 0.5) * 6;
        const driftX = startX + (Math.random() - 0.5) * 12;
        const driftY = startY + 14 + Math.random() * 12;
        const startScale = 0.35 + Math.random() * 0.25;
        const endScale = 0.65 + Math.random() * 0.35;

        particle.setPosition(startX, startY);
        particle.scale = startScale;
        particle.opacity = 0.85;
        this._activeFireSprites.add(particle);

        void this._tweens.run(particle, CEO_FIRE_PARTICLE_LIFETIME, (t) => {
            particle.setPosition(
                startX + (driftX - startX) * t,
                startY + (driftY - startY) * t
            );
            particle.scale = startScale + (endScale - startScale) * t;
            particle.opacity = 0.85 * (1 - t);
        }).then(() => {
            this._activeFireSprites.delete(particle);
            particle.dispose();
        });
    }

    private _clearFire(): void {
        this._firePlaying = false;
        this._tweens.stopAll(this._fireContainer);
        for (const sprite of this._activeFireSprites) {
            this._tweens.stopAll(sprite);
            sprite.dispose();
        }
        this._activeFireSprites.clear();
    }

    /**
     * BoosterAnimation.m:57-84. Ignition fades the flame in and then pulses it
     * on a loop; shutdown just fades it out.
     */
    async burn(activate: boolean): Promise<void> {
        if (activate === this._burning) {
            return;
        }
        this._burning = activate;

        if (!activate) {
            this._clearFire();
            this._tweens.stopAll(this._booster);
            await this._tweens.fadeOut(this._booster, 0.5);
            return;
        }

        await this._tweens.fadeIn(this._booster, 0.2);
        while (this._burning) {
            await this._tweens.run(this._booster, 0.15, (t) => {
                this._booster.setScale(0.6 * (1 - 0.15 * t), 0.6 * (1 - 0.4 * t));
            });
            if (!this._burning) {
                break;
            }
            await this._tweens.run(this._booster, 0.15, (t) => {
                this._booster.setScale(0.6 * (0.85 + 0.15 * t), 0.6 * (0.6 + 0.4 * t));
            });
        }
    }

    override dispose(): void {
        this._burning = false;
        this._clearFire();
        this._fireContainer.dispose();
        this._tweens.stopAll(this._booster);
        this._booster.dispose();
        super.dispose();
    }
}
