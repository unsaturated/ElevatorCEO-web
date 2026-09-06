// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

import { canvasToDesign, type Letterbox } from "./designSpace";

export interface TouchPoint {
    /** Position in design points, bottom-left origin. */
    x: number;
    y: number;
    pointerId: number;
}

/**
 * Equivalent of a CCTargetedTouchDelegate.
 *
 * `onBegan` returning true claims the touch, so subsequent move/end events for
 * that pointer route to the same handler - matching cocos2d, where a targeted
 * delegate only sees the rest of a gesture if it accepted the start.
 *
 * `onCanceled` is ccTouchCancelled: the gesture was interrupted (pointercancel,
 * tab hide, PWA background) and must not count as a tap.
 */
export interface TouchHandler {
    /** Lower numbers are offered the touch first, as in cocos2d. */
    priority: number;
    /** When true, unclaimed touches are blocked (full-screen overlays). Claimed touches always stop dispatch. */
    swallowsTouches: boolean;
    enabled?: () => boolean;
    onBegan(touch: TouchPoint): boolean;
    onMoved?(touch: TouchPoint): void;
    onEnded?(touch: TouchPoint): void;
    onCanceled?(touch: TouchPoint): void;
}

const EMPTY_LETTERBOX: Letterbox = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    canvasWidth: 1,
    canvasHeight: 1,
};

/**
 * Priority-ordered pointer dispatch, replacing CCTouchDispatcher.
 *
 * The game needs this rather than plain mesh picking because overlays such as
 * pause and options menus register with swallowsTouches to block passthrough,
 * GameLevelTransition registers at priority -1 to absorb taps on the card
 * itself (GameLevelTransition.m:27, 141-151), and the pause menu sits above
 * that at priority -2 so it remains usable during a level intro.
 *
 * Browser / PWA extras the original never needed: pointercancel and lost
 * capture (system gestures, Control Center, app switch), a single active
 * pointer (EAGLView multipleTouchEnabled = NO), and cancel-all when the page
 * is hidden because a backgrounded tab will not deliver a matching pointerup.
 */
export class TouchDispatcher {
    private _handlers: TouchHandler[] = [];
    private _claims = new Map<number, TouchHandler>();
    /** Matches the original single-touch view: later pointers are ignored until this one ends. */
    private _activePointerId: number | null = null;
    private _pointerObserver: Observer<PointerInfo> | null = null;
    private readonly _scene: Scene | null;
    private readonly _letterbox: () => Letterbox;

    constructor(scene?: Scene | null, letterbox?: () => Letterbox) {
        this._scene = scene ?? null;
        this._letterbox = letterbox ?? (() => EMPTY_LETTERBOX);
        if (this._scene && typeof window !== "undefined") {
            this._attach(this._scene);
        }
    }

    add(handler: TouchHandler): TouchHandler {
        this._handlers.push(handler);
        this._handlers.sort((a, b) => a.priority - b.priority);
        return handler;
    }

    remove(handler: TouchHandler): void {
        this._handlers = this._handlers.filter((candidate) => candidate !== handler);
        for (const [pointerId, claimed] of this._claims) {
            if (claimed === handler) {
                this._claims.delete(pointerId);
            }
        }
    }

    /** Ends any in-flight gestures, e.g. when the game is paused or the page hides. */
    cancelAll(): void {
        for (const [pointerId, handler] of this._claims) {
            this._notifyCanceled(handler, { x: 0, y: 0, pointerId });
        }
        this._claims.clear();
        this._activePointerId = null;
    }

    /**
     * POINTERDOWN / equivalent. Public so tests can drive dispatch without a Scene.
     */
    handleBegan(point: TouchPoint): void {
        if (this._activePointerId !== null && this._activePointerId !== point.pointerId) {
            return;
        }
        this._activePointerId = point.pointerId;
        this._dispatchBegan(point);
    }

    handleMoved(point: TouchPoint): void {
        if (this._activePointerId !== null && point.pointerId !== this._activePointerId) {
            return;
        }
        this._claims.get(point.pointerId)?.onMoved?.(point);
    }

    handleEnded(point: TouchPoint): void {
        if (this._activePointerId !== null && point.pointerId !== this._activePointerId) {
            return;
        }
        this._dispatchEnded(point);
        if (this._activePointerId === point.pointerId) {
            this._activePointerId = null;
        }
    }

    /** pointercancel, lostpointercapture, or a hidden document. */
    handleCanceled(point: TouchPoint): void {
        if (this._activePointerId !== null && point.pointerId !== this._activePointerId) {
            return;
        }
        const handler = this._claims.get(point.pointerId);
        if (handler) {
            this._claims.delete(point.pointerId);
            this._notifyCanceled(handler, point);
        }
        if (this._activePointerId === point.pointerId) {
            this._activePointerId = null;
        }
    }

