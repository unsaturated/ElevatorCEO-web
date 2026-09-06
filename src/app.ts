// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";

import { CONTROL_BAR_WIDTH, DESIGN_HEIGHT, DESIGN_WIDTH, PLAY_AREA_MARGIN, PLAY_AREA_WIDTH } from "./core/constants";
import { isControlOnLeft, setControlOnLeft as saveControlOnLeft } from "./core/controlSideState";
import { audio } from "./audio/audioController";
import {
    LAYER_HUD,
    LAYER_OVERLAY,
    LAYER_RADAR,
    LAYER_WORLD,
    computeLetterbox,
    createDesignCamera,
    setViewportInDesignPoints,
    type Letterbox,
} from "./render/designSpace";

/**
 * Radar chrome background, in design points (GameRadar.m + GameControlLayer.m).
 * GameRadar sits at (-2, height - 154) on the 80pt control bar.
 */
export const RADAR_BG_RECT = { x: 238, y: 414, width: 82, height: 152.5 } as const;

/** Elevator dots are clipped to this inset inside radar-score-bg (GameRadarContents.m). */
export const RADAR_CONTENT_INSET = { x: 12.5, y: 8 } as const;
export const RADAR_CONTENT_SIZE = { width: 57, height: 136 } as const;

/**
 * Owns the Babylon engine, the scene, and the camera rig that maps the
 * 320x568 design canvas onto the real canvas.
 */
export class App {
    readonly engine: Engine;
    readonly scene: Scene;

    /** Renders the play area in world design space. */
    readonly worldCamera: FreeCamera;
    /** Renders the control bar over the whole canvas. */
    readonly hudCamera: FreeCamera;
    /** Renders the radar minimap. */
    readonly radarCamera: FreeCamera;
    /** Renders overlays that replace or sit above the whole game (GameOverView). */
    readonly overlayCamera: FreeCamera;

    letterbox: Letterbox;

    /** True when the control bar is on the left and the play area on the right. */
    controlOnLeft = isControlOnLeft();

    /** Notified after a side swap. */
    readonly onLayoutChanged = new Observable<App>();
    /** Notified with true when the tab/PWA hides, false when it is shown again. */
    readonly onPageHidden = new Observable<boolean>();

    private _updateHandlers: Array<(dt: number) => void> = [];
    private _running = false;
    private _pageHidden = typeof document !== "undefined" && document.visibilityState === "hidden";

    constructor(canvas: HTMLCanvasElement) {
        this.engine = new Engine(canvas, true, {
            preserveDrawingBuffer: false,
            stencil: false,
            antialias: true,
            powerPreference: "high-performance",
        });
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        this.engine.setHardwareScalingLevel(1 / Math.min(dpr, 2));

        this.scene = new Scene(this.engine);
        this.scene.clearColor = new Color4(0, 0, 0, 1);
        // Nothing in this game is lit; sprites carry their own color.
        this.scene.ambientColor.set(1, 1, 1);

        this.letterbox = computeLetterbox(this.engine);

        this.worldCamera = createDesignCamera("world", this.scene, LAYER_WORLD);
        this.hudCamera = createDesignCamera("hud", this.scene, LAYER_HUD);
        this.radarCamera = createDesignCamera("radar", this.scene, LAYER_RADAR);
        this.overlayCamera = createDesignCamera("overlay", this.scene, LAYER_OVERLAY);

        // Order matters: in cocos2d GameLayer.m (mPlayLayer z=4, mControlLayer z=3),
        // the control bar and radar are drawn first, and the play layer (world)
        // draws on top so the control bar slides behind the play layer during swap.
        // The overlay camera draws last over the entire scene (for GameOverLayer).
        this.scene.activeCameras = [this.hudCamera, this.radarCamera, this.worldCamera, this.overlayCamera];

        this.applyLayout();
        window.addEventListener("resize", this._onResize);
        canvas.addEventListener("contextmenu", this._onContextMenu);
        document.addEventListener("visibilitychange", this._onVisibilityChange);
        window.addEventListener("pagehide", this._onPageHide);
        window.addEventListener("pageshow", this._onPageShow);
        // Page Lifecycle API; not in every DOM lib.
        document.addEventListener("freeze", this._onFreeze);
        document.addEventListener("resume", this._onResume);
    }

