// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import {
    DESIGN_HEIGHT,
    TUTORIAL_ANIMATION_SEC,
    TUTORIAL_DISPLAY_DELAY_SEC,
} from "../core/constants";
import { t } from "../i18n/locale";
import { isTutorialViewed, setTutorialViewed } from "../core/tutorialState";
import { LAYER_WORLD } from "../render/designSpace";
import { rectContains, type TouchDispatcher, type TouchHandler, type TouchPoint } from "../render/input";
import { Sprite2D } from "../render/sprite2d";
import { PASSENGER_STYLE, TextSprite, textQuadHeight, type TextStyle, type TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import type { TweenRunner } from "../render/tween";

/** tutorial-bg.png is 472×182 px → 236×91 design points (BaseTutorialTip.m:27). */
const TIP_WIDTH = 236;
const TIP_HEIGHT = 91;

/** kDroidSansBold11Black (BaseTutorialTip.m:35). */
const TIP_LINE_STYLE: TextStyle = { family: "DroidSans", size: 11, bold: true, color: "#000000" };

const TIP_LINE_COUNT = 4;
const TIP_LINE_X = 44;
/** Fraction of tip height reserved as padding above and below the text block. */
const TIP_VERTICAL_PADDING = 0.1;
/** Preferred gap between line quads; shrinks when the quads would overflow the text area. */
const TIP_LINE_GAP = 4;

/** Bottom-left Y positions for evenly spaced lines, vertically centered in the tip text area. */
function centeredTipLineYs(lineCount: number, lineHeight: number, containerHeight: number): number[] {
    const edgePadding = containerHeight * TIP_VERTICAL_PADDING;
    const innerHeight = containerHeight - edgePadding * 2;
    let gap = TIP_LINE_GAP;
    let blockHeight = lineCount * lineHeight + (lineCount - 1) * gap;
    if (blockHeight > innerHeight) {
        gap = (innerHeight - lineCount * lineHeight) / (lineCount - 1);
        blockHeight = innerHeight;
    }
    const blockBottom = edgePadding + (innerHeight - blockHeight) / 2;
    const ys: number[] = [];
    for (let i = 0; i < lineCount; i++) {
        ys.push(blockBottom + (lineCount - 1 - i) * (lineHeight + gap));
    }
    return ys;
}

/** GamePlayLayer.m:190 — above level transition (z 100), below pause (z 300). */
const TIP_Z = 200;
const TIP_TEXT_Z = TIP_Z + 1;
const TIP_DECOR_Z = TIP_Z + 2;

type TipId = "welcome" | "buttons" | "green" | "goal" | "ceo";

interface TipDefinition {
    readonly lineKeys: readonly [string, string, string, string];
    readonly next?: TipId;
    /** CeoTip / lastTip:YES — marks tutorial complete when dismissed. */
    readonly marksComplete?: boolean;
    readonly decorate?: (
        node: TransformNode,
        scene: Scene,
        textures: TextureCache,
        text: TextTextureCache,
        decorations: TransformNode[]
    ) => void;
}

const TIPS: Record<TipId, TipDefinition> = {
    welcome: {
        lineKeys: ["TIP_INTRO_LINE1", "TIP_INTRO_LINE2", "TIP_INTRO_LINE3", "TIP_INTRO_LINE4"],
        next: "buttons",
        decorate: (node, scene, textures, text, decorations) => {
            addElevatorBalloon(node, scene, textures, text, decorations, "el-blue-game.png", "6", 20, 16);
        },
    },
    buttons: {
        lineKeys: ["TIP_BUTTONS_LINE1", "TIP_BUTTONS_LINE2", "TIP_BUTTONS_LINE3", "TIP_BUTTONS_LINE4"],
        next: "green",
        decorate: (node, scene, textures, _text, decorations) => {
            const up = new Sprite2D(textures, scene, "up-off-game.png", { parent: node, z: TIP_DECOR_Z, layerMask: LAYER_WORLD });
            up.setPosition(21, 66);
            up.scale = 0.4;
            decorations.push(up.node);

            const down = new Sprite2D(textures, scene, "down-off-game.png", {
                parent: node,
                z: TIP_DECOR_Z,
                layerMask: LAYER_WORLD,
            });
            down.setPosition(21, 34);
            down.scale = 0.4;
            decorations.push(down.node);
        },
    },
    green: {
        lineKeys: ["TIP_GREEN_LINE1", "TIP_GREEN_LINE2", "TIP_GREEN_LINE3", "TIP_GREEN_LINE4"],
        next: "goal",
        decorate: (node, scene, textures, text, decorations) => {
            addElevatorBalloon(node, scene, textures, text, decorations, "el-green-game.png", "3", 20, 16);
        },
    },
    goal: {
        lineKeys: ["TIP_GOAL_LINE1", "TIP_GOAL_LINE2", "TIP_GOAL_LINE3", "TIP_GOAL_LINE4"],
        decorate: (node, scene, textures, text, decorations) => {
            addElevatorBalloon(node, scene, textures, text, decorations, "el-blue-game.png", "1", 20, 16);
        },
    },
    ceo: {
        lineKeys: ["TIP_CEO_LINE1", "TIP_CEO_LINE2", "TIP_CEO_LINE3", "TIP_CEO_LINE4"],
        marksComplete: true,
        decorate: (node, scene, textures, text, decorations) => {
            addElevatorBalloon(node, scene, textures, text, decorations, "el-red-game.png", "1", 20, 16);
        },
    },
};

function addElevatorBalloon(
    parent: TransformNode,
    scene: Scene,
    textures: TextureCache,
    text: TextTextureCache,
    decorations: TransformNode[],
    carFrame: string,
    passengers: string,
    x: number,
    y: number
): void {
    const car = new Sprite2D(textures, scene, carFrame, {
        anchorX: 0.5,
        anchorY: 0,
        parent,
        z: TIP_DECOR_Z,
        layerMask: LAYER_WORLD,
    });
    car.setPosition(x, y);
    car.scale = 0.7;
    decorations.push(car.node);

    // WelcomeTip.m:35 — y uses unscaled contentSize.height, not scaled bounds.
    const balloon = new Sprite2D(textures, scene, "dialog.png", { parent, z: TIP_DECOR_Z + 1, layerMask: LAYER_WORLD });
    balloon.setPosition(x, y + car.height);
    balloon.scale = 0.7;
    decorations.push(balloon.node);

    const label = new TextSprite(text, scene, passengers, { ...PASSENGER_STYLE, size: 16 }, {
        parent: balloon.node,
        z: TIP_DECOR_Z + 2,
        layerMask: LAYER_WORLD,
    });
    label.setPosition(0, 0);
}

/**
 * In-game tutorial tips ported from BaseTutorialTip.m and its subclasses.
 *
 * TutorialTipLayer.m was an unused one-line stub; the shipped tutorial flow
 * lives here and in GamePlayLayer.m:121-135 / OwnGameElevator.m:121-129.
 */
export class TutorialTipsView {
    readonly node: TransformNode;

    private readonly _lines: TextSprite[] = [];
    private readonly _decorations: TransformNode[] = [];
    private readonly _handler: TouchHandler;

    private _contentOffsetX = 0;
    private _worldOffsetX = 0;
    private _active = false;
    private _exiting = false;
    private _current: TipDefinition | null = null;
    private _marksComplete = false;
    private _startupTimer: ReturnType<typeof setTimeout> | null = null;
    private _lastPassengers = -1;

    constructor(
        scene: Scene,
        private readonly _textures: TextureCache,
        private readonly _text: TextTextureCache,
        private readonly _touch: TouchDispatcher,
        private readonly _tweens: TweenRunner,
        parent: TransformNode | null
    ) {
        this.node = new TransformNode("tutorialTips", scene);
        this.node.parent = parent;
        this.node.setEnabled(false);

        new Sprite2D(_textures, scene, "tutorial-bg.png", {
            anchorX: 0,
            anchorY: 0,
            parent: this.node,
            z: TIP_Z,
            layerMask: LAYER_WORLD,
        });

        const lineHeight = textQuadHeight(TIP_LINE_STYLE);
        const lineYs = centeredTipLineYs(TIP_LINE_COUNT, lineHeight, TIP_HEIGHT);
        for (let i = 0; i < TIP_LINE_COUNT; i++) {
            const label = new TextSprite(_text, scene, "", TIP_LINE_STYLE, {
                anchorX: 0,
                anchorY: 0,
                parent: this.node,
                z: TIP_TEXT_Z,
                layerMask: LAYER_WORLD,
            });
            label.setPosition(TIP_LINE_X, lineYs[i]!);
            this._lines.push(label);
        }

        this._handler = {
            priority: 0,
            swallowsTouches: false,
            enabled: () => this._active && !this._exiting,
            onBegan: (point) => this._onTouch(point),
        };
        this._touch.add(this._handler);
    }

    /** GamePlayLayer.m:195-197. */
    startupTips(): void {
        this.showTip("welcome");
    }

    /** GamePlayLayer.m:121-135 — schedule the intro chain on level 1. */
    onLevelStart(level: number): void {
        this._clearStartupTimer();
        this._lastPassengers = -1;
        if (level === 1 && !isTutorialViewed()) {
            this.removeAllTips(false);
            this._startupTimer = setTimeout(() => {
                this._startupTimer = null;
                this.startupTips();
            }, TUTORIAL_DISPLAY_DELAY_SEC * 1000);
        } else if (level === 2) {
            this.removeAllTips(true);
        }
    }

    /** GamePauseLayer.m:142-154 — replay from the pause menu. */
    replayFromPause(): void {
        setTutorialViewed(false);
        this.removeAllTips(false);
        this.startupTips();
    }

    /** OwnGameElevator.m:121-129 — CEO tip when one passenger remains. */
    watchPassengers(count: number): void {
        if (count === this._lastPassengers) {
            return;
        }
        this._lastPassengers = count;
        if (count === 1 && !isTutorialViewed()) {
            this.removeAllTips(false);
            this.showTip("ceo");
        }
    }

    /** Matches transition/floor band x within the world node (GamePlayLayer.m:46). */
    setLayout(contentOffsetX: number, worldOffsetX: number): void {
        this._contentOffsetX = contentOffsetX;
        this._worldOffsetX = worldOffsetX;
        if (this._active) {
            this.node.position.x = contentOffsetX;
        }
    }

    /** GamePlayLayer.m:186-192. */
    showTip(id: TipId): void {
        const def = TIPS[id];
        this._clearDecorations();
        this._current = def;
        this._marksComplete = def.marksComplete ?? false;

        for (let i = 0; i < 4; i++) {
            this._lines[i]!.setText(t(def.lineKeys[i] ?? ""));
        }

        if (def.decorate) {
            def.decorate(this.node, this.node.getScene()!, this._textures, this._text, this._decorations);
        }

        this.node.position.x = this._contentOffsetX;
        this.node.position.y = this._hiddenY();
        this.node.setEnabled(true);
        this._active = true;
        this._exiting = false;

        void this._animateTo(this._shownY());
    }

    /** GamePlayLayer.m:200-221. */
    removeAllTips(markViewed: boolean): void {
        this._clearStartupTimer();
        if (markViewed) {
            setTutorialViewed(true);
        }
        if (this._active) {
            this._exitImmediate();
        }
    }

    private _onTouch(point: TouchPoint): boolean {
        const parentX = (this.node.parent as TransformNode)?.position.x ?? this._worldOffsetX;
        const localX = point.x - parentX - this.node.position.x;
        const localY = point.y - this.node.position.y;
        if (!rectContains({ left: 0, right: TIP_WIDTH, bottom: 0, top: TIP_HEIGHT }, localX, localY)) {
            return false;
        }
        void this._exitAnimated();
        return true;
    }

    private async _exitAnimated(): Promise<void> {
        if (!this._active || this._exiting) {
            return;
        }
        this._exiting = true;
        await this._animateTo(this._hiddenY());
        this._finishExit();
    }

    private _exitImmediate(): void {
        this._tweens.stopAll(this.node);
        this._finishExit();
    }

    private _finishExit(): void {
        const def = this._current;
        const marksComplete = this._marksComplete;
        this._active = false;
        this._exiting = false;
        this._current = null;
        this._marksComplete = false;
        this.node.setEnabled(false);
        this._clearDecorations();

        if (marksComplete) {
            setTutorialViewed(true);
        }

        if (def?.next) {
            this.showTip(def.next);
        }
    }

    private async _animateTo(y: number): Promise<void> {
        const startY = this.node.position.y;
        await this._tweens.run(this.node, TUTORIAL_ANIMATION_SEC, (t) => {
            this.node.position.y = startY + (y - startY) * t;
        });
    }

    private _hiddenY(): number {
        return DESIGN_HEIGHT + TIP_HEIGHT;
    }

    private _shownY(): number {
        return DESIGN_HEIGHT - TIP_HEIGHT;
    }

    private _clearDecorations(): void {
        for (const node of this._decorations) {
            node.dispose();
        }
        this._decorations.length = 0;
    }

    private _clearStartupTimer(): void {
        if (this._startupTimer !== null) {
            clearTimeout(this._startupTimer);
            this._startupTimer = null;
        }
    }

    dispose(): void {
        this.removeAllTips(false);
        this._touch.remove(this._handler);
        for (const line of this._lines) {
            line.dispose();
        }
        this.node.dispose();
    }
}
