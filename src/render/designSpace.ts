// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";

import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../core/constants";

/**
 * Layer masks keep the world, the radar and any debug geometry on separate
 * cameras. This is the native replacement for the GL scissor clipping that
 * CCNode+clipVisit.m performed: a camera renders only its own layer, into only
 * its own viewport rectangle.
 */
export const LAYER_WORLD = 0x1;
export const LAYER_RADAR = 0x2;
export const LAYER_HUD = 0x4;
export const LAYER_OVERLAY = 0x8;

/** How far back the cameras sit, which bounds the usable z-order range. */
const CAMERA_DISTANCE = 2000;

/**
 * Creates an orthographic camera whose visible region is exactly the given
 * rectangle in design points, with a bottom-left origin to match cocos2d.
 *
 * Because the ortho bounds are expressed in the same units as the original
 * source, every hardcoded coordinate in the Objective-C ports across unchanged.
 */
export function createDesignCamera(
    name: string,
    scene: Scene,
    layerMask: number,
    region: { x: number; y: number; width: number; height: number } = {
        x: 0,
        y: 0,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
    }
): FreeCamera {
    // Looking down -Z keeps larger position.z values nearer the camera, so z
    // reads the same way cocos2d's addChild:z: did. The camera sits far enough
    // back that the whole z range the game uses stays inside the near plane;
    // the level transition alone sits at z 100.
    const camera = new FreeCamera(name, new Vector3(0, 0, -CAMERA_DISTANCE), scene);
    camera.setTarget(new Vector3(0, 0, 0));
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.layerMask = layerMask;
    camera.minZ = 0.1;
    camera.maxZ = CAMERA_DISTANCE * 2;

    camera.orthoLeft = region.x;
    camera.orthoRight = region.x + region.width;
    camera.orthoBottom = region.y;
    camera.orthoTop = region.y + region.height;

    return camera;
}

/**
 * Restricts a camera to a sub-rectangle of the canvas, expressed in design
 * points. Used to clip the play area, which scrolls content that must not draw
 * over the control bar (GamePlayLayer.m:92-96).
 */
export function setViewportInDesignPoints(
    camera: Camera,
    rect: { x: number; y: number; width: number; height: number },
    letterbox: Letterbox
): void {
    const { scale, offsetX, offsetY, canvasWidth, canvasHeight } = letterbox;
    camera.viewport.x = (offsetX + rect.x * scale) / canvasWidth;
    camera.viewport.y = (offsetY + rect.y * scale) / canvasHeight;
    camera.viewport.width = (rect.width * scale) / canvasWidth;
    camera.viewport.height = (rect.height * scale) / canvasHeight;
}

export interface Letterbox {
    /** Canvas pixels per design point. */
    scale: number;
    /** Left edge of the design canvas within the real canvas, in pixels. */
    offsetX: number;
    /** Bottom edge of the design canvas within the real canvas, in pixels. */
    offsetY: number;
    canvasWidth: number;
    canvasHeight: number;
}

/**
 * Fits the 320x568 design canvas inside the real canvas without distortion,
 * centering the leftover space as letterbox bars.
 */
export function computeLetterbox(engine: Engine): Letterbox {
    const canvasWidth = engine.getRenderWidth();
    const canvasHeight = engine.getRenderHeight();
    const scale = Math.min(canvasWidth / DESIGN_WIDTH, canvasHeight / DESIGN_HEIGHT);
    return {
        scale,
        offsetX: (canvasWidth - DESIGN_WIDTH * scale) / 2,
        offsetY: (canvasHeight - DESIGN_HEIGHT * scale) / 2,
        canvasWidth,
        canvasHeight,
    };
}

/** Converts a canvas pixel coordinate into design points (bottom-left origin). */
export function canvasToDesign(letterbox: Letterbox, pixelX: number, pixelY: number): { x: number; y: number } {
    return {
        x: (pixelX - letterbox.offsetX) / letterbox.scale,
        // Pointer events arrive with a top-left origin; design space is bottom-left.
        y: (letterbox.canvasHeight - pixelY - letterbox.offsetY) / letterbox.scale,
    };
}