    /**
     * Sets whether the control bar is on the left or right.
     */
    setControlOnLeft(controlOnLeft: boolean): void {
        this.controlOnLeft = controlOnLeft;
        saveControlOnLeft(controlOnLeft);
        this.onLayoutChanged.notifyObservers(this);
    }

    /** Design-space x offset applied to the play area root node. */
    get worldOffsetX(): number {
        return this.controlOnLeft ? CONTROL_BAR_WIDTH : -PLAY_AREA_MARGIN;
    }

    /** Design-space x offset applied to the control bar root node. */
    get hudOffsetX(): number {
        return this.controlOnLeft ? -PLAY_AREA_WIDTH : 0;
    }

    /** Recomputes the letterbox and every camera viewport. */
    applyLayout(): void {
        this.letterbox = computeLetterbox(this.engine);
        const fullDesignRect = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
        setViewportInDesignPoints(this.worldCamera, fullDesignRect, this.letterbox);
        setViewportInDesignPoints(this.hudCamera, fullDesignRect, this.letterbox);
        setViewportInDesignPoints(this.radarCamera, fullDesignRect, this.letterbox);
        setViewportInDesignPoints(this.overlayCamera, fullDesignRect, this.letterbox);
    }

    /**
     * Registers a per-frame callback. dt is in seconds, matching cocos2d's ccTime.
     * Returns an unsubscribe function.
     */
    onUpdate(handler: (dt: number) => void): () => void {
        this._updateHandlers.push(handler);
        return () => {
            this._updateHandlers = this._updateHandlers.filter((candidate) => candidate !== handler);
        };
    }

    /**
     * True when the tab, PWA, or browser has been backgrounded.
     * ElevatorCEOAppDelegate applicationWillResignActive / DidEnterBackground.
     */
    get pageHidden(): boolean {
        return this._pageHidden;
    }

    start(): void {
        if (this._running) {
            return;
        }
        this._running = true;
        if (!this._pageHidden) {
            this._startLoop();
        }
    }

    dispose(): void {
        window.removeEventListener("resize", this._onResize);
        this.engine.getRenderingCanvas()?.removeEventListener("contextmenu", this._onContextMenu);
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
        window.removeEventListener("pagehide", this._onPageHide);
        window.removeEventListener("pageshow", this._onPageShow);
        document.removeEventListener("freeze", this._onFreeze);
        document.removeEventListener("resume", this._onResume);
        this.engine.stopRenderLoop();
        this.scene.dispose();
        this.engine.dispose();
    }

    private _startLoop(): void {
        this.engine.runRenderLoop(() => {
            // Clamped so a backgrounded tab cannot resume with a huge step and
            // teleport elevators through floors. Visibility handling now also
            // stops the loop while hidden; this remains a backstop.
            const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
            for (const handler of this._updateHandlers) {
                handler(dt);
            }
            this.scene.render();
        });
    }

    private _setPageHidden(hidden: boolean): void {
        if (hidden === this._pageHidden) {
            return;
        }
        this._pageHidden = hidden;
        this.onPageHidden.notifyObservers(hidden);
        if (hidden) {
            audio.suspendContext();
            this.engine.stopRenderLoop();
        } else if (this._running) {
            audio.resumeContext();
            this._startLoop();
        }
    }

    private _onResize = (): void => {
        this.engine.resize();
        this.applyLayout();
    };

    private _onContextMenu = (event: Event): void => {
        event.preventDefault();
    };

    private _onVisibilityChange = (): void => {
        this._setPageHidden(document.visibilityState === "hidden");
    };

    private _onPageHide = (): void => {
        this._setPageHidden(true);
    };

    private _onPageShow = (): void => {
        this._setPageHidden(false);
    };

    private _onFreeze = (): void => {
        this._setPageHidden(true);
    };

    private _onResume = (): void => {
        this._setPageHidden(false);
    };
}