    dispose(): void {
        if (this._scene && this._pointerObserver) {
            this._scene.onPointerObservable.remove(this._pointerObserver);
            this._pointerObserver = null;
        }
        if (typeof window !== "undefined") {
            window.removeEventListener("pointerup", this._onNativePointerEnd);
            window.removeEventListener("pointercancel", this._onNativePointerEnd);
            window.removeEventListener("lostpointercapture", this._onNativePointerEnd);
            document.removeEventListener("visibilitychange", this._onVisibilityChange);
            window.removeEventListener("pagehide", this._onPageHide);
        }
        this.cancelAll();
    }

    private _attach(scene: Scene): void {
        this._pointerObserver = scene.onPointerObservable.add((info) => {
            const event = info.event as PointerEvent;
            const point = this._toDesign(event);

            switch (info.type) {
                case PointerEventTypes.POINTERDOWN:
                    this.handleBegan(point);
                    break;
                case PointerEventTypes.POINTERMOVE:
                    this.handleMoved(point);
                    break;
                case PointerEventTypes.POINTERUP:
                    this.handleEnded(point);
                    break;
                default:
                    break;
            }
        });

        // Babylon's observable has no POINTERCANCEL. The browser fires that
        // (and lostpointercapture) when iOS takes the gesture, a PWA is
        // backgrounded, or the pointer leaves the document. Window-level
        // pointerup also covers a release outside the canvas.
        window.addEventListener("pointerup", this._onNativePointerEnd);
        window.addEventListener("pointercancel", this._onNativePointerEnd);
        window.addEventListener("lostpointercapture", this._onNativePointerEnd);
        document.addEventListener("visibilitychange", this._onVisibilityChange);
        window.addEventListener("pagehide", this._onPageHide);
    }

    private _onNativePointerEnd = (event: Event): void => {
        const pointer = event as PointerEvent;
        const point = Number.isFinite(pointer.clientX)
            ? this._toDesign(pointer)
            : { x: 0, y: 0, pointerId: pointer.pointerId ?? -1 };
        if (event.type === "pointerup") {
            this.handleEnded(point);
        } else {
            this.handleCanceled(point);
        }
    };

    private _onVisibilityChange = (): void => {
        if (document.visibilityState === "hidden") {
            this.cancelAll();
        }
    };

    private _onPageHide = (): void => {
        this.cancelAll();
    };

    private _toDesign(event: PointerEvent): TouchPoint {
        const letterbox = this._letterbox();
        const canvasRect = this._scene?.getEngine().getRenderingCanvasClientRect();
        const scaleX = canvasRect ? letterbox.canvasWidth / canvasRect.width : 1;
        const scaleY = canvasRect ? letterbox.canvasHeight / canvasRect.height : 1;

        const pixelX = (event.clientX - (canvasRect?.left ?? 0)) * scaleX;
        const pixelY = (event.clientY - (canvasRect?.top ?? 0)) * scaleY;

        const { x, y } = canvasToDesign(letterbox, pixelX, pixelY);
        return { x, y, pointerId: event.pointerId };
    }

    private _dispatchBegan(point: TouchPoint): void {
        for (const handler of this._handlers) {
            if (handler.enabled && !handler.enabled()) {
                continue;
            }
            const claimed = handler.onBegan(point);
            if (claimed) {
                this._claims.set(point.pointerId, handler);
                return;
            }
            if (handler.swallowsTouches) {
                // Full-screen overlays (level transition, pause) block passthrough
                // even when they did not claim this particular touch.
                return;
            }
        }
    }

    private _dispatchEnded(point: TouchPoint): void {
        const handler = this._claims.get(point.pointerId);
        if (handler) {
            this._claims.delete(point.pointerId);
            handler.onEnded?.(point);
        }
    }

    private _notifyCanceled(handler: TouchHandler, point: TouchPoint): void {
        if (handler.onCanceled) {
            handler.onCanceled(point);
            return;
        }
        handler.onEnded?.(point);
    }
}

/** Rectangle hit test in design points, matching a CCSprite boundingBox check. */
export function rectContains(
    rect: { left: number; bottom: number; right: number; top: number },
    x: number,
    y: number
): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.bottom && y <= rect.top;
}

/** Circular hit test, as GameUpDownButton.m:106-116 used for the round buttons. */
export function circleContains(centerX: number, centerY: number, radius: number, x: number, y: number): boolean {
    const dx = x - centerX;
    const dy = y - centerY;
    return dx * dx + dy * dy <= radius * radius;
}
